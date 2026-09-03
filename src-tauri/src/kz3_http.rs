use reqwest::{redirect::Policy, Client, Url};
use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const MAX_RESPONSE_BYTES: usize = 4096;
const KZ3_HTTP_WRITE_RELEASED: bool = true;

/// KZ3 HTTP 调试代理。锁用于保证同一工具实例只有一个在途设备请求，
/// 避免轮询和写入并发压垮控制器有限的 HTTP client 槽位。
pub struct Kz3HttpClient {
    client: Client,
    request_lock: Mutex<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Kz3HttpResponse {
    pub status: u16,
    pub body: String,
    pub content_type: Option<String>,
    pub elapsed_ms: u64,
}

impl Kz3HttpClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .connect_timeout(Duration::from_millis(1200))
            .timeout(Duration::from_millis(2800))
            .redirect(Policy::none())
            .pool_max_idle_per_host(0)
            .user_agent("NP-Tools/2 KZ3-Debug")
            .build()
            .expect("KZ3 HTTP client 创建失败");

        Self {
            client,
            request_lock: Mutex::new(()),
        }
    }

    async fn execute(
        &self,
        method: reqwest::Method,
        url: Url,
        body: Option<Value>,
    ) -> Result<Kz3HttpResponse, String> {
        let _request_guard = self.request_lock.lock().await;
        let started = Instant::now();
        let mut request = self.client.request(method, url);
        if let Some(json) = body {
            request = request
                .header("Content-Type", "application/json")
                .json(&json);
        }

        let response = request
            .send()
            .await
            .map_err(|error| format!("设备 HTTP 请求失败: {error}"))?;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);

        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(format!("设备响应超过工具安全上限 {MAX_RESPONSE_BYTES} B"));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("读取设备 HTTP 响应失败: {error}"))?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err(format!("设备响应超过工具安全上限 {MAX_RESPONSE_BYTES} B"));
        }

        Ok(Kz3HttpResponse {
            status,
            body: String::from_utf8_lossy(&bytes).into_owned(),
            content_type,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }
}

fn normalize_base_url(base_url: &str) -> Result<Url, String> {
    let trimmed = base_url.trim();
    let mut url =
        Url::parse(trimmed).map_err(|_| "设备地址格式无效，应为 http://IP:端口".to_string())?;

    if url.scheme() != "http" {
        return Err("当前 KZ3 固件仅支持明文 HTTP，不支持 HTTPS 或其他协议".to_string());
    }
    if url.host_str().is_none() {
        return Err("设备地址缺少主机名或 IP".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("设备地址不得包含用户名或密码".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("设备地址不得包含 query 或 fragment".to_string());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("设备地址只能填写根地址，不得附加 API 路径".to_string());
    }

    url.set_path("/");
    Ok(url)
}

fn diagnostic_path(resource: &str) -> Result<&'static str, String> {
    match resource {
        "device" => Ok("api/v1/device"),
        "hardware" => Ok("api/v1/hardware"),
        "network" => Ok("api/v1/network"),
        "sle" => Ok("api/v1/sle"),
        "io" => Ok("api/v1/io"),
        "config" => Ok("api/v1/config"),
        "services" => Ok("api/v1/services"),
        "health" => Ok("api/v1/health"),
        _ => Err("不允许访问未声明的 KZ3 诊断资源".to_string()),
    }
}

fn validate_point_name(point_name: &str) -> Result<(), String> {
    if point_name.is_empty() || point_name.len() > 48 {
        return Err("北向点位名长度必须为 1..48 字节".to_string());
    }
    if !point_name
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("北向点位名只能包含字母、数字、点、下划线和中划线".to_string());
    }
    Ok(())
}

fn validate_write_target(binding: &str, value: &Value) -> Result<(), String> {
    if !KZ3_HTTP_WRITE_RELEASED {
        return Err("当前产品版本未开放 KZ3 北向写入".to_string());
    }
    validate_point_name(binding).map_err(|_| "北向 bind 格式无效".to_string())?;
    if binding.starts_with("parameter.") {
        if value.is_boolean() || value.is_number() {
            return Ok(());
        }
        return Err("parameter 写入值只能是 JSON boolean 或 number".to_string());
    }
    let runtime_clear = binding
        .strip_prefix("runtime.")
        .and_then(|name| name.strip_suffix(".clear"))
        .is_some_and(|name| {
            !name.is_empty()
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        });
    if binding.starts_with("command.") || runtime_clear {
        if value.as_bool() == Some(true) {
            return Ok(());
        }
        return Err("command 只允许单次写入 JSON true，不允许复位、保持或数值写入".to_string());
    }
    Err("工具只允许写入 parameter.*、command.* 或 runtime.<name>.clear 北向字段，禁止直接写 point/state".to_string())
}

