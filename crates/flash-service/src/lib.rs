use app_types::{
    FlashImageInspection, FlashProductProfile, FlashProgressEvent, FlashTargetInfo, FlashToolInfo,
    StLinkProbe,
};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::mpsc;

static RE_PROBE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)ST-LINK\s+Probe\s+(\d+)\s+:\s*([0-9A-Za-z]+)").unwrap());

static RE_PERCENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\d+)\s*%").unwrap());

static RE_PROGRESS_BAR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[[=\->\s#█▒░▓■□\.\+\u{FFFD}]*\]\s*(\d+%)").unwrap());

static RE_ANSI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1B\[[0-9;?]*[a-zA-Z]").unwrap());

static RE_DEVICE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?im)Device\s*ID\s*:\s*(0x[0-9a-f]+)").unwrap());

static RE_DEVICE_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?im)Device\s*name\s*:\s*([^\r\n]+)").unwrap());

const XTQ_APP_BASE: u32 = 0x0802_0000;
const XTQ_MANIFEST_SIZE: usize = 64;
const XTQ_MANIFEST_MAGIC: u32 = 0x4251_5458;
const XTQ_MANIFEST_VERSION: u16 = 1;
const XTQ_MANIFEST_COMMIT: u32 = 0xA5C3_5A3C;

#[derive(Clone, Copy)]
struct FlashProfileDefinition {
    id: &'static str,
    label: &'static str,
    mcu: &'static str,
    image_kind: &'static str,
    flash_start: u32,
    flash_end_exclusive: u32,
    expected_device_id: u32,
    expected_manifest_target: Option<u32>,
    main_sram_end: u32,
    supports_sjzd_sn_pipeline: bool,
    safety_note: &'static str,
}

const FLASH_PROFILES: &[FlashProfileDefinition] = &[
    FlashProfileDefinition {
        id: "sjzdv3_f412",
        label: "SJZDV3 · STM32F412RET6",
        mcu: "STM32F412RET6 / Device ID 0x441",
        image_kind: "完整应用 HEX",
        flash_start: 0x0800_0000,
        flash_end_exclusive: 0x0808_0000,
        expected_device_id: 0x441,
        expected_manifest_target: None,
        main_sram_end: 0x2004_0000,
        supports_sjzd_sn_pipeline: true,
        safety_note: "仅接受从 0x08000000 起始的带地址 HEX；烧录前后均不执行 Mass Erase。",
    },
    FlashProfileDefinition {
        id: "xtq_f407_app",
        label: "XTQ 协调器 · F407 APP",
        mcu: "STM32F407VGT6 / Device ID 0x413",
        image_kind: "packaged APP HEX",
        flash_start: XTQ_APP_BASE,
        flash_end_exclusive: 0x0808_0000,
        expected_device_id: 0x413,
        expected_manifest_target: Some(0x0000_0407),
        main_sram_end: 0x2002_0000,
        supports_sjzd_sn_pipeline: false,
        safety_note: "只允许含 manifest 的 APP HEX；Boot、同步存储区和 Mass Erase 均不在此流程内。",
    },
    FlashProfileDefinition {
        id: "xtq_f427_app",
        label: "XTQ 协调器 · F427 APP",
        mcu: "STM32F427VGT6 / Device ID 0x419",
        image_kind: "packaged APP HEX",
        flash_start: XTQ_APP_BASE,
        flash_end_exclusive: 0x0808_0000,
        expected_device_id: 0x419,
        expected_manifest_target: Some(0x0000_0427),
        main_sram_end: 0x2003_0000,
        supports_sjzd_sn_pipeline: false,
        safety_note: "只允许含 manifest 的 APP HEX；Boot、同步存储区和 Mass Erase 均不在此流程内。",
    },
    FlashProfileDefinition {
        id: "kz3_f427_app",
        label: "KZ3 控制器 · F427 APP",
        mcu: "STM32F427VGT6 / Device ID 0x419",
        image_kind: "应用 HEX",
        flash_start: XTQ_APP_BASE,
        flash_end_exclusive: 0x0808_0000,
        expected_device_id: 0x419,
        expected_manifest_target: None,
        main_sram_end: 0x2003_0000,
        supports_sjzd_sn_pipeline: false,
        safety_note: "仅接受 0x08020000..0x0807FFFF 的带地址 APP HEX，不覆盖既有 Bootloader。",
    },
];

#[derive(Debug)]
struct ParsedIhex {
    memory: BTreeMap<u32, u8>,
    data_record_count: u32,
}

fn find_flash_profile(profile_id: &str) -> Result<&'static FlashProfileDefinition, String> {
    FLASH_PROFILES
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("不支持的烧录产品档案: {}", profile_id))
}

