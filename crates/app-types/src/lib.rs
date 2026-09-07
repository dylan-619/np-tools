use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortDescriptor {
    pub port_name: String,
    pub product_name: Option<String>,
    pub manufacturer: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SerialOpenConfig {
    pub path: String,
    pub baud_rate: u32,
    pub data_bits: String,
    pub stop_bits: String,
    pub parity: String,
    pub flow_control: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    pub config: SerialOpenConfig,
    pub bytes_read: u64,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IoChunk {
    pub id: String,
    pub direction: String,
    pub timestamp_us: u64,
    pub payload: Vec<u8>,
}

// ==============================================================================
// SJZDV3 Device Types
// ==============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModbusPointConfig {
    pub slave_addr: u8,
    pub func_code: u8,
    pub reg_addr: u32,
    pub length: u8,
    pub data_type: u8, // 0: RAW_HEX, 1: INT16, 2: UINT16, 3: INT32, 4: UINT32, 5: FLOAT32, 6: BOOL
    pub byte_order: u8, // 0: ABCD, 1: CDAB, 2: BADC, 3: DCBA
    pub name: Option<String>,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleConfigDto {
    pub net_name: String,
    pub ap_id: u8,
    pub tx_power: u8,
    pub max_tx_power: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleFieldComparison {
    pub field_name: String,
    pub eeprom_val: String,
    pub chip_val: String,
    pub is_matched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfoResult {
    pub sn: Option<String>,
    pub device_type: Option<String>,
    pub device_addr: Option<String>,
    pub hw_version: Option<String>,
    pub fw_version: Option<String>,
    pub boot_count: Option<u64>,
    pub uptime_sec: Option<u64>,
    pub report_freq_sec: Option<u32>,
    pub raw_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSampleDto {
    pub ai1_ma: f32,
    pub ai2_ma: f32,
    pub timestamp_ms: u64,
}

// ==============================================================================
// Firmware Flashing Types
// ==============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StLinkProbe {
    pub index: u32,
    pub serial_number: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashToolInfo {
    pub cli_path: Option<String>,
    pub is_available: bool,
    pub version: Option<String>,
    pub probes: Vec<StLinkProbe>,
}

/// 受支持的量产/维护烧录档案。
///
/// 档案由后端固定提供，前端只能选择 ID，不能自行提交地址或目标型号，
/// 以避免把任意 HEX 当作可烧录产物。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashProductProfile {
    pub id: String,
    pub label: String,
    pub mcu: String,
    pub image_kind: String,
    pub flash_start: u32,
    pub flash_end_exclusive: u32,
    pub expected_device_id: u32,
    pub requires_xtq_manifest: bool,
    pub supports_sjzd_sn_pipeline: bool,
    pub safety_note: String,
}

/// 对带地址 Intel HEX 的离线审查结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashImageInspection {
    pub profile_id: String,
    pub file_path: String,
    pub file_sha256: String,
    pub address_start: u32,
    pub address_end_inclusive: u32,
    pub data_record_count: u32,
    pub data_byte_count: u64,
    pub manifest_target_id: Option<u32>,
    pub manifest_image_size: Option<u32>,
    pub validated: bool,
    pub message: String,
}

/// 经 ST-Link 连接读取的 MCU 身份信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashTargetInfo {
    pub profile_id: String,
    pub device_id: Option<u32>,
    pub device_name: Option<String>,
    pub is_compatible: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashProgressEvent {
    pub state: String, // "idle" | "probing" | "erasing" | "programming" | "verifying" | "success" | "error"
    pub percent: u8,
    pub message: String,
    pub is_terminal: bool,
}
