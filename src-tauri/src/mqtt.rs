use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, QoS};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tokio::sync::{oneshot, Mutex};

const MAX_PAYLOAD_BYTES: usize = 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttConnectionConfig {
    host: String,
    port: u16,
    client_id: String,
    username: String,
    password: String,
    keep_alive_sec: u16,
    subscribe_topic: String,
    subscribe_qos: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttFrontendEvent {
    kind: String,
    timestamp_ms: u64,
    message: Option<String>,
    topic: Option<String>,
    payload_text: Option<String>,
    payload_hex: Option<String>,
    payload_size: Option<usize>,
    qos: Option<u8>,
    retain: Option<bool>,
}

struct MqttSession {
    client: AsyncClient,
    shutdown: oneshot::Sender<()>,
}

/// 公共 MQTT 调试会话。单窗口只保留一个 Broker 会话，避免后台重复订阅。
pub struct MqttManager {
    session: Mutex<Option<MqttSession>>,
}

impl MqttManager {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }

    async fn take_session(&self) -> Option<MqttSession> {
        self.session.lock().await.take()
    }

    async fn client(&self) -> Result<AsyncClient, String> {
        self.session
            .lock()
            .await
            .as_ref()
            .map(|session| session.client.clone())
            .ok_or_else(|| "MQTT 尚未连接，请先连接 Broker".to_string())
    }

    async fn stop_session(&self) {
        if let Some(session) = self.take_session().await {
            let _ = session.client.disconnect().await;
            let _ = session.shutdown.send(());
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn event(kind: &str, message: impl Into<Option<String>>) -> MqttFrontendEvent {
    MqttFrontendEvent {
        kind: kind.to_string(),
        timestamp_ms: now_ms(),
        message: message.into(),
        topic: None,
        payload_text: None,
        payload_hex: None,
        payload_size: None,
        qos: None,
        retain: None,
    }
}

fn emit(channel: &Channel<MqttFrontendEvent>, payload: MqttFrontendEvent) {
    let _ = channel.send(payload);
}

fn qos_from_u8(value: u8) -> Result<QoS, String> {
    match value {
        0 => Ok(QoS::AtMostOnce),
        1 => Ok(QoS::AtLeastOnce),
        2 => Ok(QoS::ExactlyOnce),
        _ => Err("QoS 仅允许 0、1 或 2".to_string()),
    }
}

fn validate_host(host: &str) -> Result<(), String> {
    if host.is_empty() || host.chars().any(char::is_whitespace) {
        return Err("Broker 主机不能为空，且不能包含空白字符".to_string());
    }
    if host.contains("://") || host.contains('/') || host.contains('\\') {
        return Err("Broker 主机只填写域名或 IP，端口请单独填写".to_string());
    }
    Ok(())
}

fn validate_client_id(client_id: &str) -> Result<(), String> {
    if client_id.is_empty() || client_id.len() > 64 || client_id.chars().any(char::is_control) {
        return Err("Client ID 必须为 1～64 个非控制字符".to_string());
    }
    if client_id.len() == 12 && client_id.chars().all(|value| value.is_ascii_digit()) {
        return Err("Client ID 不能使用 12 位设备 SN，以免把设备挤下线".to_string());
    }
    Ok(())
}

fn validate_topic(topic: &str, allow_wildcard: bool) -> Result<(), String> {
    if topic.is_empty() || topic.len() > 65_535 || topic.chars().any(char::is_control) {
        return Err("Topic 不能为空、不能包含控制字符，且长度不能超过 65535 字节".to_string());
    }
    if !allow_wildcard && (topic.contains('+') || topic.contains('#')) {
        return Err("发布 Topic 不能包含 + 或 # 通配符".to_string());
    }
    if allow_wildcard {
        for level in topic.split('/') {
            if level.contains('#') && level != "#" {
                return Err("# 只能单独占据订阅 Topic 的最后一级".to_string());
            }
            if level.contains('+') && level != "+" {
                return Err("+ 只能单独占据订阅 Topic 的一级".to_string());
            }
        }
        if let Some(index) = topic.find('#') {
            if index + 1 != topic.len() {
                return Err("# 只能位于订阅 Topic 的末尾".to_string());
            }
        }
    }
    Ok(())
}

fn validate_payload(payload: &str) -> Result<(), String> {
    if payload.as_bytes().len() > MAX_PAYLOAD_BYTES {
        return Err(format!("MQTT payload 不能超过 {} B", MAX_PAYLOAD_BYTES));
    }
    Ok(())
}

async fn run_event_loop(
    mut event_loop: EventLoop,
    mut shutdown: oneshot::Receiver<()>,
    channel: Channel<MqttFrontendEvent>,
) {
    let mut last_error: Option<(String, Instant)> = None;

    loop {
        tokio::select! {
            _ = &mut shutdown => {
                emit(&channel, event("disconnected", Some("已断开 MQTT 连接".to_string())));
                break;
            }
            result = event_loop.poll() => match result {
                Ok(Event::Incoming(Packet::ConnAck(_))) => {
                    last_error = None;
                    emit(&channel, event("connected", Some("已连接到 Broker，等待订阅确认".to_string())));
                }
                Ok(Event::Incoming(Packet::SubAck(_))) => {
                    emit(&channel, event("suback", Some("Broker 已确认订阅 (SUBACK)".to_string())));
                }
                Ok(Event::Incoming(Packet::PubAck(_))) => {
                    emit(&channel, event("puback", Some("Broker 已确认发布 (PUBACK)".to_string())));
                }
                Ok(Event::Incoming(Packet::Publish(publish))) => {
                    let payload = publish.payload.as_ref();
                    let payload_text = String::from_utf8(payload.to_vec()).unwrap_or_else(|_| {
                        format!("<非 UTF-8 二进制数据，共 {} B>", payload.len())
                    });
                    let payload_hex = payload.iter().map(|byte| format!("{byte:02X}")).collect::<Vec<_>>().join(" ");
                    emit(&channel, MqttFrontendEvent {
                        kind: "message".to_string(),
                        timestamp_ms: now_ms(),
                        message: None,
                        topic: Some(publish.topic),
                        payload_text: Some(payload_text),
                        payload_hex: Some(payload_hex),
                        payload_size: Some(payload.len()),
                        qos: Some(publish.qos as u8),
                        retain: Some(publish.retain),
                    });
                }
                Ok(Event::Incoming(Packet::Disconnect)) => {
                    emit(&channel, event("reconnecting", Some("Broker 已断开会话，正在等待重连".to_string())));
                }
                Ok(_) => {}
                Err(error) => {
                    let detail = error.to_string();
                    let should_report = last_error
                        .as_ref()
                        .map(|(previous, when)| previous != &detail || when.elapsed() >= Duration::from_secs(3))
                        .unwrap_or(true);
                    if should_report {
                        emit(&channel, event("reconnecting", Some(format!("MQTT 通信异常，正在重连：{detail}"))));
                        last_error = Some((detail, Instant::now()));
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }
    }
}

#[tauri::command]
pub async fn mqtt_connect(
    config: MqttConnectionConfig,
    on_event: Channel<MqttFrontendEvent>,
    state: tauri::State<'_, Arc<MqttManager>>,
) -> Result<(), String> {
    let host = config.host.trim().to_string();
    let client_id = config.client_id.trim().to_string();
    validate_host(&host)?;
    validate_client_id(&client_id)?;
    if config.port == 0 {
        return Err("Broker 端口必须在 1～65535 范围内".to_string());
    }
    if config.keep_alive_sec == 0 {
        return Err("Keep Alive 必须在 1～65535 秒范围内".to_string());
    }
    let subscribe_topic = config.subscribe_topic.trim().to_string();
    let subscribe_qos = qos_from_u8(config.subscribe_qos)?;
    if !subscribe_topic.is_empty() {
        validate_topic(&subscribe_topic, true)?;
    }

    state.stop_session().await;

    let mut options = MqttOptions::new(client_id, host, config.port);
    options.set_keep_alive(Duration::from_secs(config.keep_alive_sec as u64));
    options.set_clean_session(true);
    if !config.username.trim().is_empty() {
        options.set_credentials(config.username, config.password);
    }

    let (client, event_loop) = AsyncClient::new(options, 32);
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tokio::spawn(run_event_loop(event_loop, shutdown_rx, on_event));

    {
        let mut session = state.session.lock().await;
        *session = Some(MqttSession {
            client: client.clone(),
            shutdown: shutdown_tx,
        });
    }

    if !subscribe_topic.is_empty() {
        if let Err(error) = client.subscribe(subscribe_topic, subscribe_qos).await {
            state.stop_session().await;
            return Err(format!("提交订阅请求失败：{error}"));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn mqtt_disconnect(state: tauri::State<'_, Arc<MqttManager>>) -> Result<(), String> {
    state.stop_session().await;
    Ok(())
}

#[tauri::command]
pub async fn mqtt_subscribe(
    topic: String,
    qos: u8,
    state: tauri::State<'_, Arc<MqttManager>>,
) -> Result<(), String> {
    let topic = topic.trim().to_string();
    validate_topic(&topic, true)?;
    state
        .client()
        .await?
        .subscribe(topic, qos_from_u8(qos)?)
        .await
        .map_err(|error| format!("提交订阅请求失败：{error}"))
}

#[tauri::command]
pub async fn mqtt_publish(
    topic: String,
    payload: String,
    qos: u8,
    state: tauri::State<'_, Arc<MqttManager>>,
) -> Result<(), String> {
    let topic = topic.trim().to_string();
    validate_topic(&topic, false)?;
    validate_payload(&payload)?;
    state
        .client()
        .await?
        .publish(topic, qos_from_u8(qos)?, false, payload.into_bytes())
        .await
        .map_err(|error| format!("提交发布请求失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscription_wildcards_must_occupy_a_complete_topic_level() {
        assert!(validate_topic("devices/+/up", true).is_ok());
        assert!(validate_topic("devices/#", true).is_ok());
        assert!(validate_topic("devices/a#", true).is_err());
        assert!(validate_topic("devices/a+b/up", true).is_err());
        assert!(validate_topic("devices/+/up", false).is_err());
    }

    #[test]
    fn client_id_cannot_impersonate_a_device_serial_number() {
        assert!(validate_client_id("020325090118").is_err());
        assert!(validate_client_id("np-tools-mqtt-1").is_ok());
    }

    #[test]
    fn payload_limit_is_measured_in_utf8_bytes() {
        assert!(validate_payload(&"a".repeat(MAX_PAYLOAD_BYTES)).is_ok());
        assert!(validate_payload(&"a".repeat(MAX_PAYLOAD_BYTES + 1)).is_err());
        assert!(validate_payload(&"中".repeat(342)).is_err());
    }
}
