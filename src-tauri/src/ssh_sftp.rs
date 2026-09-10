use serde::{Deserialize, Serialize};
use ssh2::{CheckResult, HashType, KnownHostFileKind, RenameFlags, Session, Sftp};
use std::{
    fs,
    io::{self, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MIN_TIMEOUT_MS: u64 = 500;
const MAX_TIMEOUT_MS: u64 = 30_000;
const MAX_UPLOAD_FILES: usize = 10_000;
const MAX_UPLOAD_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_UPLOAD_DEPTH: usize = 32;
const MAX_REMOTE_LIST_ENTRIES: usize = 2_000;

/// 仅支持文件传输所需的认证方法；不暴露远程 Shell、命令执行或端口转发。
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthMethod {
    Password,
    PrivateKey,
}

/// 前端会话中临时保留的 SSH/SFTP 连接资料。禁止派生 Debug，避免意外打印密码。
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSftpProfile {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshAuthMethod,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionProbe {
    /// `ready` 或 `host_key_untrusted`。
    pub state: String,
    pub fingerprint: String,
    pub remote_home: Option<String>,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshRemoteEntry {
    pub name: String,
    pub path: String,
    /// `directory`、`file` 或 `other`。
    pub entry_type: String,
    pub size: Option<u64>,
    pub modified_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryListing {
    pub path: String,
    pub entries: Vec<SshRemoteEntry>,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTransferResult {
    pub operation: String,
    pub files: usize,
    pub bytes: u64,
    pub remote_path: String,
    pub local_path: Option<String>,
    pub message: String,
}

struct ActiveSession {
    session: Session,
    fingerprint: String,
}

enum SessionVerification {
    Ready(ActiveSession),
    NeedsTrust { fingerprint: String },
}

#[derive(Default)]
struct TransferStats {
    files: usize,
    bytes: u64,
}

fn app_known_hosts_file(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位 SSH 配置目录：{error}"))?;
    fs::create_dir_all(&data_dir).map_err(|error| format!("无法创建 SSH 配置目录：{error}"))?;
    Ok(data_dir.join("ssh_known_hosts"))
}

fn validate_profile(profile: &SshSftpProfile) -> Result<SocketAddr, String> {
    let host = profile.host.trim();
    if host.is_empty()
        || host.len() > 253
        || host
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        || host.contains(['/', '\\', '@', '?', '#'])
    {
        return Err("SSH 主机只能填写 IP 或主机名，不得包含协议、路径或用户信息".to_string());
    }
    if profile.port == 0 {
        return Err("SSH 端口必须在 1 到 65535 之间".to_string());
    }
    let username = profile.username.trim();
    if username.is_empty()
        || username.len() > 128
        || username
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err("SSH 用户名不能为空，且不得包含空白或控制字符".to_string());
    }
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&profile.timeout_ms) {
        return Err(format!(
            "SSH 超时必须在 {MIN_TIMEOUT_MS} 到 {MAX_TIMEOUT_MS} ms 之间"
        ));
    }
    match profile.auth_method {
        // 测试环境可能显式允许空密码；保留到认证阶段，由服务端决定是否接受。
        SshAuthMethod::Password => {}
        SshAuthMethod::PrivateKey => {
            let key_path = profile
                .private_key_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .ok_or_else(|| "密钥登录需要选择私钥文件".to_string())?;
            let metadata =
                fs::metadata(key_path).map_err(|error| format!("无法读取私钥文件：{error}"))?;
            if !metadata.is_file() {
                return Err("所选 SSH 私钥不是普通文件".to_string());
            }
        }
    }

    (host, profile.port)
        .to_socket_addrs()
        .map_err(|error| format!("无法解析 SSH 主机 {host}：{error}"))?
        .next()
        .ok_or_else(|| "SSH 主机未解析到可连接的地址".to_string())
}

fn fingerprint(session: &Session) -> String {
    session
        .host_key_hash(HashType::Sha256)
        .map(|bytes| {
            bytes
                .iter()
                .map(|byte| format!("{byte:02X}"))
                .collect::<Vec<_>>()
                .join(":")
        })
        .unwrap_or_else(|| "不可用".to_string())
}

fn known_host_name(profile: &SshSftpProfile) -> String {
    if profile.port == 22 {
        profile.host.trim().to_string()
    } else {
        format!("[{}]:{}", profile.host.trim(), profile.port)
    }
}

fn verify_host_key(
    session: &Session,
    profile: &SshSftpProfile,
    known_hosts_path: &Path,
    trust_unknown_host: bool,
) -> Result<SessionVerification, String> {
    let (key, key_type) = session
        .host_key()
        .ok_or_else(|| "无法读取 SSH 服务端主机密钥".to_string())?;
    let key = key.to_vec();
    let fingerprint = fingerprint(session);
    let mut known_hosts = session
        .known_hosts()
        .map_err(|error| format!("无法初始化 SSH known_hosts：{error}"))?;
    if known_hosts_path.exists() {
        known_hosts
            .read_file(known_hosts_path, KnownHostFileKind::OpenSSH)
            .map_err(|error| format!("无法读取 SSH known_hosts：{error}"))?;
    }

    match known_hosts.check_port(profile.host.trim(), profile.port, &key) {
        CheckResult::Match => Ok(SessionVerification::Ready(ActiveSession {
            session: session.clone(),
            fingerprint,
        })),
        CheckResult::Mismatch => Err(format!(
            "SSH 主机密钥与已信任记录不匹配（当前 SHA256: {fingerprint}）。为避免中间人攻击，工具已停止连接。"
        )),
        CheckResult::Failure => Err("SSH 主机密钥校验失败，工具已停止连接".to_string()),
        CheckResult::NotFound if !trust_unknown_host => {
            Ok(SessionVerification::NeedsTrust { fingerprint })
        }
        CheckResult::NotFound => {
            if !known_hosts_path.exists() {
                fs::File::create(known_hosts_path)
                    .map_err(|error| format!("无法创建 SSH known_hosts：{error}"))?;
            }
            known_hosts
                .add(
                    &known_host_name(profile),
                    &key,
                    "NP-Tools SSH/SFTP explicit trust",
                    key_type.into(),
                )
                .map_err(|error| format!("无法保存 SSH 主机密钥：{error}"))?;
            known_hosts
                .write_file(known_hosts_path, KnownHostFileKind::OpenSSH)
                .map_err(|error| format!("无法写入 SSH known_hosts：{error}"))?;
            Ok(SessionVerification::Ready(ActiveSession {
                session: session.clone(),
                fingerprint,
            }))
        }
    }
}

fn open_verified_session(
    profile: &SshSftpProfile,
    known_hosts_path: &Path,
    trust_unknown_host: bool,
) -> Result<SessionVerification, String> {
    let endpoint = validate_profile(profile)?;
    let timeout = Duration::from_millis(profile.timeout_ms);
    let tcp = TcpStream::connect_timeout(&endpoint, timeout).map_err(|error| {
        format!(
            "SSH 连接 {}:{} 失败：{error}",
            profile.host.trim(),
            profile.port
        )
    })?;
    tcp.set_read_timeout(Some(timeout))
        .map_err(|error| format!("设置 SSH 读取超时失败：{error}"))?;
    tcp.set_write_timeout(Some(timeout))
        .map_err(|error| format!("设置 SSH 写入超时失败：{error}"))?;

    let mut session = Session::new().map_err(|error| format!("创建 SSH 会话失败：{error}"))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(profile.timeout_ms as u32);
    session
        .handshake()
        .map_err(|error| format!("SSH 握手失败：{error}"))?;
    verify_host_key(&session, profile, known_hosts_path, trust_unknown_host)
}

fn authenticate_session(
    profile: &SshSftpProfile,
    active: ActiveSession,
) -> Result<ActiveSession, String> {
    let username = profile.username.trim();
    match profile.auth_method {
        SshAuthMethod::Password => {
            let password = profile.password.as_deref().unwrap_or_default();
            active
                .session
                .userauth_password(username, password)
                .map_err(|error| {
                    if password.is_empty() {
                        format!("SSH 空密码认证失败：{error}。如服务器要求密码，请填写后重试")
                    } else {
                        format!("SSH 密码认证失败：{error}")
                    }
                })?;
        }
        SshAuthMethod::PrivateKey => {
            let key_path = Path::new(profile.private_key_path.as_deref().unwrap_or_default());
            let passphrase = profile
                .passphrase
                .as_deref()
                .filter(|value| !value.is_empty());
            active
                .session
                .userauth_pubkey_file(username, None, key_path, passphrase)
                .map_err(|error| format!("SSH 私钥认证失败：{error}"))?;
        }
    }
    if !active.session.authenticated() {
        return Err("SSH 认证未完成，服务器未授予会话权限".to_string());
    }
    Ok(active)
}

fn authenticated_session(
    profile: &SshSftpProfile,
    known_hosts_path: &Path,
) -> Result<ActiveSession, String> {
    match open_verified_session(profile, known_hosts_path, false)? {
        SessionVerification::Ready(active) => authenticate_session(profile, active),
        SessionVerification::NeedsTrust { fingerprint } => Err(format!(
            "SSH 主机密钥尚未受信任（SHA256: {fingerprint}）。请先在连接区域核对指纹并明确确认。"
        )),
    }
}

fn with_sftp<T>(
    profile: &SshSftpProfile,
    known_hosts_path: &Path,
    action: impl FnOnce(&Sftp) -> Result<T, String>,
) -> Result<T, String> {
    let active = authenticated_session(profile, known_hosts_path)?;
    let sftp = active
        .session
        .sftp()
        .map_err(|error| format!("打开 SFTP 子系统失败：{error}"))?;
    action(&sftp)
}

fn remote_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(PathBuf::from("."));
    }
    if trimmed.len() > 4096 || trimmed.as_bytes().contains(&0) {
        return Err("远端路径无效".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

fn resolve_remote_directory(sftp: &Sftp, raw_path: &str) -> Result<PathBuf, String> {
    let requested = remote_path(raw_path)?;
    let resolved = sftp
        .realpath(&requested)
        .map_err(|error| format!("无法定位远端目录 {}：{error}", requested.display()))?;
    let stat = sftp
        .stat(&resolved)
        .map_err(|error| format!("无法读取远端目录 {}：{error}", resolved.display()))?;
    if !stat.is_dir() {
        return Err(format!("远端路径不是目录：{}", resolved.display()));
    }
    Ok(resolved)
}

fn resolve_remote_file(sftp: &Sftp, raw_path: &str) -> Result<PathBuf, String> {
    let requested = remote_path(raw_path)?;
    let resolved = sftp
        .realpath(&requested)
        .map_err(|error| format!("无法定位远端文件 {}：{error}", requested.display()))?;
    let stat = sftp
        .stat(&resolved)
        .map_err(|error| format!("无法读取远端文件 {}：{error}", resolved.display()))?;
    if !stat.is_file() {
        return Err("仅支持下载远端普通文件；目录下载暂不开放".to_string());
    }
    Ok(resolved)
}

fn inspect_upload_path(path: &Path, depth: usize, stats: &mut TransferStats) -> Result<(), String> {
    if depth > MAX_UPLOAD_DEPTH {
        return Err(format!(
            "本地目录层级超过 {MAX_UPLOAD_DEPTH}，已停止上传预检"
        ));
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("无法读取本地路径 {}：{error}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("不上传符号链接：{}", path.display()));
    }
    if metadata.is_file() {
        stats.files += 1;
        stats.bytes = stats
            .bytes
            .checked_add(metadata.len())
            .ok_or_else(|| "上传文件总大小溢出".to_string())?;
        if stats.files > MAX_UPLOAD_FILES || stats.bytes > MAX_UPLOAD_BYTES {
            return Err(format!(
                "单次上传最多 {MAX_UPLOAD_FILES} 个文件、{} GiB；请拆分后再传输",
                MAX_UPLOAD_BYTES / 1024 / 1024 / 1024
            ));
        }
        return Ok(());
    }
    if !metadata.is_dir() {
        return Err(format!("仅支持普通文件或目录：{}", path.display()));
    }
    for entry in fs::read_dir(path)
        .map_err(|error| format!("无法读取本地目录 {}：{error}", path.display()))?
    {
        let entry = entry.map_err(|error| format!("读取本地目录项失败：{error}"))?;
        inspect_upload_path(&entry.path(), depth + 1, stats)?;
    }
    Ok(())
}

fn selected_local_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("上传路径必须来自本机文件选择器".to_string());
    }
    let metadata =
        fs::symlink_metadata(&path).map_err(|error| format!("无法读取所选本地路径：{error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("不允许直接选择符号链接上传".to_string());
    }
    let canonical =
        fs::canonicalize(&path).map_err(|error| format!("无法解析本地路径：{error}"))?;
    if canonical.parent().is_none() {
        return Err("不允许上传文件系统根目录".to_string());
    }
    Ok(canonical)
}

fn ensure_remote_directory(sftp: &Sftp, directory: &Path) -> Result<(), String> {
    match sftp.stat(directory) {
        Ok(stat) if stat.is_dir() => Ok(()),
        Ok(_) => Err(format!("远端同名路径不是目录：{}", directory.display())),
        Err(_) => sftp
            .mkdir(directory, 0o755)
            .map_err(|error| format!("无法创建远端目录 {}：{error}", directory.display())),
    }
}

fn temporary_remote_path(remote_path: &Path) -> Result<PathBuf, String> {
    let parent = remote_path
        .parent()
        .ok_or_else(|| format!("远端目标缺少父目录：{}", remote_path.display()))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(parent.join(format!(
        ".np-tools-upload-{}-{nonce}.part",
        std::process::id()
    )))
}

fn upload_file(
    sftp: &Sftp,
    local_path: &Path,
    remote_path: &Path,
    overwrite: bool,
    stats: &mut TransferStats,
) -> Result<(), String> {
    if let Ok(existing) = sftp.stat(remote_path) {
        if existing.is_dir() {
            return Err(format!(
                "远端同名路径是目录，不能覆盖：{}",
                remote_path.display()
            ));
        }
        if !overwrite {
            return Err(format!(
                "远端已存在同名文件：{}；如确认覆盖，请开启“允许覆盖”",
                remote_path.display()
            ));
        }
    }
    let staging_path = temporary_remote_path(remote_path)?;
    let copied = (|| -> Result<u64, String> {
        let mut local_file = fs::File::open(local_path)
            .map_err(|error| format!("无法打开本地文件 {}：{error}", local_path.display()))?;
        let mut staging_file = sftp
            .create(&staging_path)
            .map_err(|error| format!("无法创建远端临时文件 {}：{error}", staging_path.display()))?;
        let copied = io::copy(&mut local_file, &mut staging_file)
            .map_err(|error| format!("上传文件 {} 失败：{error}", local_path.display()))?;
        staging_file.flush().map_err(|error| {
            format!("刷新远端临时文件 {} 失败：{error}", staging_path.display())
        })?;
        Ok(copied)
    })();
    let copied = match copied {
        Ok(copied) => copied,
        Err(error) => {
            let _ = sftp.unlink(&staging_path);
            return Err(error);
        }
    };
    let rename_flags = if overwrite {
        RenameFlags::OVERWRITE
    } else {
        RenameFlags::empty()
    };
    if let Err(error) = sftp.rename(&staging_path, remote_path, Some(rename_flags)) {
        let _ = sftp.unlink(&staging_path);
        return Err(format!(
            "无法将远端临时文件提交为 {}：{error}",
            remote_path.display()
        ));
    }
    stats.files += 1;
    stats.bytes = stats
        .bytes
        .checked_add(copied)
        .ok_or_else(|| "上传字节数溢出".to_string())?;
    Ok(())
}

fn upload_directory_contents(
    sftp: &Sftp,
    local_directory: &Path,
    remote_directory: &Path,
    overwrite: bool,
    stats: &mut TransferStats,
) -> Result<(), String> {
    for entry in fs::read_dir(local_directory)
        .map_err(|error| format!("无法读取本地目录 {}：{error}", local_directory.display()))?
    {
        let entry = entry.map_err(|error| format!("读取本地目录项失败：{error}"))?;
        let local_path = entry.path();
        let metadata = fs::symlink_metadata(&local_path)
            .map_err(|error| format!("无法读取本地路径 {}：{error}", local_path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("不上传符号链接：{}", local_path.display()));
        }
        let name = local_path
            .file_name()
            .ok_or_else(|| format!("无法识别本地文件名：{}", local_path.display()))?;
        let remote_path = remote_directory.join(name);
        if metadata.is_dir() {
            ensure_remote_directory(sftp, &remote_path)?;
            upload_directory_contents(sftp, &local_path, &remote_path, overwrite, stats)?;
        } else if metadata.is_file() {
            upload_file(sftp, &local_path, &remote_path, overwrite, stats)?;
        } else {
            return Err(format!("仅支持普通文件或目录：{}", local_path.display()));
        }
    }
    Ok(())
}

fn upload_local_item(
    sftp: &Sftp,
    local_path: &Path,
    remote_directory: &Path,
    overwrite: bool,
    stats: &mut TransferStats,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(local_path)
        .map_err(|error| format!("无法读取本地路径 {}：{error}", local_path.display()))?;
    let name = local_path
        .file_name()
        .ok_or_else(|| format!("无法识别本地文件名：{}", local_path.display()))?;
    let remote_path = remote_directory.join(name);
    if metadata.is_file() {
        upload_file(sftp, local_path, &remote_path, overwrite, stats)
    } else if metadata.is_dir() {
        ensure_remote_directory(sftp, &remote_path)?;
        upload_directory_contents(sftp, local_path, &remote_path, overwrite, stats)
    } else {
        Err(format!("仅支持普通文件或目录：{}", local_path.display()))
    }
}

fn download_file_to(
    sftp: &Sftp,
    remote_path: &Path,
    local_path: &Path,
) -> Result<SshTransferResult, String> {
    if !local_path.is_absolute() || local_path.file_name().is_none() {
        return Err("下载目标必须来自本机保存位置选择器".to_string());
    }
    let parent = local_path
        .parent()
        .ok_or_else(|| "下载目标缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建本地下载目录：{error}"))?;

    if local_path.exists() {
        return Err("本地目标文件已存在；为避免覆盖，请换一个保存名称".to_string());
    }

    // 只在本函数确实创建了目标文件后才允许清理，避免并发创建时误删用户文件。
    let mut created_local_file = false;
    let result = (|| -> Result<u64, String> {
        let mut remote_file = sftp
            .open(remote_path)
            .map_err(|error| format!("无法打开远端文件 {}：{error}", remote_path.display()))?;
        let mut local_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(local_path)
            .map_err(|error| format!("无法创建本地下载文件：{error}"))?;
        created_local_file = true;
        let copied = io::copy(&mut remote_file, &mut local_file)
            .map_err(|error| format!("下载文件 {} 失败：{error}", remote_path.display()))?;
        local_file
            .flush()
            .map_err(|error| format!("刷新本地下载文件失败：{error}"))?;
        Ok(copied)
    })();

    let copied = match result {
        Ok(copied) => copied,
        Err(error) => {
            if created_local_file {
                let _ = fs::remove_file(local_path);
            }
            return Err(error);
        }
    };
    Ok(SshTransferResult {
        operation: "download".to_string(),
        files: 1,
        bytes: copied,
        remote_path: remote_path.to_string_lossy().into_owned(),
        local_path: Some(local_path.to_string_lossy().into_owned()),
        message: format!("已下载 1 个文件（{copied} B）"),
    })
}

#[tauri::command]
pub async fn ssh_sftp_probe(
    profile: SshSftpProfile,
    trust_unknown_host: bool,
    app: AppHandle,
) -> Result<SshConnectionProbe, String> {
    let known_hosts = app_known_hosts_file(&app)?;
    tokio::task::spawn_blocking(move || {
        match open_verified_session(&profile, &known_hosts, trust_unknown_host)? {
            SessionVerification::NeedsTrust { fingerprint } => Ok(SshConnectionProbe {
                state: "host_key_untrusted".to_string(),
                fingerprint,
                remote_home: None,
                message: "首次连接：请先与运维提供的指纹核对，再明确确认信任。".to_string(),
            }),
            SessionVerification::Ready(active) => {
                let fingerprint = active.fingerprint.clone();
                let active = authenticate_session(&profile, active)?;
                let sftp = active
                    .session
                    .sftp()
                    .map_err(|error| format!("打开 SFTP 子系统失败：{error}"))?;
                let home = sftp
                    .realpath(Path::new("."))
                    .map_err(|error| format!("无法定位远端家目录：{error}"))?;
                Ok(SshConnectionProbe {
                    state: "ready".to_string(),
                    fingerprint,
                    remote_home: Some(home.to_string_lossy().into_owned()),
                    message: "SSH 凭据与 SFTP 子系统已验证；后续浏览和传输会独立建连。".to_string(),
                })
            }
        }
    })
    .await
    .map_err(|error| format!("SSH 连接任务异常：{error}"))?
}

#[tauri::command]
pub async fn ssh_sftp_list_dir(
    profile: SshSftpProfile,
    remote_path: String,
    app: AppHandle,
) -> Result<SshDirectoryListing, String> {
    let known_hosts = app_known_hosts_file(&app)?;
    tokio::task::spawn_blocking(move || {
        with_sftp(&profile, &known_hosts, |sftp| {
            let directory = resolve_remote_directory(sftp, &remote_path)?;
            let mut entries = sftp
                .readdir(&directory)
                .map_err(|error| format!("读取远端目录 {} 失败：{error}", directory.display()))?
                .into_iter()
                .filter_map(|(path, stat)| {
                    let name = path.file_name()?.to_string_lossy().into_owned();
                    if name == "." || name == ".." {
                        return None;
                    }
                    let entry_type = if stat.is_dir() {
                        "directory"
                    } else if stat.is_file() {
                        "file"
                    } else {
                        "other"
                    };
                    Some(SshRemoteEntry {
                        name,
                        path: path.to_string_lossy().into_owned(),
                        entry_type: entry_type.to_string(),
                        size: stat.size,
                        modified_at: stat.mtime,
                    })
                })
                .collect::<Vec<_>>();
            entries.sort_by(|left, right| {
                let left_rank = if left.entry_type == "directory" { 0 } else { 1 };
                let right_rank = if right.entry_type == "directory" {
                    0
                } else {
                    1
                };
                left_rank
                    .cmp(&right_rank)
                    .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            });
            let truncated = entries.len() > MAX_REMOTE_LIST_ENTRIES;
            entries.truncate(MAX_REMOTE_LIST_ENTRIES);
            Ok(SshDirectoryListing {
                path: directory.to_string_lossy().into_owned(),
                entries,
                truncated,
            })
        })
    })
    .await
    .map_err(|error| format!("SSH 目录读取任务异常：{error}"))?
}

#[tauri::command]
pub async fn ssh_sftp_upload(
    profile: SshSftpProfile,
    remote_directory: String,
    local_paths: Vec<String>,
    overwrite: bool,
    app: AppHandle,
) -> Result<SshTransferResult, String> {
    if local_paths.is_empty() {
        return Err("请先通过本机文件选择器选择要上传的文件或目录".to_string());
    }
    let known_hosts = app_known_hosts_file(&app)?;
    tokio::task::spawn_blocking(move || {
        let local_paths = local_paths
            .iter()
            .map(|path| selected_local_path(path))
            .collect::<Result<Vec<_>, _>>()?;
        let mut preflight = TransferStats::default();
        for path in &local_paths {
            inspect_upload_path(path, 0, &mut preflight)?;
        }
        with_sftp(&profile, &known_hosts, |sftp| {
            let remote_directory = resolve_remote_directory(sftp, &remote_directory)?;
            let mut transferred = TransferStats::default();
            for local_path in &local_paths {
                upload_local_item(
                    sftp,
                    local_path,
                    &remote_directory,
                    overwrite,
                    &mut transferred,
                )?;
            }
            Ok(SshTransferResult {
                operation: "upload".to_string(),
                files: transferred.files,
                bytes: transferred.bytes,
                remote_path: remote_directory.to_string_lossy().into_owned(),
                local_path: None,
                message: format!(
                    "已上传 {} 个文件（{} B）",
                    transferred.files, transferred.bytes
                ),
            })
        })
        .map_err(|error| {
            format!(
                "上传未完成：{error}。如已开始传输，已写入的文件或目录不会自动回滚，请刷新远端目录核对。"
            )
        })
    })
    .await
    .map_err(|error| format!("SSH 上传任务异常：{error}"))?
}

#[tauri::command]
pub async fn ssh_sftp_download(
    profile: SshSftpProfile,
    remote_path: String,
    local_path: String,
    app: AppHandle,
) -> Result<SshTransferResult, String> {
    let known_hosts = app_known_hosts_file(&app)?;
    tokio::task::spawn_blocking(move || {
        with_sftp(&profile, &known_hosts, |sftp| {
            let remote_file = resolve_remote_file(sftp, &remote_path)?;
            download_file_to(sftp, &remote_file, Path::new(&local_path))
        })
    })
    .await
    .map_err(|error| format!("SSH 下载任务异常：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn password_profile() -> SshSftpProfile {
        SshSftpProfile {
            host: "192.168.30.66".to_string(),
            port: 22,
            username: "operator".to_string(),
            auth_method: SshAuthMethod::Password,
            password: Some("not-printed".to_string()),
            private_key_path: None,
            passphrase: None,
            timeout_ms: 8_000,
        }
    }

    #[test]
    fn ssh_profile_校验主机和认证资料但允许空密码() {
        assert!(validate_profile(&password_profile()).is_ok());
        let mut bad_url = password_profile();
        bad_url.host = "ssh://operator@192.168.30.66/path".to_string();
        assert!(validate_profile(&bad_url).is_err());
        let mut empty_password = password_profile();
        empty_password.password = Some(String::new());
        assert!(validate_profile(&empty_password).is_ok());
        let mut no_password_field = password_profile();
        no_password_field.password = None;
        assert!(validate_profile(&no_password_field).is_ok());
        let mut bad_timeout = password_profile();
        bad_timeout.timeout_ms = 100;
        assert!(validate_profile(&bad_timeout).is_err());
    }

    #[test]
    fn 非默认端口使用带端口的_known_hosts_名字() {
        assert_eq!(known_host_name(&password_profile()), "192.168.30.66");
        let mut custom_port = password_profile();
        custom_port.port = 2222;
        assert_eq!(known_host_name(&custom_port), "[192.168.30.66]:2222");
    }

    #[test]
    fn 前端驼峰连接资料可以映射到后端认证字段() {
        let profile: SshSftpProfile = serde_json::from_str(
            r#"{
                "host":"192.168.30.66",
                "port":2222,
                "username":"operator",
                "authMethod":"privateKey",
                "privateKeyPath":"/tmp/id_ed25519",
                "timeoutMs":8000
            }"#,
        )
        .expect("前端 SSH/SFTP 资料应可解析");

        assert!(matches!(profile.auth_method, SshAuthMethod::PrivateKey));
        assert_eq!(profile.private_key_path.as_deref(), Some("/tmp/id_ed25519"));
        assert_eq!(profile.timeout_ms, 8_000);
    }

    #[test]
    fn 远端临时上传文件与目标保持同一目录() {
        let target = Path::new("/srv/releases/firmware.bin");
        let staging = temporary_remote_path(target).expect("应能构造临时上传路径");
        assert_eq!(staging.parent(), Some(Path::new("/srv/releases")));
        assert_ne!(staging, target);
        assert!(staging
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(".np-tools-upload-")));
    }
}
