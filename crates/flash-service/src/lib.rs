use app_types::{FlashProgressEvent, FlashToolInfo, StLinkProbe};
use regex::Regex;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

static RE_PROBE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)ST-LINK\s+Probe\s+(\d+)\s+:\s*([0-9A-Za-z]+)").unwrap()
});

static RE_PERCENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(\d+)\s*%").unwrap()
});

static RE_PROGRESS_BAR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\[[=\->\s#█▒░▓■□\.\+]*\]\s*(\d+%)").unwrap()
});

static RE_ANSI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\x1B\[[0-9;?]*[a-zA-Z]").unwrap()
});

fn clean_cli_text(input: &str) -> String {
    let no_ansi = RE_ANSI.replace_all(input, "");
    let mut cleaned = String::with_capacity(no_ansi.len());
    for c in no_ansi.chars() {
        if c == '\t' || (c >= ' ' && c != '\x7F') || (!c.is_ascii() && !c.is_control()) {
            cleaned.push(c);
        }
    }
    let trimmed = cleaned.trim();
    if let Some(caps) = RE_PROGRESS_BAR.captures(trimmed) {
        return format!("正在传输数据进度: {}", &caps[1]);
    }
    trimmed.to_string()
}

pub struct FlashManager {
    cancel_flag: Arc<AtomicBool>,
}

impl FlashManager {
    pub fn new() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancel_flag.store(true, Ordering::SeqCst);
    }

    pub fn get_cancel_flag(&self) -> Arc<AtomicBool> {
        self.cancel_flag.clone()
    }
}

impl Default for FlashManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Detects the path to STM32_Programmer_CLI on the host machine.
pub fn find_programmer_cli(custom_path: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom_path {
        let p = Path::new(custom);
        if p.is_file() {
            return Some(p.to_path_buf());
        }
    }

    if let Ok(env_path) = std::env::var("STM32_PROGRAMMER_CLI") {
        let p = Path::new(&env_path);
        if p.is_file() {
            return Some(p.to_path_buf());
        }
    }

    // Common macOS Paths
    #[cfg(target_os = "macos")]
    {
        let mac_paths = [
            "/Applications/STMicroelectronics/STM32Cube/STM32CubeProgrammer/STM32CubeProgrammer.app/Contents/MacOs/bin/STM32_Programmer_CLI",
            "/Applications/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI",
        ];
        for path_str in mac_paths {
            let p = Path::new(path_str);
            if p.is_file() {
                return Some(p.to_path_buf());
            }
        }

        if let Ok(home) = std::env::var("HOME") {
            let glob_dir = format!("{}/Library/Application Support/stm32cube/bundles/programmer", home);
            if let Ok(entries) = std::fs::read_dir(&glob_dir) {
                for entry in entries.flatten() {
                    let cli_path = entry.path().join("bin").join("STM32_Programmer_CLI");
                    if cli_path.is_file() {
                        return Some(cli_path);
                    }
                }
            }
        }
    }

    // Common Windows Paths
    #[cfg(target_os = "windows")]
    {
        let win_paths = [
            r"C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe",
            r"C:\Program Files (x86)\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin\STM32_Programmer_CLI.exe",
        ];
        for path_str in win_paths {
            let p = Path::new(path_str);
            if p.is_file() {
                return Some(p.to_path_buf());
            }
        }
    }

    // Standard PATH lookup
    if let Ok(path) = which::which("STM32_Programmer_CLI") {
        return Some(path);
    }

    None
}

/// Probes the STM32CubeProgrammer tool and enumerates connected ST-Link probes.
pub async fn probe_tool_and_devices(custom_cli: Option<String>) -> FlashToolInfo {
    let cli_path = find_programmer_cli(custom_cli.as_deref());
    let Some(cli) = cli_path else {
        return FlashToolInfo {
            cli_path: None,
            is_available: false,
            version: None,
            probes: Vec::new(),
        };
    };

    let cli_str = cli.to_string_lossy().to_string();

    // Query CLI version / info
    let version_output = Command::new(&cli)
        .arg("--version")
        .output()
        .await
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.lines().next().unwrap_or("").trim().to_string());

    // Enumerate ST-Link probes
    let mut probes = Vec::new();
    if let Ok(probe_out) = Command::new(&cli).args(["-l", "stlink"]).output().await {
        if let Ok(text) = String::from_utf8(probe_out.stdout) {
            for line in text.lines() {
                if let Some(caps) = RE_PROBE.captures(line) {
                    if let Ok(idx) = caps[1].parse::<u32>() {
                        let sn = caps[2].to_string();
                        probes.push(StLinkProbe {
                            index: idx,
                            serial_number: sn.clone(),
                            description: format!("ST-Link Probe #{} (SN: {})", idx, sn),
                        });
                    }
                }
            }
        }
    }

    FlashToolInfo {
        cli_path: Some(cli_str),
        is_available: true,
        version: version_output,
        probes,
    }
}

