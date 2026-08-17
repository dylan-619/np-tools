use app_types::{
    AiSampleDto, DeviceInfoResult, FlashProgressEvent, FlashToolInfo, ModbusPointConfig,
    SerialOpenConfig, SerialPortDescriptor, SleFieldComparison,
};
use device_protocol::*;
use flash_service::FlashManager;
use serial_core::connection::ConnectionManager;
use serial_core::list_ports;
use std::sync::Arc;
use tauri::ipc::Channel;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn serial_list_ports() -> Result<Vec<SerialPortDescriptor>, String> {
    list_ports()
}

#[tauri::command]
async fn serial_open(
    config: SerialOpenConfig,
    on_data: Channel<Vec<app_types::IoChunk>>,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(128);

    // Spawn task to forward data to frontend
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = on_data.send(chunk);
        }
    });

    state.open(config, tx).await
}

#[tauri::command]
async fn serial_close(
    path: String,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<(), String> {
    state.close(&path).await
}

#[tauri::command]
async fn serial_write(
    path: String,
    data: Vec<u8>,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<(), String> {
    state.write(&path, data).await
}

#[tauri::command]
async fn serial_set_dtr(
    path: String,
    level: bool,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<(), String> {
    state.set_dtr(&path, level).await
}

#[tauri::command]
async fn serial_set_rts(
    path: String,
    level: bool,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<(), String> {
    state.set_rts(&path, level).await
}

#[tauri::command]
async fn serial_start_recording(
    path: String,
    file_path: String,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<(), String> {
    state.start_recording(&path, file_path).await
}

#[tauri::command]
async fn serial_stop_recording(
    path: String,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<(), String> {
    state.stop_recording(&path).await
}

// ==============================================================================
// SJZDV3 Commands
// ==============================================================================

#[tauri::command]
async fn sjzd_send_sn(
    path: String,
    sn: String,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = encode_sn_command(&sn)?;
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
async fn sjzd_send_modbus_points(
    path: String,
    points: Vec<ModbusPointConfig>,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = encode_modbus_points(&points)?;
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
async fn sjzd_send_modbus_debug(
    path: String,
    addr: u8,
    func: u8,
    reg: u32,
    length: u8,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = encode_modbus_debug(addr, func, reg, length)?;
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
async fn sjzd_send_sle_pwr(
    path: String,
    level: u8,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = encode_sle_pwr(level)?;
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
async fn sjzd_send_sle_maxpwr(
    path: String,
    level: u8,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = encode_sle_maxpwr(level)?;
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
async fn sjzd_send_sle_netname(
    path: String,
    name: String,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = encode_sle_netname(&name)?;
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
async fn sjzd_send_sle_apid(
    path: String,
    apid: u8,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = encode_sle_apid(apid);
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
async fn sjzd_send_wlan_bridge(
    path: String,
    enable: bool,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = encode_wlan_bridge(enable);
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
async fn sjzd_send_raw_command(
    path: String,
    text: String,
    exact_bytes: bool,
    state: tauri::State<'_, ConnectionManager>,
) -> Result<String, String> {
    let encoded = EncodedCommand::new(text, exact_bytes);
    state.write(&path, encoded.payload).await?;
    Ok(encoded.text)
}

#[tauri::command]
fn sjzd_parse_dev_info(text: String) -> DeviceInfoResult {
    parse_dev_info(&text)
}

#[tauri::command]
fn sjzd_parse_sle_comparisons(text: String) -> Vec<SleFieldComparison> {
    parse_sle_comparisons(&text)
}

#[tauri::command]
fn sjzd_parse_modbus_points(text: String) -> Vec<ModbusPointConfig> {
    parse_modbus_points_str(&text)
}

#[tauri::command]
fn sjzd_parse_ai_sample(text: String, timestamp_ms: u64) -> Option<AiSampleDto> {
    parse_ai_sample(&text, timestamp_ms)
}

// ==============================================================================
// Firmware Flashing Commands
// ==============================================================================

#[tauri::command]
async fn flash_probe_tool(custom_cli: Option<String>) -> FlashToolInfo {
    flash_service::probe_tool_and_devices(custom_cli).await
}

#[tauri::command]
async fn flash_start(
    cli_path: String,
    hex_path: String,
    probe_sn: Option<String>,
    on_progress: Channel<FlashProgressEvent>,
    flash_mgr: tauri::State<'_, Arc<FlashManager>>,
) -> Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = on_progress.send(event);
        }
    });

    let cancel_flag = flash_mgr.get_cancel_flag();
    flash_service::execute_flash(
        &cli_path,
        &hex_path,
        probe_sn,
        tx,
        cancel_flag,
    )
    .await
}

#[tauri::command]
fn flash_cancel(flash_mgr: tauri::State<'_, Arc<FlashManager>>) {
    flash_mgr.cancel();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let flash_mgr = Arc::new(FlashManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ConnectionManager::new())
        .manage(flash_mgr)
        .invoke_handler(tauri::generate_handler![
            greet,
            serial_list_ports,
            serial_open,
            serial_close,
            serial_write,
            serial_set_dtr,
            serial_set_rts,
            serial_start_recording,
            serial_stop_recording,
            // SJZDV3 Commands
            sjzd_send_sn,
            sjzd_send_modbus_points,
            sjzd_send_modbus_debug,
            sjzd_send_sle_pwr,
            sjzd_send_sle_maxpwr,
            sjzd_send_sle_netname,
            sjzd_send_sle_apid,
            sjzd_send_wlan_bridge,
            sjzd_send_raw_command,
            sjzd_parse_dev_info,
            sjzd_parse_sle_comparisons,
            sjzd_parse_modbus_points,
            sjzd_parse_ai_sample,
            // Flashing Commands
            flash_probe_tool,
            flash_start,
            flash_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
