use app_types::{
    AiSampleDto, DeviceInfoResult, ModbusPointConfig, SleFieldComparison,
};
use regex::Regex;
use std::sync::LazyLock;

pub const DEVICE_SN_PREFIX: &str = "4301";
pub const MAX_MODBUS_POINTS: usize = 16;

#[derive(Debug, Clone)]
pub struct EncodedCommand {
    pub text: String,
    pub payload: Vec<u8>,
    pub exact_bytes: bool,
}

impl EncodedCommand {
    pub fn new(text: impl Into<String>, exact_bytes: bool) -> Self {
        let text = text.into();
        let payload = if exact_bytes {
            text.as_bytes().to_vec()
        } else {
            format!("{}\r\n", text).into_bytes()
        };
        Self {
            text,
            payload,
            exact_bytes,
        }
    }
}

// ==============================================================================
// Command Encoders
// ==============================================================================

pub fn encode_sn_command(sn: &str) -> Result<EncodedCommand, String> {
    let clean = sn.trim();
    if clean.len() != 12 || !clean.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("SN 必须为恰好 12 位纯数字（当前: '{}'）", sn));
    }
    if !clean.starts_with(DEVICE_SN_PREFIX) {
        return Err(format!(
            "SN 必须以 '{}' 开头（当前: '{}'）",
            DEVICE_SN_PREFIX, sn
        ));
    }
    // userMain.c: 要求 UART1_RxCnt == 15 ("SN:" + 12位数字)，严格定长且不加 \r\n
    let cmd = format!("SN:{}", clean);
    if cmd.len() != 15 {
        return Err(format!("SN 指令长度异常: {} 字节", cmd.len()));
    }
    Ok(EncodedCommand::new(cmd, true))
}

pub fn encode_sle_apid(apid: u8) -> EncodedCommand {
    EncodedCommand::new(format!("SLE_APID:{}", apid), false)
}

pub fn encode_sle_netname(name: &str) -> Result<EncodedCommand, String> {
    let clean = name.trim();
    if clean.is_empty() {
        return Err("星闪网络名称不能为空".into());
    }
    if clean.len() > 16 {
        return Err(format!("星闪网络名称最长 16 字符（当前 {} 字符）", clean.len()));
    }
    if clean.bytes().any(|b| !(0x20..=0x7e).contains(&b)) {
        return Err("星闪网络名称仅支持可打印 ASCII 字符".into());
    }
    Ok(EncodedCommand::new(format!("SLE_NETNAME:{}", clean), false))
}

pub fn encode_sle_pwr(level: u8) -> Result<EncodedCommand, String> {
    if !(1..=8).contains(&level) {
        return Err(format!("发射功率档位必须在 1~8 之间（当前: {}）", level));
    }
    // userMain.c: 要求 UART1_RxCnt == 9 ("SLE_PWR:" + 1位数字)，不加 \r\n
    Ok(EncodedCommand::new(format!("SLE_PWR:{}", level), true))
}

pub fn encode_sle_maxpwr(level: u8) -> Result<EncodedCommand, String> {
    if !(1..=8).contains(&level) {
        return Err(format!("最大功率档位必须在 1~8 之间（当前: {}）", level));
    }
    // userMain.c: 要求 UART1_RxCnt == 12 ("SLE_MAXPWR:" + 1位数字)，不加 \r\n
    Ok(EncodedCommand::new(format!("SLE_MAXPWR:{}", level), true))
}

pub fn encode_sle_list() -> EncodedCommand {
    EncodedCommand::new("SLE:LIST", false)
}

pub fn encode_wlan_bridge(enable: bool) -> EncodedCommand {
    EncodedCommand::new(if enable { "@WLAN=1" } else { "@WLAN=0" }, false)
}

