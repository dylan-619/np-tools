//! Loopback-only OpenCode bridge. Credentials never enter workspace files.
use crate::engineering::{workspace, EngineeringState};
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::sync::Mutex;

pub struct OpenCodeState {
    client: Client,
    connection: Mutex<Option<Connection>>,
    stream: Mutex<Option<tokio::task::JoinHandle<()>>>,
}
#[derive(Clone)]
struct Connection {
    base: Url,
    user: String,
    password: String,
}
impl Default for OpenCodeState {
    fn default() -> Self {
        Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("OpenCode client"),
            connection: Mutex::new(None),
            stream: Mutex::new(None),
        }
    }
}
fn normalize(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "服务地址无效")?;
    if url.scheme() != "http"
        || !matches!(
            url.host_str(),
            Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
        )
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("只允许本机回环HTTP根地址，例如http://127.0.0.1:4096".into());
    }
    Ok(url)
}
async fn call(
    client: &Client,
    c: &Connection,
    path: &str,
    dir: &str,
    method: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut url = c.base.join(path).map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("directory", dir);
    let mut req = client
        .request(
            method
                .parse::<reqwest::Method>()
                .map_err(|e| e.to_string())?,
            url,
        )
        .timeout(Duration::from_secs(30));
    if !c.password.is_empty() {
        req = req.basic_auth(&c.user, Some(&c.password));
    }
    if let Some(v) = body {
        req = req.json(&v);
    }
    let mut response = req
        .send()
        .await
        .map_err(|e| format!("OpenCode请求失败：{e}"))?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("OpenCode响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(format!(
            "OpenCode HTTP {}：{}",
            status,
            String::from_utf8_lossy(&bytes)
                .chars()
                .take(800)
                .collect::<String>()
        ));
    }
    if bytes.is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_slice(&bytes).map_err(|e| format!("OpenCode返回非JSON：{e}"))
    }
}
#[tauri::command]
pub async fn opencode_connect(
    base_url: String,
    workspace_id: String,
    username: Option<String>,
    password: Option<String>,
    engineering: tauri::State<'_, EngineeringState>,
    state: tauri::State<'_, OpenCodeState>,
) -> Result<Value, String> {
    let dir = workspace(&engineering, &workspace_id)
        .await?
        .join("sdk")
        .to_string_lossy()
        .into_owned();
    let c = Connection {
        base: normalize(&base_url)?,
        user: username
            .filter(|v| !v.is_empty())
            .unwrap_or("opencode".into()),
        password: password.unwrap_or_default(),
    };
    let health = call(&state.client, &c, "global/health", &dir, "GET", None).await?;
    if health["healthy"] != true {
        return Err("OpenCode健康检查未通过".into());
    }
    let agents = call(&state.client, &c, "agent", &dir, "GET", None).await?;
    if !agents
        .as_array()
        .is_some_and(|a| a.iter().any(|x| x["name"] == "kz3-expo-engineer"))
    {
        return Err("工作副本未发现kz3-expo-engineer，请检查Server工作目录能力".into());
    }
    let providers = call(&state.client, &c, "provider", &dir, "GET", None).await?;
    let connected = providers["connected"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut models = Vec::new();
    if let Some(all) = providers["all"].as_array() {
        for p in all {
            if !connected.iter().any(|id| id == &p["id"]) {
                continue;
            }
            if let Some(available) = p["models"].as_object() {
                for (id, m) in available {
                    models.push(json!({"id":format!("{}/{}",p["id"].as_str().unwrap_or(""),id),"name":m["name"].as_str().unwrap_or(id)}));
                }
            }
        }
    }
    let configured = call(&state.client, &c, "config", &dir, "GET", None)
        .await
        .ok()
        .and_then(|v| v["model"].as_str().map(str::to_owned))
        .unwrap_or_default();
    let selected = if models.iter().any(|m| m["id"] == configured) {
        configured
    } else if models.iter().any(|m| m["id"] == "deepseek/deepseek-flash") {
        "deepseek/deepseek-flash".into()
    } else {
        models
            .first()
            .and_then(|m| m["id"].as_str())
            .unwrap_or("")
            .into()
    };
    *state.connection.lock().await = Some(c);
    Ok(json!({"health":health,"agents":agents,"models":models,"selectedModel":selected}))
}
fn identifier(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > 160
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err("请求ID无效".into());
    }
    Ok(id)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeRequest {
    workspace_id: String,
    operation: String,
    session_id: Option<String>,
    request_id: Option<String>,
    body: Option<Value>,
}
#[tauri::command]
pub async fn opencode_request(
    request: OpenCodeRequest,
    engineering: tauri::State<'_, EngineeringState>,
    state: tauri::State<'_, OpenCodeState>,
) -> Result<Value, String> {
    let dir = workspace(&engineering, &request.workspace_id)
        .await?
        .join("sdk")
        .to_string_lossy()
        .into_owned();
    let c = state
        .connection
        .lock()
        .await
        .clone()
        .ok_or("请先连接OpenCode")?;
    let session = if let Some(s) = request.session_id.as_deref() {
        identifier(s)?
    } else {
        ""
    };
    let id = if let Some(s) = request.request_id.as_deref() {
        identifier(s)?
    } else {
        ""
    };
    let (path, method) = match request.operation.as_str() {
        "create" => ("session".into(), "POST"),
        "messages" => (format!("session/{session}/message"), "GET"),
        "send" => (format!("session/{session}/prompt_async"), "POST"),
        "abort" => (format!("session/{session}/abort"), "POST"),
        "status" => ("session/status".into(), "GET"),
        "questions" => ("question".into(), "GET"),
        "permissions" => ("permission".into(), "GET"),
        "answer" => (format!("question/{id}/reply"), "POST"),
        "rejectQuestion" => (format!("question/{id}/reject"), "POST"),
        "permission" => (format!("permission/{id}/reply"), "POST"),
        _ => return Err("不允许的OpenCode操作".into()),
    };
    let mut body = request.body;
    if request.operation == "send" {
        let v = body.as_mut().ok_or("消息为空")?;
        v["agent"] = json!("kz3-expo-engineer");
    }
    if request.operation == "permission"
        && body
            .as_ref()
            .is_some_and(|v| v["reply"] != "once" && v["reply"] != "reject")
    {
        return Err("仅允许本次授权或拒绝".into());
    }
    call(&state.client, &c, &path, &dir, method, body).await
}
#[tauri::command]
pub async fn opencode_subscribe(
    workspace_id: String,
    on_event: Channel<Value>,
    engineering: tauri::State<'_, EngineeringState>,
    state: tauri::State<'_, OpenCodeState>,
) -> Result<(), String> {
    let dir = workspace(&engineering, &workspace_id)
        .await?
        .join("sdk")
        .to_string_lossy()
        .into_owned();
    let c = state
        .connection
        .lock()
        .await
        .clone()
        .ok_or("请先连接OpenCode")?;
    let mut url = c.base.join("event").map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("directory", &dir);
    let mut req = state.client.get(url);
    if !c.password.is_empty() {
        req = req.basic_auth(c.user, Some(c.password));
    }
    let mut res = tokio::time::timeout(Duration::from_secs(10), req.send())
        .await
        .map_err(|_| "SSE连接超时")?
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("SSE HTTP {}", res.status()));
    }
    if let Some(previous) = state.stream.lock().await.take() {
        previous.abort();
    }
    let handle = tokio::spawn(async move {
        let mut buffer = Vec::<u8>::new();
        let mut lines = Vec::<String>::new();
        loop {
            let chunk = match tokio::time::timeout(Duration::from_secs(60), res.chunk()).await {
                Ok(Ok(Some(b))) => b,
                _ => break,
            };
            buffer.extend_from_slice(&chunk);
            if buffer.len() > 1024 * 1024 {
                break;
            }
            while let Some(pos) = buffer.iter().position(|c| *c == b'\n') {
                let line = buffer.drain(..=pos).collect::<Vec<_>>();
                let text = match std::str::from_utf8(&line) {
                    Ok(s) => s.trim_end_matches(['\r', '\n']),
                    Err(_) => return,
                };
                if text.is_empty() {
                    if !lines.is_empty() {
                        if let Ok(v) = serde_json::from_str::<Value>(&lines.join("\n")) {
                            if on_event.send(v).is_err() {
                                return;
                            }
                        }
                        lines.clear();
                    }
                } else if let Some(data) = text.strip_prefix("data:") {
                    lines.push(data.strip_prefix(' ').unwrap_or(data).into());
                }
                if lines.iter().map(|s| s.len()).sum::<usize>() > 1024 * 1024 {
                    return;
                }
            }
        }
        let _ = on_event.send(json!({"type":"np.disconnected"}));
    });
    *state.stream.lock().await = Some(handle);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_only() {
        assert!(normalize("http://127.0.0.1:4096").is_ok());
        assert!(normalize("http://example.com").is_err());
        assert!(normalize("http://localhost/foo").is_err());
    }
}
