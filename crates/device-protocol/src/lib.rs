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

static RE_ANSI_STRIP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\x1B\[[0-9;?]*[a-zA-Z]").unwrap()
});

static RE_DEV_SN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:SN|DeviceSN|Device\s*SN)[:=]\s*([0-9A-Za-z]+)").unwrap()
});

static RE_DEV_TYPE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:Type|DevType|Model)[:=]\s*([0-9A-Za-z._-]+)").unwrap()
});

static RE_DEV_ADDR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:Addr|Address)[:=]\s*([0-9A-Za-z]+)").unwrap()
});

static RE_DEV_HW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:HW|Hardware|HwVer)[:=]\s*([0-9A-Za-z._-]+)").unwrap()
});

static RE_DEV_FW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:FW|Firmware|AppVersion|Version|FwVer)[:=]\s*([0-9A-Za-z._-]+)").unwrap()
});

static RE_DEV_BOOT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:BOOT|BootCount|PwrOnCnt|POC|PowerOnCount)[:=]\s*(\d+)").unwrap()
});

static RE_DEV_UPTIME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:UPTIME|Runtime|TotRunTim|TotRunTime|RTM)[:=]\s*(\d+)").unwrap()
});

static RE_DEV_RPT_FREQ: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:RptFreq|ReportFreq|RTFRE)[:=]\s*(\d+)").unwrap()
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
    let clean = RE_ANSI_STRIP.replace_all(text, "");
    let clean_str = clean.trim();

    let sn = RE_DEV_SN.captures(clean_str).map(|c| c[1].to_string());
    let dev_type = RE_DEV_TYPE.captures(clean_str).map(|c| c[1].to_string());
    let dev_addr = RE_DEV_ADDR.captures(clean_str).map(|c| c[1].to_string());
    let hw = RE_DEV_HW.captures(clean_str).map(|c| c[1].to_string()).or_else(|| {
        dev_type.as_ref().map(|t| format!("SJZDV3-{}", t))
    });
    let fw = RE_DEV_FW.captures(clean_str).map(|c| c[1].to_string());
    let boot = RE_DEV_BOOT.captures(clean_str).and_then(|c| c[1].parse::<u64>().ok());
    let uptime = RE_DEV_UPTIME.captures(clean_str).and_then(|c| c[1].parse::<u64>().ok());
    let report_freq = RE_DEV_RPT_FREQ.captures(clean_str).and_then(|c| c[1].parse::<u32>().ok());

    DeviceInfoResult {
        sn,
        device_type: dev_type,
        device_addr: dev_addr,
        hw_version: hw,
        fw_version: fw,
        boot_count: boot,
        uptime_sec: uptime,
        report_freq_sec: report_freq,
        raw_text: clean_str.to_string(),
    }
}

static RE_MODBUS_POINT_ITEM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:\[\d+\]\s*)?addr=(\d+)\s+func=(\d+)\s+reg=(\d+)\s+len=(\d+)\s+type=(\d+)\s+order=(\d+)").unwrap()
});

pub fn parse_modbus_points_str(text: &str) -> Vec<ModbusPointConfig> {
    let mut result = Vec::new();
    let cleaned = text.trim();
    let lines = cleaned.lines();

    for line in lines {
        let line = line.trim();

        // 1. 尝试匹配嵌入式下位机日志格式: [0] addr=3 func=3 reg=42761 len=2 type=5 order=0
        if let Some(caps) = RE_MODBUS_POINT_ITEM.captures(line) {
            if let (Ok(a), Ok(f), Ok(r), Ok(l), Ok(dt), Ok(bo)) = (
                caps[1].parse::<u8>(),
                caps[2].parse::<u8>(),
                caps[3].parse::<u32>(),
                caps[4].parse::<u8>(),
                caps[5].parse::<u8>(),
                caps[6].parse::<u8>(),
            ) {
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
                    continue;
                }
            }
        }

        // 2. 尝试匹配传统的 RS485DEV: 或 POINTS: 格式
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

static RE_NETNAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(?:NetName|Net_Name|Name)=['"]?([^,'"\s\(\)]+)['"]?"#).unwrap()
});

static RE_DEV_ADDR_SLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:DevAddr|DeviceAddr|Addr)=(\d+)").unwrap()
});

static RE_TX_PWR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:TxPwr|Tx_Pwr|PWR|Power)=(\d+)").unwrap()
});