pub fn validate_point(pt: &ModbusPointConfig) -> Result<ModbusPointConfig, String> {
    if pt.slave_addr == 0 || pt.slave_addr > 247 {
        return Err(format!("从站地址须在 1~247 之间（当前: {}）", pt.slave_addr));
    }
    if ![1, 2, 3, 4].contains(&pt.func_code) {
        return Err(format!("功能码仅支持 1(线圈), 2(离散输入), 3(保持寄存器), 4(输入寄存器)（当前: {}）", pt.func_code));
    }
    if pt.reg_addr == 0 || pt.reg_addr > 65535 {
        return Err(format!("PLC 寄存器地址须在 1~65535 之间（当前: {}）", pt.reg_addr));
    }
    if pt.length == 0 || pt.length > 31 {
        return Err(format!("读取长度须在 1~31 之间（当前: {}）", pt.length));
    }
    if pt.data_type > 6 {
        return Err(format!("数据类型须在 0~6 之间（当前: {}）", pt.data_type));
    }
    if pt.byte_order > 3 {
        return Err(format!("字节序须在 0~3 之间（当前: {}）", pt.byte_order));
    }

    let mut result = pt.clone();
    // 智能纠错：32位类型（INT32, UINT32, FLOAT32）强制至少读取 2 个寄存器
    if [3, 4, 5].contains(&result.data_type) && result.length < 2 {
        result.length = 2;
    }
    Ok(result)
}

pub fn encode_modbus_points(points: &[ModbusPointConfig]) -> Result<EncodedCommand, String> {
    if points.len() > MAX_MODBUS_POINTS {
        return Err(format!("点位总数不能超过 {} 个（当前: {}）", MAX_MODBUS_POINTS, points.len()));
    }
    let mut parts = Vec::new();
    for pt in points {
        let valid = validate_point(pt)?;
        parts.push(format!(
            "{},{},{},{},{},{}",
            valid.slave_addr,
            valid.func_code,
            valid.reg_addr,
            valid.length,
            valid.data_type,
            valid.byte_order
        ));
    }
    let body = parts.join(";");
    Ok(EncodedCommand::new(format!("RS485DEV:{}", body), false))
}

pub fn encode_modbus_list() -> EncodedCommand {
    EncodedCommand::new("RS485DEV:LIST", false)
}

pub fn encode_modbus_reset() -> EncodedCommand {
    EncodedCommand::new("RS485DEV:RESET", false)
}

pub fn encode_modbus_debug(addr: u8, func: u8, reg: u32, len: u8) -> Result<EncodedCommand, String> {
    let dummy = ModbusPointConfig {
        slave_addr: addr,
        func_code: func,
        reg_addr: reg,
        length: len,
        data_type: 0,
        byte_order: 0,
        name: None,
        unit: None,
    };
    let valid = validate_point(&dummy)?;
    Ok(EncodedCommand::new(
        format!("RS485DEV:DEBUG:{},{},{},{}", valid.slave_addr, valid.func_code, valid.reg_addr, valid.length),
        false,
    ))
}

pub fn encode_ai_test() -> EncodedCommand {
    EncodedCommand::new("AITEST", false)
}

pub fn encode_test_stop() -> EncodedCommand {
    EncodedCommand::new("TESTSTOP", false)
}

pub fn encode_dev_test() -> EncodedCommand {
    EncodedCommand::new("DEVTEST", false)
}

pub fn encode_led_all_green() -> EncodedCommand {
    EncodedCommand::new("ALLGREEN", false)
}

pub fn encode_led_all_red() -> EncodedCommand {
    EncodedCommand::new("ALLRED", false)
}

pub fn encode_led_all_off() -> EncodedCommand {
    EncodedCommand::new("ALLOFF", false)
}

pub fn encode_report_freq(sec: u8) -> Result<EncodedCommand, String> {
    if sec == 0 {
        return Err("上报周期须大于 0 秒".into());
    }
    Ok(EncodedCommand::new(format!("RTFRE:{}", sec), false))
}

pub fn encode_loglevel(level: u8) -> Result<EncodedCommand, String> {
    if level > 5 {
        return Err("日志等级须在 0~5 之间".into());
    }
    Ok(EncodedCommand::new(format!("LOGLEVEL:{}", level), false))
}

pub fn encode_dev_info() -> EncodedCommand {
    EncodedCommand::new("DEVINFO", false)
}