fn public_profile(profile: &FlashProfileDefinition) -> FlashProductProfile {
    FlashProductProfile {
        id: profile.id.to_string(),
        label: profile.label.to_string(),
        mcu: profile.mcu.to_string(),
        image_kind: profile.image_kind.to_string(),
        flash_start: profile.flash_start,
        flash_end_exclusive: profile.flash_end_exclusive,
        expected_device_id: profile.expected_device_id,
        requires_xtq_manifest: profile.expected_manifest_target.is_some(),
        supports_sjzd_sn_pipeline: profile.supports_sjzd_sn_pipeline,
        safety_note: profile.safety_note.to_string(),
    }
}

/// 返回由后端固定维护的烧录产品档案，调用方不能提交自定义地址范围。
pub fn list_product_profiles() -> Vec<FlashProductProfile> {
    FLASH_PROFILES.iter().map(public_profile).collect()
}

fn hex_nibble(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(format!("包含非十六进制字符: 0x{value:02X}")),
    }
}

fn decode_hex_pair(line: &[u8], offset: usize) -> Result<u8, String> {
    let high = *line
        .get(offset)
        .ok_or_else(|| "HEX 记录长度不足".to_string())?;
    let low = *line
        .get(offset + 1)
        .ok_or_else(|| "HEX 记录长度不足".to_string())?;
    Ok((hex_nibble(high)? << 4) | hex_nibble(low)?)
}

fn parse_ihex_bytes(input: &[u8]) -> Result<ParsedIhex, String> {
    let mut memory = BTreeMap::new();
    let mut upper_address = 0u32;
    let mut eof_seen = false;
    let mut data_record_count = 0u32;
    let mut non_empty_line_seen = false;

    for (line_index, raw_line) in input.split(|byte| *byte == b'\n').enumerate() {
        let line = if raw_line.last() == Some(&b'\r') {
            &raw_line[..raw_line.len() - 1]
        } else {
            raw_line
        };
        if line.is_empty() {
            continue;
        }
        non_empty_line_seen = true;
        let line_number = line_index + 1;
        if eof_seen {
            return Err(format!("HEX 第 {line_number} 行位于 EOF 记录之后"));
        }
        if line.first() != Some(&b':') {
            return Err(format!("HEX 第 {line_number} 行缺少 ':' 起始符"));
        }
        if line.len() < 11 || line.len() % 2 == 0 {
            return Err(format!("HEX 第 {line_number} 行长度非法"));
        }

        let data_length = usize::from(
            decode_hex_pair(line, 1)
                .map_err(|error| format!("HEX 第 {line_number} 行字节数错误: {error}"))?,
        );
        let expected_length = 11 + data_length * 2;
        if line.len() != expected_length {
            return Err(format!(
                "HEX 第 {line_number} 行长度与记录字节数不一致: 声明 {data_length} B"
            ));
        }

        let mut record = Vec::with_capacity(data_length + 5);
        for byte_index in 0..(data_length + 5) {
            record.push(
                decode_hex_pair(line, 1 + byte_index * 2)
                    .map_err(|error| format!("HEX 第 {line_number} 行编码错误: {error}"))?,
            );
        }
        if record.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte)) != 0 {
            return Err(format!("HEX 第 {line_number} 行校验和错误"));
        }

        let address = u32::from(u16::from_be_bytes([record[1], record[2]]));
        let record_type = record[3];
        let data = &record[4..4 + data_length];
        match record_type {
            0x00 => {
                let start = upper_address
                    .checked_add(address)
                    .ok_or_else(|| format!("HEX 第 {line_number} 行数据地址溢出"))?;
                for (offset, value) in data.iter().enumerate() {
                    let absolute_address = start
                        .checked_add(offset as u32)
                        .ok_or_else(|| format!("HEX 第 {line_number} 行数据地址溢出"))?;
                    if memory.insert(absolute_address, *value).is_some() {
                        return Err(format!(
                            "HEX 第 {line_number} 行重复定义地址 0x{absolute_address:08X}"
                        ));
                    }
                }
                data_record_count = data_record_count.saturating_add(1);
            }
            0x01 => {
                if !data.is_empty() || address != 0 {
                    return Err(format!("HEX 第 {line_number} 行 EOF 记录格式错误"));
                }
                eof_seen = true;
            }
            0x02 => {
                if data.len() != 2 || address != 0 {
                    return Err(format!("HEX 第 {line_number} 行扩展段地址记录格式错误"));
                }
                upper_address = u32::from(u16::from_be_bytes([data[0], data[1]])) << 4;
            }
            0x04 => {
                if data.len() != 2 || address != 0 {
                    return Err(format!("HEX 第 {line_number} 行扩展线性地址记录格式错误"));
                }
                upper_address = u32::from(u16::from_be_bytes([data[0], data[1]])) << 16;
            }
            0x03 | 0x05 => {
                if data.len() != 4 || address != 0 {
                    return Err(format!("HEX 第 {line_number} 行启动地址记录格式错误"));
                }
            }
            _ => {
                return Err(format!(
                    "HEX 第 {line_number} 行包含不支持的记录类型 0x{record_type:02X}"
                ));
            }
        }
    }

    if !non_empty_line_seen {
        return Err("HEX 文件为空".to_string());
    }
    if !eof_seen {
        return Err("HEX 缺少 EOF 记录".to_string());
    }
    if memory.is_empty() {
        return Err("HEX 不包含可烧录数据".to_string());
    }

    Ok(ParsedIhex {
        memory,
        data_record_count,
    })
}

