use app_types::{
    AiSampleDto, DeviceInfoResult, FlashImageInspection, FlashProductProfile, FlashProgressEvent,
    FlashTargetInfo, FlashToolInfo, ModbusPointConfig, SerialOpenConfig, SerialPortDescriptor,
    SleFieldComparison,
};
use device_protocol::*;
use flash_service::FlashManager;
use serial_core::connection::ConnectionManager;
use serial_core::list_ports;
use std::sync::Arc;
use tauri::ipc::Channel;

mod kz3_http;
mod modbus_tcp;
mod mqtt;
mod ssh_sftp;
mod workspace;

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
fn flash_list_product_profiles() -> Vec<FlashProductProfile> {
    flash_service::list_product_profiles()
}

#[tauri::command]
fn flash_inspect_image(
    profile_id: String,
    hex_path: String,
) -> Result<FlashImageInspection, String> {
    flash_service::inspect_flash_image(&profile_id, &hex_path)
}

#[tauri::command]
async fn flash_probe_target(
    cli_path: String,
    profile_id: String,
    probe_sn: Option<String>,
) -> Result<FlashTargetInfo, String> {
    flash_service::probe_flash_target(&cli_path, &profile_id, probe_sn).await
}

#[tauri::command]
async fn flash_start(
    cli_path: String,
    profile_id: String,
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
    flash_service::execute_flash(&cli_path, &profile_id, &hex_path, probe_sn, tx, cancel_flag).await
}

#[tauri::command]
fn flash_cancel(flash_mgr: tauri::State<'_, Arc<FlashManager>>) {
    flash_mgr.cancel();
}

#[tauri::command]
async fn app_save_file(
    default_name: String,
    content: String,
    filter_name: String,
    filter_ext: String,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file();
    builder = builder.set_file_name(&default_name);
    builder = builder.add_filter(&filter_name, &[&filter_ext]);

    let path_opt = builder.blocking_save_file();
    if let Some(file_path) = path_opt {
        let path = file_path.into_path().map_err(|e| format!("{:?}", e))?;
        let path_str = path.to_string_lossy().to_string();
        std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
        Ok(Some(path_str))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn app_open_file(
    filter_name: String,
    filter_exts: Vec<String>,
    app: tauri::AppHandle,
) -> Result<Option<(String, String)>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file();
    let exts: Vec<&str> = filter_exts.iter().map(|s| s.as_str()).collect();
    builder = builder.add_filter(&filter_name, &exts);

    let path_opt = builder.blocking_pick_file();
    if let Some(file_path) = path_opt {
        let path = file_path.into_path().map_err(|e| format!("{:?}", e))?;
        let path_str = path.to_string_lossy().to_string();
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        Ok(Some((path_str, content)))
    } else {
        Ok(None)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let flash_mgr = Arc::new(FlashManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ConnectionManager::new())
        .manage(kz3_http::Kz3HttpClient::new())
        .manage(modbus_tcp::ModbusTcpClient::new())
        .manage(Arc::new(mqtt::MqttManager::new()))
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
            // 公共 MQTT 调试
            mqtt::mqtt_connect,
            mqtt::mqtt_disconnect,
            mqtt::mqtt_subscribe,
            mqtt::mqtt_publish,
            // 通用 Modbus TCP 只读调试
            modbus_tcp::modbus_tcp_read,
            // 通用 SSH / SFTP 文件传输
            ssh_sftp::ssh_sftp_probe,
            ssh_sftp::ssh_sftp_list_dir,
            ssh_sftp::ssh_sftp_upload,
            ssh_sftp::ssh_sftp_download,
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
            flash_list_product_profiles,
            flash_inspect_image,
            flash_probe_target,
            flash_start,
            flash_cancel,
            // KZ3 HTTP 在线调试
            kz3_http::kz3_http_get_diagnostic,
            kz3_http::kz3_http_get_point,
            kz3_http::kz3_http_write_point,
            // 本地设备工作空间（平台 ID 仅在元数据中预留，不作为前置条件）
            workspace::workspace_initialize,
            workspace::workspace_store_controller_config,
            workspace::workspace_load_controller_config,
            // File Save & Open Dialogs
            app_save_file,
            app_open_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