pub fn encode_clear_power_count() -> EncodedCommand {
    EncodedCommand::new("@POC=0", false)
}

pub fn encode_clear_runtime() -> EncodedCommand {
    EncodedCommand::new("@RTM=0", false)
}

pub fn encode_system_reset() -> EncodedCommand {
    EncodedCommand::new("@RST", false)
}

pub fn encode_eeprom_clear() -> EncodedCommand {
    EncodedCommand::new("@EEP=0", false)
}

// ==============================================================================
// Response Parsers
// ==============================================================================

static RE_AI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"AI1:\s*([0-9.]+)\s*mA,\s*AI2:\s*([0-9.]+)\s*mA").unwrap()
});

static RE_DEV_SN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:SN|DeviceSN|Device\s*SN)[:=]\s*([0-9A-Za-z]+)").unwrap()
});

static RE_DEV_HW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:HW|Hardware)[:=]\s*([0-9A-Za-z._-]+)").unwrap()
});

static RE_DEV_FW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:FW|Firmware|AppVersion|Version)[:=]\s*([0-9A-Za-z._-]+)").unwrap()
});

static RE_DEV_BOOT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:BOOT|BootCount|POC)[:=]\s*(\d+)").unwrap()
});

static RE_DEV_UPTIME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:UPTIME|Runtime|RTM)[:=]\s*(\d+)").unwrap()
});

pub fn parse_ai_sample(text: &str, timestamp_ms: u64) -> Option<AiSampleDto> {
    if let Some(caps) = RE_AI.captures(text) {
        if let (Ok(ai1), Ok(ai2)) = (caps[1].parse::<f32>(), caps[2].parse::<f32>()) {
            return Some(AiSampleDto {
                ai1_ma: ai1,
                ai2_ma: ai2,
                timestamp_ms,
            });
        }
    }
    None
}

pub fn parse_dev_info(text: &str) -> DeviceInfoResult {
    let sn = RE_DEV_SN.captures(text).map(|c| c[1].to_string());
    let hw = RE_DEV_HW.captures(text).map(|c| c[1].to_string());
    let fw = RE_DEV_FW.captures(text).map(|c| c[1].to_string());
    let boot = RE_DEV_BOOT.captures(text).and_then(|c| c[1].parse::<u64>().ok());
    let uptime = RE_DEV_UPTIME.captures(text).and_then(|c| c[1].parse::<u64>().ok());

    DeviceInfoResult {
        sn,
        hw_version: hw,
        fw_version: fw,
        boot_count: boot,
        uptime_sec: uptime,
        raw_text: text.to_string(),
    }
}

pub fn parse_modbus_points_str(text: &str) -> Vec<ModbusPointConfig> {
    let mut result = Vec::new();
    let cleaned = text.trim();
    let lines = cleaned.lines();

    for line in lines {
        let line = line.trim();
        let target = if let Some(stripped) = line.strip_prefix("RS485DEV:") {
            stripped
        } else if let Some(stripped) = line.strip_prefix("POINTS:") {
            stripped
        } else {
            line
        };

        for pt_str in target.split(';') {
            let pt_str = pt_str.trim();
            if pt_str.is_empty() {
                continue;
            }
            let parts: Vec<&str> = pt_str.split(',').map(|s| s.trim()).collect();
            if parts.len() >= 4 {
                if let (Ok(a), Ok(f), Ok(r), Ok(l)) = (
                    parts[0].parse::<u8>(),
                    parts[1].parse::<u8>(),
                    parts[2].parse::<u32>(),
                    parts[3].parse::<u8>(),
                ) {
                    let dt = parts.get(4).and_then(|s| s.parse::<u8>().ok()).unwrap_or(0);
                    let bo = parts.get(5).and_then(|s| s.parse::<u8>().ok()).unwrap_or(0);
                    let pt = ModbusPointConfig {
                        slave_addr: a,
                        func_code: f,
                        reg_addr: r,
                        length: l,
                        data_type: dt,
                        byte_order: bo,
                        name: None,
                        unit: None,
                    };
                    if let Ok(valid) = validate_point(&pt) {
                        result.push(valid);
                    }
                }
            }
        }
    }
    result
}

