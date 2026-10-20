//! NP-Tools-owned workspaces and deterministic host builds. No hardware APIs.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot, watch, Mutex, RwLock},
};

#[derive(Default)]
pub struct EngineeringState {
    pub workspaces: Mutex<HashMap<String, PathBuf>>,
    pub runtime: Mutex<Option<RuntimeHandle>>,
    pub build_lock: Mutex<()>,
    pub jobs: Mutex<HashMap<String, watch::Sender<bool>>>,
}

// Each build owns a process group, including compiler/verifier descendants.
struct ProcessGroup(u32);
static PROCESS_GROUPS: OnceLock<std::sync::Mutex<HashSet<u32>>> = OnceLock::new();
pub fn shutdown_groups() {
    if let Some(groups) = PROCESS_GROUPS.get() {
        if let Ok(groups) = groups.lock() {
            for id in groups.iter() {
                std::process::Command::new("/bin/kill")
                    .args(["-KILL", &format!("-{id}")])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .ok();
            }
        }
    }
}
impl ProcessGroup {
    fn new(id: u32) -> Self {
        if let Ok(mut groups) = PROCESS_GROUPS.get_or_init(Default::default).lock() {
            groups.insert(id);
        }
        Self(id)
    }
    fn signal(&self, signal: &str) {
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("/bin/kill")
                .args([signal, &format!("-{}", self.0)])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
    }
}
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        self.signal("-KILL");
        if let Some(groups) = PROCESS_GROUPS.get() {
            if let Ok(mut groups) = groups.lock() {
                groups.remove(&self.0);
            }
        }
    }
}