#[tauri::command]
pub async fn kz3_http_get_diagnostic(
    base_url: String,
    resource: String,
    state: tauri::State<'_, Kz3HttpClient>,
) -> Result<Kz3HttpResponse, String> {
    let base = normalize_base_url(&base_url)?;
    let url = base
        .join(diagnostic_path(&resource)?)
        .map_err(|_| "构建设备诊断 URL 失败".to_string())?;
    state.execute(reqwest::Method::GET, url, None).await
}

#[tauri::command]
pub async fn kz3_http_get_point(
    base_url: String,
    point_name: String,
    state: tauri::State<'_, Kz3HttpClient>,
) -> Result<Kz3HttpResponse, String> {
    validate_point_name(&point_name)?;
    let base = normalize_base_url(&base_url)?;
    let url = base
        .join(&format!("api/v1/point/{point_name}"))
        .map_err(|_| "构建设备点位 URL 失败".to_string())?;
    state.execute(reqwest::Method::GET, url, None).await
}

#[tauri::command]
pub async fn kz3_http_write_point(
    base_url: String,
    point_name: String,
    binding: String,
    value: Value,
    state: tauri::State<'_, Kz3HttpClient>,
) -> Result<Kz3HttpResponse, String> {
    validate_point_name(&point_name)?;
    validate_write_target(&binding, &value)?;

    let base = normalize_base_url(&base_url)?;
    let url = base
        .join(&format!("api/v1/point/{point_name}"))
        .map_err(|_| "构建设备点位 URL 失败".to_string())?;
    state
        .execute(
            reqwest::Method::POST,
            url,
            Some(serde_json::json!({ "value": value })),
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_只允许_http_根地址() {
        assert!(normalize_base_url("http://192.168.11.59:8080").is_ok());
        assert!(normalize_base_url("https://192.168.11.59").is_err());
        assert!(normalize_base_url("http://192.168.11.59/api/v1").is_err());
        assert!(normalize_base_url("http://user:pass@192.168.11.59").is_err());
    }

    #[test]
    fn 点位名拒绝路径穿透和超长输入() {
        assert!(validate_point_name("state.pid_running").is_ok());
        assert!(validate_point_name("../health").is_err());
        assert!(validate_point_name("state/pid").is_err());
        assert!(validate_point_name(&"a".repeat(49)).is_err());
    }

    #[test]
    fn 固定诊断资源采用白名单() {
        assert_eq!(diagnostic_path("io").unwrap(), "api/v1/io");
        assert!(diagnostic_path("config/network").is_err());
    }

    #[test]
    fn 当前测试版只开放受控北向写入() {
        assert!(validate_write_target("parameter.pid_setpoint", &serde_json::json!(12.5)).is_ok());
        assert!(validate_write_target("parameter.auto", &serde_json::json!(true)).is_ok());
        assert!(validate_write_target("command.start", &serde_json::json!(true)).is_ok());
        assert!(validate_write_target("command.start", &serde_json::json!(false)).is_err());
        assert!(validate_write_target("point.pump_run", &serde_json::json!(true)).is_err());
        assert!(validate_write_target("state.running", &serde_json::json!(true)).is_err());
        assert!(validate_write_target("parameter.note", &serde_json::json!("x")).is_err());
        assert!(validate_write_target("../parameter.x", &serde_json::json!(true)).is_err());
    }

    #[test]
    fn u32参数保持完整的十进制整数报文() {
        for value in [0u32, 65536, 180000, 2147483648, u32::MAX] {
            let json_value = serde_json::json!(value);
            assert!(validate_write_target("parameter.run_time", &json_value).is_ok());
            assert_eq!(
                serde_json::json!({ "value": json_value }).to_string(),
                format!("{{\"value\":{value}}}")
            );
        }
        assert!(validate_write_target("parameter.run_time", &serde_json::json!("1800")).is_err());
    }

    #[test]
    fn 运行时间清零仅开放明确的单次布尔命令() {
        for binding in ["command.start", "runtime.grating_01.clear"] {
            assert!(validate_write_target(binding, &serde_json::json!(true)).is_ok());
            for value in [
                serde_json::json!(false),
                serde_json::json!(1),
                serde_json::json!("true"),
            ] {
                assert!(validate_write_target(binding, &value).is_err());
            }
        }
        for binding in [
            "runtime.grating_01.seconds",
            "runtime.grating_01.clear_pending",
            "runtime..clear",
            "runtime.grating_01.extra.clear",
            "runtime.grating_01.clear.extra",
        ] {
            assert!(validate_write_target(binding, &serde_json::json!(true)).is_err());
        }
    }
}