pub fn parse_sle_comparisons(text: &str) -> Vec<SleFieldComparison> {
    let mut comparisons = Vec::new();
    // Support parsing [EEPROM] and [CHIP] lines or key-value structures
    let lines: Vec<&str> = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();

    let mut eeprom_netname = String::new();
    let mut eeprom_apid = String::new();
    let mut eeprom_pwr = String::new();
    let mut eeprom_maxpwr = String::new();

    let mut chip_netname = String::new();
    let mut chip_apid = String::new();
    let mut chip_pwr = String::new();
    let mut chip_maxpwr = String::new();

    for line in &lines {
        let l = line.to_uppercase();
        if l.contains("NETNAME") || l.contains("NAME") {
            let val = line.split(':').nth(1).or_else(|| line.split('=').nth(1)).unwrap_or("").trim();
            if l.contains("[CHIP]") || l.contains("CHIP") {
                chip_netname = val.to_string();
            } else {
                eeprom_netname = val.to_string();
            }
        } else if l.contains("APID") || l.contains("AP_ID") {
            let val = line.split(':').nth(1).or_else(|| line.split('=').nth(1)).unwrap_or("").trim();
            if l.contains("[CHIP]") || l.contains("CHIP") {
                chip_apid = val.to_string();
            } else {
                eeprom_apid = val.to_string();
            }
        } else if l.contains("MAXPWR") || l.contains("MAX_PWR") {
            let val = line.split(':').nth(1).or_else(|| line.split('=').nth(1)).unwrap_or("").trim();
            if l.contains("[CHIP]") || l.contains("CHIP") {
                chip_maxpwr = val.to_string();
            } else {
                eeprom_maxpwr = val.to_string();
            }
        } else if l.contains("PWR") || l.contains("POWER") {
            let val = line.split(':').nth(1).or_else(|| line.split('=').nth(1)).unwrap_or("").trim();
            if l.contains("[CHIP]") || l.contains("CHIP") {
                chip_pwr = val.to_string();
            } else {
                eeprom_pwr = val.to_string();
            }
        }
    }

    if !eeprom_netname.is_empty() || !chip_netname.is_empty() {
        comparisons.push(SleFieldComparison {
            field_name: "网络名称 (NetName)".into(),
            is_matched: eeprom_netname == chip_netname && !eeprom_netname.is_empty(),
            eeprom_val: if eeprom_netname.is_empty() { "--".into() } else { eeprom_netname },
            chip_val: if chip_netname.is_empty() { "--".into() } else { chip_netname },
        });
    }
    if !eeprom_apid.is_empty() || !chip_apid.is_empty() {
        comparisons.push(SleFieldComparison {
            field_name: "AP ID".into(),
            is_matched: eeprom_apid == chip_apid && !eeprom_apid.is_empty(),
            eeprom_val: if eeprom_apid.is_empty() { "--".into() } else { eeprom_apid },
            chip_val: if chip_apid.is_empty() { "--".into() } else { chip_apid },
        });
    }
    if !eeprom_pwr.is_empty() || !chip_pwr.is_empty() {
        comparisons.push(SleFieldComparison {
            field_name: "当前发射功率 (Tx Power)".into(),
            is_matched: eeprom_pwr == chip_pwr && !eeprom_pwr.is_empty(),
            eeprom_val: if eeprom_pwr.is_empty() { "--".into() } else { eeprom_pwr },
            chip_val: if chip_pwr.is_empty() { "--".into() } else { chip_pwr },
        });
    }
    if !eeprom_maxpwr.is_empty() || !chip_maxpwr.is_empty() {
        comparisons.push(SleFieldComparison {
            field_name: "最大发射功率 (Max Tx Power)".into(),
            is_matched: eeprom_maxpwr == chip_maxpwr && !eeprom_maxpwr.is_empty(),
            eeprom_val: if eeprom_maxpwr.is_empty() { "--".into() } else { eeprom_maxpwr },
            chip_val: if chip_maxpwr.is_empty() { "--".into() } else { chip_maxpwr },
        });
    }

    comparisons
}