fn required_memory_bytes(
    memory: &BTreeMap<u32, u8>,
    start: u32,
    length: usize,
    field_name: &str,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(length);
    for offset in 0..length {
        let address = start
            .checked_add(offset as u32)
            .ok_or_else(|| format!("{field_name} 地址溢出"))?;
        let value = memory
            .get(&address)
            .copied()
            .ok_or_else(|| format!("HEX 缺少 {field_name} 地址 0x{address:08X} 的数据"))?;
        bytes.push(value);
    }
    Ok(bytes)
}

fn read_u16_le(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32_le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn crc32_iso_hdlc(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn validate_vector_bytes(
    bytes: &[u8],
    profile: &FlashProfileDefinition,
    image_start: u32,
    image_end_exclusive: u32,
) -> Result<(), String> {
    if bytes.len() < 8 {
        return Err("镜像不足 8 B，缺少 Cortex-M 向量表".to_string());
    }
    let initial_msp = read_u32_le(bytes, 0);
    let reset_handler = read_u32_le(bytes, 4);
    let msp_in_main_sram = initial_msp > 0x2000_0000 && initial_msp <= profile.main_sram_end;
    let msp_in_ccm_sram = initial_msp > 0x1000_0000 && initial_msp <= 0x1001_0000;
    if initial_msp & 0x7 != 0 || !(msp_in_main_sram || msp_in_ccm_sram) {
        return Err(format!(
            "初始 MSP 不属于 {} 的可用 SRAM: 0x{initial_msp:08X}",
            profile.mcu
        ));
    }
    let reset_address = reset_handler & !1;
    if reset_handler & 1 == 0 || reset_address < image_start || reset_address >= image_end_exclusive
    {
        return Err(format!(
            "Reset_Handler 不属于镜像地址范围: 0x{reset_handler:08X}"
        ));
    }
    Ok(())
}

fn validate_xtq_manifest(
    profile: &FlashProfileDefinition,
    parsed: &ParsedIhex,
) -> Result<(u32, u32), String> {
    let expected_target = profile
        .expected_manifest_target
        .ok_or_else(|| "内部错误：XTQ 档案缺少 manifest target".to_string())?;
    let manifest_address = profile.flash_end_exclusive - XTQ_MANIFEST_SIZE as u32;
    let manifest = required_memory_bytes(
        &parsed.memory,
        manifest_address,
        XTQ_MANIFEST_SIZE,
        "XTQ manifest",
    )?;
    let magic = read_u32_le(&manifest, 0);
    let version = read_u16_le(&manifest, 4);
    let header_size = read_u16_le(&manifest, 6);
    let target_id = read_u32_le(&manifest, 8);
    let image_start = read_u32_le(&manifest, 12);
    let image_size = read_u32_le(&manifest, 16);
    let image_crc = read_u32_le(&manifest, 20);
    let header_crc = read_u32_le(&manifest, 56);
    let commit_word = read_u32_le(&manifest, 60);

    if magic != XTQ_MANIFEST_MAGIC {
        return Err("XTQ APP HEX 缺少有效 manifest；禁止烧录原始 APP HEX".to_string());
    }
    if version != XTQ_MANIFEST_VERSION || usize::from(header_size) != XTQ_MANIFEST_SIZE {
        return Err("XTQ APP manifest 版本或长度错误".to_string());
    }
    if target_id != expected_target {
        return Err(format!(
            "XTQ APP manifest target=0x{target_id:08X}，与所选档案不一致"
        ));
    }
    let max_image_size = manifest_address - XTQ_APP_BASE;
    if image_start != XTQ_APP_BASE || !(8..=max_image_size).contains(&image_size) {
        return Err("XTQ APP manifest 镜像地址或长度错误".to_string());
    }
    if manifest[52..56].iter().any(|value| *value != 0) {
        return Err("XTQ APP manifest 保留字段不是全 0".to_string());
    }
    if crc32_iso_hdlc(&manifest[..56]) != header_crc {
        return Err("XTQ APP manifest header CRC 错误".to_string());
    }
    if commit_word != XTQ_MANIFEST_COMMIT {
        return Err("XTQ APP manifest commit word 错误".to_string());
    }

    let image = required_memory_bytes(
        &parsed.memory,
        XTQ_APP_BASE,
        image_size as usize,
        "XTQ APP 镜像",
    )?;
    if crc32_iso_hdlc(&image) != image_crc {
        return Err("XTQ APP 镜像 CRC 与 manifest 不一致".to_string());
    }
    validate_vector_bytes(&image, profile, XTQ_APP_BASE, XTQ_APP_BASE + image_size)?;
    Ok((target_id, image_size))
}

fn inspect_parsed_image(
    profile: &FlashProfileDefinition,
    parsed: ParsedIhex,
    file_path: &str,
    file_sha256: String,
) -> Result<FlashImageInspection, String> {
    let address_start = *parsed
        .memory
        .first_key_value()
        .map(|(address, _)| address)
        .ok_or_else(|| "HEX 不包含可烧录数据".to_string())?;
    let address_end_inclusive = *parsed
        .memory
        .last_key_value()
        .map(|(address, _)| address)
        .ok_or_else(|| "HEX 不包含可烧录数据".to_string())?;
    if address_start != profile.flash_start {
        return Err(format!(
            "{} 镜像必须从 0x{:08X} 起始，实际为 0x{address_start:08X}",
            profile.label, profile.flash_start
        ));
    }
    if address_end_inclusive >= profile.flash_end_exclusive {
        return Err(format!(
            "镜像地址 0x{address_end_inclusive:08X} 超出 {} 的允许范围 0x{:08X}..0x{:08X}",
            profile.label,
            profile.flash_start,
            profile.flash_end_exclusive - 1
        ));
    }

    let vector = required_memory_bytes(&parsed.memory, profile.flash_start, 8, "向量表")?;
    validate_vector_bytes(
        &vector,
        profile,
        profile.flash_start,
        profile.flash_end_exclusive,
    )?;

    let (manifest_target_id, manifest_image_size) = if profile.expected_manifest_target.is_some() {
        let (target_id, image_size) = validate_xtq_manifest(profile, &parsed)?;
        (Some(target_id), Some(image_size))
    } else {
        (None, None)
    };

    Ok(FlashImageInspection {
        profile_id: profile.id.to_string(),
        file_path: file_path.to_string(),
        file_sha256,
        address_start,
        address_end_inclusive,
        data_record_count: parsed.data_record_count,
        data_byte_count: parsed.memory.len() as u64,
        manifest_target_id,
        manifest_image_size,
        validated: true,
        message: format!(
            "镜像已通过 {} 档案校验：地址范围 0x{address_start:08X}..0x{address_end_inclusive:08X}",
            profile.label
        ),
    })
}

/// 对固件镜像作离线强校验。只接受带地址 Intel HEX，不接受 BIN 或 ELF。
pub fn inspect_flash_image(
    profile_id: &str,
    hex_path: &str,
) -> Result<FlashImageInspection, String> {
    let profile = find_flash_profile(profile_id)?;
    let path = Path::new(hex_path);
    if !path.is_file() {
        return Err(format!("固件文件不存在: {hex_path}"));
    }
    let content = std::fs::read(path).map_err(|error| format!("读取固件文件失败: {error}"))?;
    let parsed = parse_ihex_bytes(&content)?;
    let digest = format!("{:x}", Sha256::digest(&content));
    inspect_parsed_image(profile, parsed, hex_path, digest)
}

enum ProcessOutput {
    Stdout(String),
    Stderr(String),
}

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
            let glob_dir = format!(
                "{}/Library/Application Support/stm32cube/bundles/programmer",
                home
            );
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

    // Common Linux Paths
    #[cfg(target_os = "linux")]
    {
        let linux_paths = [
            "/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI",
            "/opt/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI",
        ];
        for path_str in linux_paths {
            let p = Path::new(path_str);
            if p.is_file() {
                return Some(p.to_path_buf());
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
    let mut cmd_ver = Command::new(&cli);
    cmd_ver.arg("--version");
    #[cfg(target_os = "windows")]
    cmd_ver.creation_flags(0x08000000);

    let version_output = cmd_ver.output().await.ok().map(|out| {
        let text = String::from_utf8_lossy(&out.stdout);
        text.lines().next().unwrap_or("").trim().to_string()
    });

    // Enumerate ST-Link probes
    let mut probes = Vec::new();
    let mut cmd_probe = Command::new(&cli);
    cmd_probe.args(["-l", "stlink"]);
    #[cfg(target_os = "windows")]
    cmd_probe.creation_flags(0x08000000);

    if let Ok(probe_out) = cmd_probe.output().await {
        let text = String::from_utf8_lossy(&probe_out.stdout);
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

    FlashToolInfo {
        cli_path: Some(cli_str),
        is_available: true,
        version: version_output,
        probes,
    }
}

fn build_connection_string(probe_sn: Option<&str>) -> String {
    let mut connection = "port=SWD mode=UR freq=4000".to_string();
    if let Some(serial_number) = probe_sn {
        if !serial_number.trim().is_empty() {
            connection.push_str(&format!(" sn={}", serial_number.trim()));
        }
    }
    connection
}

fn summarize_cli_output(raw: &str) -> String {
    let lines: Vec<String> = raw
        .lines()
        .map(clean_cli_text)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect();
    if lines.is_empty() {
        "未返回可解析的诊断文本".to_string()
    } else {
        lines.join("；")
    }
}

/// 使用与实际烧录相同的 Under Reset 连接参数读取目标 MCU 身份。
pub async fn probe_flash_target(
    cli_path: &str,
    profile_id: &str,
    probe_sn: Option<String>,
) -> Result<FlashTargetInfo, String> {
    let profile = find_flash_profile(profile_id)?;
    let connection = build_connection_string(probe_sn.as_deref());
    let mut command = Command::new(cli_path);
    command.arg("-c").arg(&connection);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let output = tokio::time::timeout(Duration::from_secs(15), command.output())
        .await
        .map_err(|_| "读取目标 MCU 身份超时（15 秒）".to_string())?
        .map_err(|error| format!("启动目标 MCU 探测失败: {error}"))?;
    let raw = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(format!(
            "ST-Link 目标探测失败（退出码: {:?}）：{}",
            output.status.code(),
            summarize_cli_output(&raw)
        ));
    }

    let device_id = RE_DEVICE_ID
        .captures(&raw)
        .and_then(|captures| u32::from_str_radix(&captures[1][2..], 16).ok());
    let device_name = RE_DEVICE_NAME
        .captures(&raw)
        .map(|captures| captures[1].trim().to_string());
    let is_compatible = device_id == Some(profile.expected_device_id);
    let message = match device_id {
        Some(actual) if is_compatible => format!(
            "目标 MCU 已匹配：Device ID 0x{actual:03X}，可使用 {} 档案。",
            profile.label
        ),
        Some(actual) => format!(
            "目标 MCU Device ID 为 0x{actual:03X}，但 {} 要求 0x{:03X}；已禁止烧录。",
            profile.label, profile.expected_device_id
        ),
        None => format!(
            "未从 STM32CubeProgrammer 输出解析到 Device ID；为避免误烧录，已禁止继续。{}",
            summarize_cli_output(&raw)
        ),
    };

    Ok(FlashTargetInfo {
        profile_id: profile.id.to_string(),
        device_id,
        device_name,
        is_compatible,
        message,
    })
}

async fn read_stream_lines<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    mut reader: R,
    tx: mpsc::Sender<ProcessOutput>,
    is_stderr: bool,
) {
    let mut buf = [0u8; 1024];
    let mut line_buf = Vec::new();

    while let Ok(n) = reader.read(&mut buf).await {
        if n == 0 {
            break;
        }
        for &b in &buf[..n] {
            if b == b'\n' || b == b'\r' {
                if !line_buf.is_empty() {
                    let line = String::from_utf8_lossy(&line_buf).to_string();
                    let msg = if is_stderr {
                        ProcessOutput::Stderr(line)
                    } else {
                        ProcessOutput::Stdout(line)
                    };
                    if tx.send(msg).await.is_err() {
                        return;
                    }
                    line_buf.clear();
                }
            } else {
                line_buf.push(b);
            }
        }
    }

    if !line_buf.is_empty() {
        let line = String::from_utf8_lossy(&line_buf).to_string();
        let msg = if is_stderr {
            ProcessOutput::Stderr(line)
        } else {
            ProcessOutput::Stdout(line)
        };
        let _ = tx.send(msg).await;
    }
}

/// Executes firmware flashing and streams progress events.
pub async fn execute_flash(
    cli_path: &str,
    profile_id: &str,
    hex_path: &str,
    probe_sn: Option<String>,
    progress_tx: mpsc::Sender<FlashProgressEvent>,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    cancel_flag.store(false, Ordering::SeqCst);

    let profile = match find_flash_profile(profile_id) {
        Ok(profile) => profile,
        Err(error) => {
            let _ = progress_tx
                .send(FlashProgressEvent {
                    state: "error".into(),
                    percent: 0,
                    message: error.clone(),
                    is_terminal: true,
                })
                .await;
            return Err(error);
        }
    };
    let inspection = match inspect_flash_image(profile_id, hex_path) {
        Ok(inspection) => inspection,
        Err(error) => {
            let _ = progress_tx
                .send(FlashProgressEvent {
                    state: "error".into(),
                    percent: 0,
                    message: format!("烧录前镜像校验失败: {error}"),
                    is_terminal: true,
                })
                .await;
            return Err(error);
        }
    };
    let _ = progress_tx
        .send(FlashProgressEvent {
            state: "probing".into(),
            percent: 3,
            message: format!(
                "镜像校验通过：SHA-256 {}，准备核验目标 MCU。",
                inspection.file_sha256
            ),
            is_terminal: false,
        })
        .await;

    let target = match probe_flash_target(cli_path, profile_id, probe_sn.clone()).await {
        Ok(target) => target,
        Err(error) => {
            let _ = progress_tx
                .send(FlashProgressEvent {
                    state: "error".into(),
                    percent: 3,
                    message: error.clone(),
                    is_terminal: true,
                })
                .await;
            return Err(error);
        }
    };
    if !target.is_compatible {
        let _ = progress_tx
            .send(FlashProgressEvent {
                state: "error".into(),
                percent: 3,
                message: target.message.clone(),
                is_terminal: true,
            })
            .await;
        return Err(target.message);
    }

    let conn_str = build_connection_string(probe_sn.as_deref());

    let _ = progress_tx
        .send(FlashProgressEvent {
            state: "probing".into(),
            percent: 5,
            message: format!(
                "目标 MCU 与 {} 已匹配，正在连接 ST-Link (参数: {})...",
                profile.label, conn_str
            ),
            is_terminal: false,
        })
        .await;

    let mut cmd = Command::new(cli_path);
    cmd.args(["-c", &conn_str, "-d", hex_path, "-v", "-rst"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动烧录进程失败: {}", e))?;

    let stdout = child.stdout.take().ok_or("无法捕获标准输出")?;
    let stderr = child.stderr.take().ok_or("无法捕获错误输出")?;

    let (out_tx, mut out_rx) = mpsc::channel::<ProcessOutput>(128);

    let stdout_tx = out_tx.clone();
    tokio::spawn(read_stream_lines(stdout, stdout_tx, false));

    let stderr_tx = out_tx;
    tokio::spawn(read_stream_lines(stderr, stderr_tx, true));

    let mut current_state = "connecting".to_string();
    let mut current_percent: u8 = 10;
    let mut exit_status = None;

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
            output = out_rx.recv() => {
                match output {
                    Some(ProcessOutput::Stdout(text)) => {
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
                    Some(ProcessOutput::Stderr(text)) => {
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
                    None => {
                        break;
                    }
                }
            }
            status = child.wait(), if exit_status.is_none() => {
                match status {
                    Ok(s) => {
                        exit_status = Some(s);
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

    let status = match exit_status {
        Some(s) => s,
        None => child
            .wait()
            .await
            .map_err(|e| format!("等待进程异常: {}", e))?,
    };

    if status.success() {
        let _ = progress_tx
            .send(FlashProgressEvent {
                state: "success".into(),
                percent: 100,
                message: "固件烧录并校验成功，设备已复位运行！".into(),
                is_terminal: true,
            })
            .await;
        Ok(())
    } else {
        let _ = progress_tx
            .send(FlashProgressEvent {
                state: "error".into(),
                percent: current_percent,
                message: format!("烧录失败 (退出码: {:?})", status.code()),
                is_terminal: true,
            })
            .await;
        Err(format!("烧录失败 (退出码: {:?})", status.code()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ihex_record(address: u16, record_type: u8, data: &[u8]) -> String {
        let mut bytes = Vec::with_capacity(data.len() + 5);
        bytes.push(data.len() as u8);
        bytes.extend_from_slice(&address.to_be_bytes());
        bytes.push(record_type);
        bytes.extend_from_slice(data);
        let checksum = bytes
            .iter()
            .fold(0u8, |sum, byte| sum.wrapping_add(*byte))
            .wrapping_neg();
        bytes.push(checksum);
        format!(
            ":{}",
            bytes
                .iter()
                .map(|byte| format!("{byte:02X}"))
                .collect::<String>()
        )
    }

    fn append_data_records(output: &mut String, address: u16, data: &[u8]) {
        for (offset, chunk) in data.chunks(16).enumerate() {
            output.push_str(&ihex_record(address + (offset * 16) as u16, 0x00, chunk));
            output.push('\n');
        }
    }

    fn xtq_packaged_fixture(target_id: u32) -> Vec<u8> {
        let image = [0x00, 0x00, 0x01, 0x20, 0x05, 0x00, 0x02, 0x08];
        let mut manifest = [0u8; XTQ_MANIFEST_SIZE];
        manifest[0..4].copy_from_slice(&XTQ_MANIFEST_MAGIC.to_le_bytes());
        manifest[4..6].copy_from_slice(&XTQ_MANIFEST_VERSION.to_le_bytes());
        manifest[6..8].copy_from_slice(&(XTQ_MANIFEST_SIZE as u16).to_le_bytes());
        manifest[8..12].copy_from_slice(&target_id.to_le_bytes());
        manifest[12..16].copy_from_slice(&XTQ_APP_BASE.to_le_bytes());
        manifest[16..20].copy_from_slice(&(image.len() as u32).to_le_bytes());
        manifest[20..24].copy_from_slice(&crc32_iso_hdlc(&image).to_le_bytes());
        let header_crc = crc32_iso_hdlc(&manifest[..56]);
        manifest[56..60].copy_from_slice(&header_crc.to_le_bytes());
        manifest[60..64].copy_from_slice(&XTQ_MANIFEST_COMMIT.to_le_bytes());

        let mut output = String::new();
        output.push_str(&ihex_record(0, 0x04, &[0x08, 0x02]));
        output.push('\n');
        append_data_records(&mut output, 0, &image);
        output.push_str(&ihex_record(0, 0x04, &[0x08, 0x07]));
        output.push('\n');
        append_data_records(&mut output, 0xFFC0, &manifest);
        output.push_str(&ihex_record(0, 0x01, &[]));
        output.push('\n');
        output.into_bytes()
    }

    #[test]
    fn test_clean_cli_text_progress() {
        let text = "[==================================================] 100%";
        assert_eq!(clean_cli_text(text), "正在传输数据进度: 100%");
    }

    #[test]
    fn test_clean_cli_text_ansi() {
        let text = "\x1B[32mDownload verified successfully\x1B[0m";
        assert_eq!(clean_cli_text(text), "Download verified successfully");
    }

    #[tokio::test]
    async fn test_read_stream_with_invalid_utf8_and_cr() {
        use std::io::Cursor;
        let data = b"Download in Progress:\r\xDB\xDB\xDB 30%\r\xDB\xDB\xDB\xDB 50%\nComplete!\n";
        let (tx, mut rx) = mpsc::channel(10);
        tokio::spawn(read_stream_lines(Cursor::new(data), tx, false));

        let mut lines = Vec::new();
        while let Some(out) = rx.recv().await {
            if let ProcessOutput::Stdout(line) = out {
                lines.push(line);
            }
        }

        assert_eq!(lines.len(), 4);
        assert_eq!(lines[0], "Download in Progress:");
        assert!(lines[1].contains("30%"));
        assert!(lines[2].contains("50%"));
        assert_eq!(lines[3], "Complete!");
    }

    #[test]
    fn validates_xtq_packaged_hex_and_manifest() {
        let profile = find_flash_profile("xtq_f407_app").unwrap();
        let parsed = parse_ihex_bytes(&xtq_packaged_fixture(0x0000_0407)).unwrap();
        let inspection =
            inspect_parsed_image(profile, parsed, "fixture.hex", "fixture".into()).unwrap();

        assert!(inspection.validated);
        assert_eq!(inspection.address_start, XTQ_APP_BASE);
        assert_eq!(inspection.address_end_inclusive, 0x0807_FFFF);
        assert_eq!(inspection.manifest_target_id, Some(0x0000_0407));
        assert_eq!(inspection.manifest_image_size, Some(8));
    }

    #[test]
    fn rejects_xtq_cross_target_manifest() {
        let profile = find_flash_profile("xtq_f407_app").unwrap();
        let parsed = parse_ihex_bytes(&xtq_packaged_fixture(0x0000_0427)).unwrap();
        let error = inspect_parsed_image(profile, parsed, "fixture.hex", "fixture".into())
            .expect_err("F427 manifest must not be accepted by F407 profile");

        assert!(error.contains("与所选档案不一致"));
    }

    #[test]
    fn rejects_bad_ihex_checksum() {
        let error = parse_ihex_bytes(b":00000001FE\n").expect_err("bad checksum must fail");
        assert!(error.contains("校验和错误"));
    }

    #[test]
    fn rejects_image_outside_profile_range() {
        let mut content = String::new();
        content.push_str(&ihex_record(0, 0x04, &[0x08, 0x00]));
        content.push('\n');
        append_data_records(
            &mut content,
            0,
            &[0x00, 0x00, 0x01, 0x20, 0x05, 0x00, 0x00, 0x08],
        );
        content.push_str(&ihex_record(0, 0x04, &[0x08, 0x08]));
        content.push('\n');
        append_data_records(&mut content, 0, &[0xFF]);
        content.push_str(&ihex_record(0, 0x01, &[]));
        content.push('\n');

        let profile = find_flash_profile("sjzdv3_f412").unwrap();
        let parsed = parse_ihex_bytes(content.as_bytes()).unwrap();
        let error = inspect_parsed_image(profile, parsed, "fixture.hex", "fixture".into())
            .expect_err("profile range must reject one byte beyond Flash");

        assert!(error.contains("超出"));
    }

    #[test]
    fn parses_cubeprogrammer_device_identity() {
        let output = "Device ID   : 0x419\nDevice name : STM32F42xxx/F43xxx\n";
        let device_id = RE_DEVICE_ID
            .captures(output)
            .and_then(|captures| u32::from_str_radix(&captures[1][2..], 16).ok());
        let device_name = RE_DEVICE_NAME
            .captures(output)
            .map(|captures| captures[1].trim().to_string());

        assert_eq!(device_id, Some(0x419));
        assert_eq!(device_name.as_deref(), Some("STM32F42xxx/F43xxx"));
    }
}