/// Executes firmware flashing and streams progress events.
pub async fn execute_flash(
    cli_path: &str,
    hex_path: &str,
    probe_sn: Option<String>,
    progress_tx: mpsc::Sender<FlashProgressEvent>,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    cancel_flag.store(false, Ordering::SeqCst);

    let hex = Path::new(hex_path);
    if !hex.is_file() {
        let _ = progress_tx
            .send(FlashProgressEvent {
                state: "error".into(),
                percent: 0,
                message: format!("固件文件不存在: {}", hex_path),
                is_terminal: true,
            })
            .await;
        return Err(format!("固件文件不存在: {}", hex_path));
    }

    let mut conn_str = "port=SWD mode=UR freq=4000".to_string();
    if let Some(sn) = &probe_sn {
        if !sn.trim().is_empty() {
            conn_str.push_str(&format!(" sn={}", sn.trim()));
        }
    }

    let _ = progress_tx
        .send(FlashProgressEvent {
            state: "probing".into(),
            percent: 5,
            message: format!("正在连接 ST-Link (参数: {})...", conn_str),
            is_terminal: false,
        })
        .await;

    let mut cmd = Command::new(cli_path);
    cmd.args(["-c", &conn_str, "-d", hex_path, "-v", "-rst"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动烧录进程失败: {}", e))?;

    let stdout = child.stdout.take().ok_or("无法捕获标准输出")?;
    let stderr = child.stderr.take().ok_or("无法捕获错误输出")?;

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    let mut current_state = "connecting".to_string();
    let mut current_percent: u8 = 10;

    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            let _ = progress_tx
                .send(FlashProgressEvent {
                    state: "error".into(),
                    percent: current_percent,
                    message: "用户已取消烧录任务".into(),
                    is_terminal: true,
                })
                .await;
            return Err("用户取消".into());
        }

        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        let cleaned = clean_cli_text(&text);
                        if cleaned.is_empty() {
                            continue;
                        }

                        // Parse State & Percent
                        if cleaned.contains("Memory Programming") || cleaned.contains("Download in Progress") {
                            current_state = "programming".into();
                            current_percent = current_percent.max(20);
                        } else if cleaned.contains("Verifying") || cleaned.contains("Verify") {
                            current_state = "verifying".into();
                            current_percent = current_percent.max(75);
                        } else if cleaned.contains("Erasing") || cleaned.contains("Mass erase") {
                            current_state = "erasing".into();
                            current_percent = current_percent.max(15);
                        } else if cleaned.contains("File download complete") || cleaned.contains("Download verified successfully") {
                            current_state = "verifying".into();
                            current_percent = 95;
                        } else if cleaned.contains("Application is running") || cleaned.contains("Software reset") {
                            current_state = "success".into();
                            current_percent = 100;
                        }

                        if let Some(caps) = RE_PERCENT.captures(&cleaned) {
                            if let Ok(pct) = caps[1].parse::<u8>() {
                                if current_state == "programming" {
                                    // Scale 20% ~ 70%
                                    current_percent = 20 + (pct as f32 * 0.5) as u8;
                                } else if current_state == "verifying" {
                                    // Scale 75% ~ 95%
                                    current_percent = 75 + (pct as f32 * 0.2) as u8;
                                }
                            }
                        }

                        let is_err = cleaned.contains("Error:") || cleaned.contains("ST-LINK error");
                        if is_err {
                            current_state = "error".into();
                        }

                        let _ = progress_tx.send(FlashProgressEvent {
                            state: current_state.clone(),
                            percent: current_percent,
                            message: cleaned,
                            is_terminal: false,
                        }).await;
                    }
                    Ok(None) => break,
                    Err(e) => {
                        let _ = progress_tx.send(FlashProgressEvent {
                            state: "error".into(),
                            percent: current_percent,
                            message: format!("读取输出失败: {}", e),
                            is_terminal: true,
                        }).await;
                        break;
                    }
                }
            }
            err_line = stderr_reader.next_line() => {
                if let Ok(Some(text)) = err_line {
                    let cleaned = clean_cli_text(&text);
                    if !cleaned.is_empty() {
                        let _ = progress_tx.send(FlashProgressEvent {
                            state: "error".into(),
                            percent: current_percent,
                            message: cleaned,
                            is_terminal: false,
                        }).await;
                    }
                }
            }
            status = child.wait() => {
                match status {
                    Ok(s) if s.success() => {
                        let _ = progress_tx.send(FlashProgressEvent {
                            state: "success".into(),
                            percent: 100,
                            message: "固件烧录并校验成功，设备已复位运行！".into(),
                            is_terminal: true,
                        }).await;
                        return Ok(());
                    }
                    Ok(s) => {
                        let _ = progress_tx.send(FlashProgressEvent {
                            state: "error".into(),
                            percent: current_percent,
                            message: format!("烧录失败 (退出码: {:?})", s.code()),
                            is_terminal: true,
                        }).await;
                        return Err(format!("烧录失败 (退出码: {:?})", s.code()));
                    }
                    Err(e) => {
                        let _ = progress_tx.send(FlashProgressEvent {
                            state: "error".into(),
                            percent: current_percent,
                            message: format!("等待进程异常: {}", e),
                            is_terminal: true,
                        }).await;
                        return Err(format!("等待进程异常: {}", e));
                    }
                }
            }
        }
    }

    Ok(())
}