fn audit(work: &Path, run: &str, event: &str, detail: Value) {
    use std::io::Write;
    let dir = work.join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(format!("{run}.jsonl"));
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > 10 * 1024 * 1024) {
        return;
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(
            f,
            "{}",
            json!({"timeMs":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),"event":event,"detail":detail})
        );
    }
    let mut files = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|x| x.path().extension().is_some_and(|e| e == "jsonl"))
        .map(|e| e.path())
        .collect::<Vec<_>>();
    files.sort();
    for old in files.iter().take(files.len().saturating_sub(20)) {
        let _ = std::fs::remove_file(old);
    }
}
pub struct RuntimeHandle {
    pub run_id: String,
    pub workspace_id: String,
    pub sender: mpsc::Sender<RuntimeAction>,
    pub snapshot: Arc<RwLock<Value>>,
}
pub struct RuntimeAction {
    op: String,
    value: Value,
    reply: oneshot::Sender<Result<Value, String>>,
}
pub fn new_id() -> String {
    format!(
        "{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/engineering");
    if bundled.join("engineering.py").is_file() {
        return Ok(bundled);
    }
    if cfg!(debug_assertions) {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/engineering");
        if p.is_dir() {
            return Ok(p);
        }
    }
    Err("应用包缺少工程资源，请重新安装完整NP-Tools演示包".into())
}
pub async fn workspace(state: &EngineeringState, id: &str) -> Result<PathBuf, String> {
    state
        .workspaces
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "工程未加载，请重新导入点表".into())
}
async fn driver(
    app: &tauri::AppHandle,
    operation: &str,
    work: &Path,
    request: Value,
) -> Result<Value, String> {
    let root = resource_root(app)?;
    let request_path = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(format!("engineering-{}.json", new_id()));
    if let Some(p) = request_path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &request_path,
        serde_json::to_vec(&request).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let result = async {
        let mut cmd = Command::new("python3");
        cmd.arg(root.join("engineering.py"))
            .arg(operation)
            .arg("--workspace")
            .arg(work)
            .arg("--request")
            .arg(&request_path)
            .kill_on_drop(true);
        #[cfg(unix)]
        { use std::os::unix::process::CommandExt; cmd.as_std_mut().process_group(0); }
        cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        let child=cmd.spawn().map_err(|e|format!("无法启动Python运行环境：{e}；请在展前安装Python3和PyYAML"))?;
        let group=ProcessGroup::new(child.id().ok_or("无法识别工程进程")?);
        let (cancel_tx,mut cancel_rx)=watch::channel(false);
        let state=app.state::<EngineeringState>();
        let key=work.to_string_lossy().into_owned();
        state.jobs.lock().await.insert(key.clone(),cancel_tx);
        let out = tokio::select! {
            result=tokio::time::timeout(Duration::from_secs(120),child.wait_with_output())=>result.map_err(|_|"工程任务超时，已结束构建进程".to_string()).and_then(|r|r.map_err(|e|e.to_string())),
            _=cancel_rx.changed()=>{group.signal("-TERM");Err("工程任务已取消；上一成功交付保持可用".into())}
        };
        state.jobs.lock().await.remove(&key);
        let out=out?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr)
                .chars()
                .take(8000)
                .collect());
        }
        if out.stdout.len() > 8 * 1024 * 1024 {
            return Err("工程结果过大".into());
        }
        serde_json::from_slice(&out.stdout).map_err(|e| format!("工程结果格式错误：{e}"))
    }
    .await;
    let _ = std::fs::remove_file(request_path);
    result
}
#[tauri::command]
pub async fn engineering_cancel(
    workspace_id: String,
    state: tauri::State<'_, EngineeringState>,
) -> Result<(), String> {
    let work = workspace(&state, &workspace_id).await?;
    if let Some(job) = state
        .jobs
        .lock()
        .await
        .get(&work.to_string_lossy().into_owned())
    {
        let _ = job.send(true);
    }
    Ok(())
}
#[tauri::command]
pub async fn engineering_preflight(app: tauri::AppHandle) -> Result<Value, String> {
    let work = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    driver(&app, "preflight", &work, Value::Null).await
}
#[tauri::command]
pub async fn engineering_export(
    workspace_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let _guard = state
        .build_lock
        .try_lock()
        .map_err(|_| "已有工程任务在运行")?;
    let work = workspace(&state, &workspace_id).await?;
    let delivery: Value = serde_json::from_slice(
        &std::fs::read(work.join("current-delivery.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let result = driver(
        &app,
        "export",
        &work,
        json!({"directory":delivery["directory"]}),
    )
    .await?;
    let selected = app
        .dialog()
        .file()
        .set_file_name("NP-Tools演示工程.zip")
        .add_filter("工程包", &["zip"])
        .blocking_save_file();
    if let Some(file) = selected {
        let target = file.into_path().map_err(|e| e.to_string())?;
        std::fs::copy(result["path"].as_str().ok_or("缺少导出文件")?, &target)
            .map_err(|e| e.to_string())?;
        return Ok(json!({"saved":true,"sha256":result["sha256"]}));
    }
    Ok(json!({"saved":false}))
}
#[tauri::command]
pub async fn engineering_import(
    content: String,
    file_name: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    if content.len() > 5 * 1024 * 1024 {
        return Err("点表超过5MiB".into());
    }
    let file_name = file_name.unwrap_or("project_io.yaml".into());
    if file_name.len() > 160
        || file_name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err("点表文件名无效".into());
    }
    let id = new_id();
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ai-projects")
        .join(&id);
    let result = driver(&app, "prepare", &path, json!({"content":content})).await?;
    std::fs::write(
        path.join("input-metadata.json"),
        serde_json::to_vec(&json!({"fileName":file_name,"inputSha256":result["inputSha256"]}))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    state.workspaces.lock().await.insert(id.clone(), path);
    Ok(json!({"id":id,"input":result}))
}
#[tauri::command]
pub async fn engineering_sample(
    app: tauri::AppHandle,
    case_id: Option<String>,
) -> Result<String, String> {
    let file = match case_id.as_deref().unwrap_or("three-pump-level-control") {
        "three-pump-level-control" => "cases/three-pump-level-control/project_io.yaml",
        "water-supply-station" => "cases/water-supply-station/project_io.yaml",
        "two-device-output-sequence" => "case/project_io.yaml",
        _ => return Err("不支持的工艺案例".into()),
    };
    std::fs::read_to_string(resource_root(&app)?.join(file)).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn engineering_pick_file(
    app: tauri::AppHandle,
) -> Result<Option<(String, String)>, String> {
    use tauri_plugin_dialog::DialogExt;
    let selected = app
        .dialog()
        .file()
        .add_filter("KZ3点表", &["yaml", "yml", "ymal"])
        .blocking_pick_file();
    if let Some(file) = selected {
        let path = file.into_path().map_err(|e| e.to_string())?;
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 5 * 1024 * 1024 {
            return Err("点表超过5MiB".into());
        }
        let name = path
            .file_name()
            .ok_or("点表文件名无效")?
            .to_string_lossy()
            .into_owned();
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        return Ok(Some((name, text)));
    }
    Ok(None)
}
#[tauri::command]
pub async fn engineering_history(
    workspace_id: String,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Vec<String>, String> {
    let work = workspace(&state, &workspace_id).await?;
    let mut versions = Vec::new();
    if let Ok(dirs) = std::fs::read_dir(work.join("sdk/application/projects/工博会")) {
        for dir in dirs.flatten() {
            let name = dir.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') && dir.path().join("delivery-manifest.json").is_file() {
                versions.push(name);
            }
        }
    }
    versions.sort();
    Ok(versions)
}
#[tauri::command]
pub async fn engineering_select_version(
    workspace_id: String,
    version: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    let _guard = state
        .build_lock
        .try_lock()
        .map_err(|_| "已有工程任务在运行")?;
    let work = workspace(&state, &workspace_id).await?;
    let result = driver(&app, "restore-version", &work, json!({"version":version})).await?;
    std::fs::write(
        work.join("current-delivery.json"),
        serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    audit(
        &work,
        "engineering",
        "selected-history",
        result["manifest"]["identity"].clone(),
    );
    Ok(result)
}
#[tauri::command]
pub async fn engineering_generate(
    workspace_id: String,
    config: Value,
    requirements: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    let _guard = state
        .build_lock
        .try_lock()
        .map_err(|_| "已有工程任务运行中")?;
    if requirements.trim().is_empty() {
        return Err("请先确认需求".into());
    }
    let work = workspace(&state, &workspace_id).await?;
    std::fs::write(work.join("requirements.json"),serde_json::to_vec_pretty(&json!({"scope":"host_simulation","confirmed":true,"text":requirements,"config":config})).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let _ = app.emit(
        "engineering-job",
        json!({"workspaceId":workspace_id,"stage":"生成点表、编译并运行主机测试"}),
    );
    let result = driver(&app, "generate", &work, json!({"config":config})).await?;
    std::fs::write(
        work.join("current-delivery.json"),
        serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    audit(
        &work,
        "engineering",
        "generated",
        result["manifest"]["identity"].clone(),
    );
    Ok(result)
}
#[tauri::command]
pub async fn engineering_scene(
    workspace_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    let work = workspace(&state, &workspace_id).await?;
    let delivery: Value = serde_json::from_slice(
        &std::fs::read(work.join("current-delivery.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let scene = driver(
        &app,
        "scene",
        &work,
        json!({"config":delivery["manifest"]["config"]}),
    )
    .await?;
    std::fs::write(
        work.join("hmi-ready.json"),
        serde_json::to_vec(&delivery["manifest"]["identity"]).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let leaf = PathBuf::from(delivery["directory"].as_str().ok_or("缺少交付目录")?);
    driver(&app, "verify-delivery", &work, json!({"directory":leaf})).await?;
    std::fs::write(
        leaf.join("hmi-ready.json"),
        serde_json::to_vec(&delivery["manifest"]["identity"]).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(scene)
}
async fn exchange(
    stdin: &mut tokio::process::ChildStdin,
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    request: Value,
) -> Result<Value, String> {
    let id = request["id"].clone();
    let mut bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    stdin.write_all(&bytes).await.map_err(|e| e.to_string())?;
    let mut line = Vec::new();
    let scanning = request["op"] == "tick";
    let timeout = if scanning {
        Duration::from_millis(250)
    } else {
        Duration::from_secs(5)
    };
    let count = tokio::time::timeout(timeout, stdout.take(65537).read_until(b'\n', &mut line))
        .await
        .map_err(|_| {
            if scanning {
                "运行器扫描响应超时"
            } else {
                "运行器启动握手超时"
            }
        })?
        .map_err(|e| e.to_string())?;
    if count == 0 || count > 65536 || line.last() != Some(&b'\n') {
        return Err("运行器已退出或协议帧无效".into());
    }
    let v: Value = serde_json::from_slice(&line).map_err(|e| format!("运行器协议错误：{e}"))?;
    if v["ok"] != true || v["id"] != id {
        return Err("运行器响应序号不一致".into());
    }
    Ok(v)
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequest {
    pub workspace_id: String,
    pub run_id: String,
    pub op: String,
    pub value: Value,
}
#[tauri::command]
pub async fn simulation_action(
    request: RuntimeRequest,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel();
    {
        let runtime = state.runtime.lock().await;
        let handle = runtime.as_ref().ok_or("仿真未运行")?;
        if handle.run_id != request.run_id || handle.workspace_id != request.workspace_id {
            return Err("运行版本已切换，请刷新".into());
        }
        handle
            .sender
            .try_send(RuntimeAction {
                op: request.op,
                value: request.value,
                reply: tx,
            })
            .map_err(|_| "运行器忙或已停止")?;
    }
    tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .map_err(|_| "操作超时，不自动重试")?
        .map_err(|_| "运行器已停止".to_string())?
}
#[tauri::command]
pub async fn simulation_snapshot(
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    let runtime = state.runtime.lock().await;
    let h = runtime.as_ref().ok_or("仿真未启动")?;
    let mut v = h.snapshot.read().await.clone();
    v["runId"] = json!(h.run_id);
    v["workspaceId"] = json!(h.workspace_id);
    Ok(v)
}
// The synthetic plant does not travel or consume process time during OS scheduling pauses.
// Real C deadline tests exercise exact elapsed-time boundaries independently.
fn next_scan_time(software_plant: bool, previous: u64, host_elapsed: u64) -> u64 {
    if software_plant {
        previous + 10
    } else {
        host_elapsed
    }
}
// Float application parameters stay finite and use explicit integer milli-units on
// the private C wire. Preserve the old integer-only recipes unchanged.
fn encode_milli_parameter(value: &Value, min: f64, max: f64) -> Result<u32, String> {
    let number=value.as_f64().filter(|n|n.is_finite() && *n>=min && *n<=max)
        .ok_or("参数超出工艺允许范围")?;
    let scaled=number*1000.0;
    if (scaled-scaled.round()).abs()>0.00001 {return Err("参数最多保留三位小数".into());}
    Ok(scaled.round() as u32)
}

#[tauri::command]
pub async fn simulation_deploy(
    workspace_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    let _guard = state
        .build_lock
        .try_lock()
        .map_err(|_| "已有部署或生成任务在运行")?;
    let work = workspace(&state, &workspace_id).await?;
    let delivery: Value = serde_json::from_slice(
        &std::fs::read(work.join("current-delivery.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let directory = PathBuf::from(delivery["directory"].as_str().ok_or("缺少交付目录")?);
    if !directory
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(work.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("交付目录越界".into());
    }
    // The Python driver revalidates hashes before deployment (never trust a model path).
    driver(
        &app,
        "verify-delivery",
        &work,
        json!({"directory":directory}),
    )
    .await?;
    let mut child = Command::new(directory.join("host/runner"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().ok_or("stdin不可用")?;
    let mut output = BufReader::new(child.stdout.take().ok_or("stdout不可用")?);
    let hello = exchange(&mut input, &mut output, json!({"op":"hello","id":1})).await?;
    if hello["identity"] != delivery["manifest"]["identity"] {
        return Err("运行器工程身份与当前交付不匹配".into());
    }
    if let Some(old) = state.runtime.lock().await.take() {
        let (tx, rx) = oneshot::channel();
        let _ = old
            .sender
            .send(RuntimeAction {
                op: "stop".into(),
                value: Value::Null,
                reply: tx,
            })
            .await;
        let _ = tokio::time::timeout(Duration::from_secs(1), rx).await;
    }
    exchange(&mut input, &mut output, json!({"op":"activate","id":2})).await?;
    let run_id = new_id();
    let snapshot = Arc::new(RwLock::new(
        json!({"status":"starting","identity":hello["identity"]}),
    ));
    let (sender, mut actions) = mpsc::channel::<RuntimeAction>(32);
    let handle = RuntimeHandle {
        run_id: run_id.clone(),
        workspace_id: workspace_id.clone(),
        sender,
        snapshot: snapshot.clone(),
    };
    *state.runtime.lock().await = Some(handle);
    let identity = hello["identity"].clone();
    let rid = run_id.clone();
    audit(&work, &rid, "deployed", identity.clone());
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut r = BufReader::new(stderr);
            let mut scratch = vec![0u8; 4096];
            while let Ok(n) = r.read(&mut scratch).await {
                if n == 0 {
                    break;
                }
            }
        });
    }
    let water_station = delivery["manifest"]["config"]["caseId"] == "water-supply-station";
    let three_pump = delivery["manifest"]["config"]["caseId"] == "three-pump-level-control";
    let software_plant = water_station || three_pump;
    tokio::spawn(async move {
        let start = tokio::time::Instant::now();
        let mut previous = start;
        let mut id = 2u32;
        let mut inputs = if three_pump {2852u32} else if water_station { 1036u32 } else { 0u32 };
        let mut bad = 0u32;
        let mut release = [None::<u64>; 2];
        let mut interval = tokio::time::interval(Duration::from_millis(10));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut last_emit = 0u64;
        let mut last_phase = Value::Null;
        let mut simulation_ms = 0u64;
        let result:Result<(),String>=async {
            loop {
                interval.tick().await;let instant=tokio::time::Instant::now();
                let gap=instant.duration_since(previous);
                if gap>Duration::from_millis(250) {
                    if software_plant {audit(&work,&rid,"simulation-clock-paused",json!({"hostGapMs":gap.as_millis(),"processTimeMs":simulation_ms}));}
                    else {return Err("扫描延迟超过250ms，已中止当前运行，请重新部署".into());}
                }
                previous=instant;
                simulation_ms=next_scan_time(software_plant,simulation_ms,instant.duration_since(start).as_millis() as u64);
                let now=simulation_ms;
                for (i,until) in release.iter_mut().enumerate(){if until.is_some_and(|t|now>=t){inputs&=!(1<<i);*until=None;}}
                let mut cmd=0u32;let mut par=0u32;let mut val=0u32;let mut rev=0u32;let mut env=0u32;let mut setting=0u32;let mut reply=None;
                if let Ok(a)=actions.try_recv(){
                    let validate:Result<(),String>=(|| {
                        match a.op.as_str(){
                            "stop"=>{},
                            "permit" if !software_plant=>{let v=a.value.as_bool().ok_or("许可需要bool")?;if v{inputs|=4}else{inputs&=!4}},
                            "pulse" if !software_plant=>{let i=a.value.as_u64().ok_or("DI序号无效")? as usize;if i>1{return Err("仅DI1/DI2可脉冲".into());}if release[i].is_some(){return Err("该按钮脉冲尚未释放".into());}inputs|=1<<i;release[i]=Some(now+100);},
                            "command"=>{
                                let names: &[&str]=if three_pump { &["SYS_STA","SYS_STP","SYS_TRIP","DEG_STA","P1_RST","P2_RST","P3_RST","P1_RT_CLR","P2_RT_CLR","P3_RT_CLR"] } else if water_station { &["SYS_STA","SYS_STP","SYS_TRIP","P1_RST","P2_RST","XV_RST","P1_RT_CLR","P2_RT_CLR"] } else { &["LINE_START","LINE_STOP","LINE_PROTECT_STOP"] };
                                let name=a.value.as_str().ok_or("命令需要字段名")?;
                                let index=names.iter().position(|n|*n==name).ok_or("命令未在白名单中")?;
                                cmd=1<<index;
                            },
                            "parameter"=>{
                                let names: &[&str]=if three_pump { &["L_STOP_M","L_SP_M","L_VFD_M","L_AUX_M","PID_KP","PID_KI","START_MS","STAGE_MS","P_START_MS","P_STOP_MS"] } else if water_station { &["P_START_MS","P_STOP_MS","V_TRAVEL_MS","SWITCH_MS"] } else { &["START_DELAY_MS","CLEAR_DELAY_MS"] };
                                let name=a.value["name"].as_str().ok_or("缺少参数名")?;
                                par=1+names.iter().position(|n|*n==name).ok_or("参数未在白名单中")? as u32;
                                rev=u32::try_from(a.value["revision"].as_u64().ok_or("缺少参数revision")?).map_err(|_|"revision超限")?;
                                if three_pump && par<=6 {
                                    let ranges=[(0.1,0.8),(0.2,1.5),(0.3,1.7),(1.2,2.4),(0.0,30.0),(0.0,5.0)];
                                    let (min,max)=ranges[(par-1) as usize];
                                    val=encode_milli_parameter(&a.value["value"],min,max)?;
                                } else {
                                    val=u32::try_from(a.value["value"].as_u64().ok_or("参数必须为整数")?).map_err(|_|"参数超限")?;
                                    let (min,max)=if three_pump && par==7 {(500,5000)}else if three_pump && par==8 {(1000,30000)}else if water_station && par==3 {(4000,15000)}else if water_station && par==4 {(2000,5000)}else{(1000,10000)};
                                    if !(min..=max).contains(&val){return Err("参数超出工艺允许范围".into());}
                                }
                            },
                            "condition" if three_pump=>{
                                let bit=match a.value["name"].as_str(){Some("pump1Fault")=>1,Some("pump1Remote")=>2,Some("pump2Fault")=>4,Some("pump2Remote")=>5,Some("pump3Fault")=>7,Some("pump3Remote")=>8,Some("water")=>9,Some("permit")=>11,_=>return Err("不支持的三泵输入".into())};
                                let value=a.value["value"].as_bool().ok_or("工况值需要bool")?;
                                if value{inputs|=1<<bit}else{inputs&=!(1<<bit)}
                            },
                            "condition" if water_station=>{
                                let bit=match a.value["name"].as_str(){Some("source")=>2,Some("demand")=>3,Some("pump1Fault")=>5,Some("pump2Fault")=>7,Some("permit")=>10,_=>return Err("不支持的工况输入".into())};
                                let value=a.value["value"].as_bool().ok_or("工况值需要bool")?;
                                if value{inputs|=1<<bit}else{inputs&=!(1<<bit)}
                            },
                            "environment" if water_station=>{
                                env=match a.value["name"].as_str(){Some("tankLevel")=>1,Some("valveBlocked")=>2,Some("pump1NoFeedback")=>3,Some("pump2NoFeedback")=>4,Some("paused")=>5,Some("restore")=>6,_=>return Err("不支持的设备模型操作".into())};
                                setting=if env==1 {let value=a.value["value"].as_u64().filter(|v|*v<=10000).ok_or("液位需为0–10000整数")?;value as u32}else{u32::from(a.value["value"].as_bool().ok_or("设备模型状态需要bool")?)};
                            },
                            "environment" if three_pump=>{
                                env=match a.value["name"].as_str(){Some("levelMm")=>1,Some("inflow")=>2,Some("noFeedback")=>3,Some("stuckRunning")=>4,Some("levelFailed")=>5,Some("frequencyFailed")=>6,Some("restore")=>7,Some("frequencyLimit")=>8,_=>return Err("不支持的三泵模型操作".into())};
                                setting=if [1,2,3,4,8].contains(&env) {let max=match env{1=>3000,2=>3,8=>50000,_=>7};u32::try_from(a.value["value"].as_u64().filter(|n|*n<=max).ok_or("设备模型参数越界")?).map_err(|_|"设备模型参数越界")?}else{u32::from(a.value["value"].as_bool().ok_or("模型状态需要bool")?)};
                            },
                            "quality"=>{let requested=u32::try_from(a.value.as_u64().ok_or("质量掩码错误")?).map_err(|_|"质量掩码错误")?;if requested>if three_pump{16383}else if water_station{2047}else{7}{return Err("质量掩码错误".into());}bad=requested;},
                            _=>return Err("不允许的仿真操作".into())
                        }Ok(())
                    })();
                    if let Err(e)=validate {let _=a.reply.send(Err(e));continue;}
                    audit(&work,&rid,"action",json!({"op":a.op,"value":a.value}));
                    if a.op=="stop"{let _=a.reply.send(Ok(json!({"stopped":true})));return Ok(());}
                    reply=Some(a.reply);
                }
                id=id.checked_add(1).ok_or("请求序列耗尽，请重新部署")?;
                let mut request=json!({"op":"tick","id":id,"now":now as u32,"inputs":inputs,"bad":bad,"commands":cmd,"parameter":par,"value":val,"revision":rev});
                if software_plant {request["environment"]=json!(env);request["setting"]=json!(setting);}
                let mut frame=exchange(&mut input,&mut output,request).await?;
                frame["runId"]=json!(rid);frame["workspaceId"]=json!(workspace_id);frame["identity"]=identity.clone();frame["status"]=json!("running");
                *snapshot.write().await=frame.clone();
                let phase_name=if software_plant {"SYS_STATUS"}else{"LINE_PHASE"};
                if frame["fields"][phase_name]!=last_phase {last_phase=frame["fields"][phase_name].clone();audit(&work,&rid,"phase",json!({"phase":last_phase,"nowMs":now,"scanSequence":frame["scanSequence"]}));}
                if let Some(r)=reply{let response=if frame["result"]==0 {Ok(frame.clone())}else{Err(format!("操作被数据管理器拒绝（{}），请刷新参数/运行状态",frame["result"]))};let _=r.send(response);}
                if now>=last_emit+100{last_emit=now;let _=app.emit("simulation-snapshot",&frame);}
            }
        }.await;
        let _ = child.kill().await;
        let _ = child.wait().await;
        let status = json!({"runId":rid,"workspaceId":workspace_id,"status":if result.is_ok(){"stopped"}else{"failed"},"error":result.err(),"identity":identity});
        audit(&work, &rid, "ended", status.clone());
        *snapshot.write().await = status.clone();
        let _ = app.emit("simulation-snapshot", status);
    });
    Ok(json!({"runId":run_id,"identity":hello["identity"]}))
}

#[tauri::command]
pub async fn engineering_restore(
    workspace_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineeringState>,
) -> Result<Value, String> {
    if workspace_id.is_empty()
        || workspace_id.len() > 64
        || !workspace_id.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("工程标识无效".into());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ai-projects");
    let work = root
        .join(&workspace_id)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !work.starts_with(root.canonicalize().map_err(|e| e.to_string())?) {
        return Err("工程目录越界".into());
    }
    let original = work.join("original-project_io.yaml");
    if std::fs::metadata(&original)
        .map_err(|e| e.to_string())?
        .len()
        > 5 * 1024 * 1024
    {
        return Err("点表过大".into());
    }
    let content = std::fs::read_to_string(original).map_err(|e| e.to_string())?;
    let result = driver(&app, "validate", &work, json!({"content":content})).await?;
    let current = work.join("current-delivery.json");
    let mut delivery = Value::Null;
    if current.is_file() {
        if std::fs::metadata(&current)
            .map_err(|e| e.to_string())?
            .len()
            > 8 * 1024 * 1024
        {
            return Err("交付记录过大".into());
        }
        let candidate: Value =
            serde_json::from_slice(&std::fs::read(current).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        driver(
            &app,
            "verify-delivery",
            &work,
            json!({"directory":candidate["directory"]}),
        )
        .await?;
        delivery = candidate;
    }
    state
        .workspaces
        .lock()
        .await
        .insert(workspace_id.clone(), work.clone());
    let hmi_ready = [
        work.join("hmi-ready.json"),
        PathBuf::from(delivery["directory"].as_str().unwrap_or("")).join("hmi-ready.json"),
    ]
    .iter()
    .any(|p| {
        std::fs::read(p)
            .ok()
            .and_then(|s| serde_json::from_slice::<Value>(&s).ok())
            .is_some_and(|v| !delivery.is_null() && v == delivery["manifest"]["identity"])
    });
    if hmi_ready {
        if let Some(directory) = delivery["directory"].as_str() {
            let _ = std::fs::write(
                PathBuf::from(directory).join("hmi-ready.json"),
                serde_json::to_vec(&delivery["manifest"]["identity"]).unwrap_or_default(),
            );
        }
    }
    Ok(
        json!({"id":workspace_id,"content":content,"input":result,"delivery":delivery,"hmiReady":hmi_ready}),
    )
}

#[cfg(test)]
mod engineering_clock_tests {
    use super::{next_scan_time,encode_milli_parameter};
    use serde_json::json;
    #[test]
    fn lab_float_parameters_are_bounded_and_encoded_without_truncation() {
        assert_eq!(encode_milli_parameter(&json!(0.4),0.1,0.8).unwrap(),400);
        assert_eq!(encode_milli_parameter(&json!(0.6),0.0,5.0).unwrap(),600);
        for value in [json!(true),json!("0.4"),json!(-1),json!(0.0001),json!(6)] {
            assert!(encode_milli_parameter(&value,0.1,5.0).is_err());
        }
    }
    #[test]
    fn software_process_clock_does_not_jump_across_host_pause() {
        let mut clock = 0;
        for wall in [10, 20, 30, 20000, 20010] {
            clock = next_scan_time(true, clock, wall);
        }
        assert_eq!(clock, 50);
        assert_eq!(next_scan_time(false, 30, 20000), 20000);
    }
}