pub fn parse_sle_comparisons(text: &str) -> Vec<SleFieldComparison> {
    let mut comparisons = Vec::new();
    let clean = RE_ANSI_STRIP.replace_all(text, "");
    let lines: Vec<&str> = clean.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();

    let mut eeprom_netname = String::new();
    let mut eeprom_devaddr = String::new();
    let mut eeprom_pwr = String::new();

    let mut chip_netname = String::new();
    let mut chip_devaddr = String::new();
    let mut chip_pwr = String::new();

    for line in &lines {
        let is_eeprom = line.contains("[EEPROM]") || (!line.contains("[CHIP]") && (line.contains("APID") || line.contains("MaxTxPwr")));
        let is_chip = line.contains("[CHIP]") || line.contains("Mac=");

        if is_eeprom {
            if let Some(c) = RE_NETNAME.captures(line) {
                eeprom_netname = c[1].to_string();
            }
            if let Some(c) = RE_DEV_ADDR_SLE.captures(line) {
                eeprom_devaddr = c[1].to_string();
            }
            if let Some(c) = RE_TX_PWR.captures(line) {
                eeprom_pwr = c[1].to_string();
            }
        }

        if is_chip {
            if let Some(c) = RE_NETNAME.captures(line) {
                chip_netname = c[1].to_string();
            }
            if let Some(c) = RE_DEV_ADDR_SLE.captures(line) {
                chip_devaddr = c[1].to_string();
            }
            if let Some(c) = RE_TX_PWR.captures(line) {
                chip_pwr = c[1].to_string();
            }
        }

        // Single key lines fallback
        if !is_eeprom && !is_chip {
            if let Some(c) = RE_NETNAME.captures(line) {
                if eeprom_netname.is_empty() { eeprom_netname = c[1].to_string(); }
            }
            if let Some(c) = RE_DEV_ADDR_SLE.captures(line) {
                if eeprom_devaddr.is_empty() { eeprom_devaddr = c[1].to_string(); }
            }
            if let Some(c) = RE_TX_PWR.captures(line) {
                if eeprom_pwr.is_empty() { eeprom_pwr = c[1].to_string(); }
            }
        }
    }

    // 1. 网络名称 (NetName)
    if !eeprom_netname.is_empty() || !chip_netname.is_empty() {
        let is_matched = if !eeprom_netname.is_empty() && !chip_netname.is_empty() {
            eeprom_netname == chip_netname
        } else {
            true
        };
        comparisons.push(SleFieldComparison {
            field_name: "星闪网络名称 (NetName)".into(),
            is_matched,
            eeprom_val: if eeprom_netname.is_empty() { "--".into() } else { eeprom_netname },
            chip_val: if chip_netname.is_empty() { "--".into() } else { chip_netname },
        });
    }

    // 2. 通信地址 (DevAddr / Addr)
    if !eeprom_devaddr.is_empty() || !chip_devaddr.is_empty() {
        let is_matched = if !eeprom_devaddr.is_empty() && !chip_devaddr.is_empty() {
            eeprom_devaddr == chip_devaddr
        } else {
            true
        };
        comparisons.push(SleFieldComparison {
            field_name: "从机通信地址 (DevAddr)".into(),
            is_matched,
            eeprom_val: if eeprom_devaddr.is_empty() { "--".into() } else { eeprom_devaddr },
            chip_val: if chip_devaddr.is_empty() { "--".into() } else { chip_devaddr },
        });
    }

    // 3. 当前发射功率 (Tx Power / TxPwr)
    if !eeprom_pwr.is_empty() || !chip_pwr.is_empty() {
        let is_matched = if !eeprom_pwr.is_empty() && !chip_pwr.is_empty() {
            eeprom_pwr == chip_pwr
        } else {
            true
        };
        comparisons.push(SleFieldComparison {
            field_name: "当前发射功率 (Tx Power)".into(),
            is_matched,
            eeprom_val: if eeprom_pwr.is_empty() { "--".into() } else { format!("{} 档", eeprom_pwr) },
            chip_val: if chip_pwr.is_empty() { "--".into() } else { format!("{} 档", chip_pwr) },
        });
    }

    comparisons
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_modbus_points_embedded_log() {
        let sample = r#"
[2300.642] /Users/Dylan/work_project/new-yunteng/iot-project/SJZDV3/User/Src/userMain.c[283]: INFO: Modbus points: 1
[2300.642] /Users/Dylan/work_project/new-yunteng/iot-project/SJZDV3/User/Src/userMain.c[286]: INFO:   [0] addr=3 func=3 reg=42761 len=2 type=5 order=0
"#;
        let points = parse_modbus_points_str(sample);
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].slave_addr, 3);
        assert_eq!(points[0].func_code, 3);
        assert_eq!(points[0].reg_addr, 42761);
        assert_eq!(points[0].length, 2);
        assert_eq!(points[0].data_type, 5);
        assert_eq!(points[0].byte_order, 0);
    }
}
