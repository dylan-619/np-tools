use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const WORKSPACE_SCHEMA: &str = "np-tools-workspace/v1";
const DEVICE_SCHEMA: &str = "np-tools-device/v1";
const MAX_CONFIG_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root_path: String,
    pub devices_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredControllerConfig {
    pub serial_number: String,
    pub path: String,
    pub revision_id: String,
    pub imported_at_ms: u64,
    pub content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceMetadata<'a> {
    schema: &'a str,
    created_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformBinding {
    organization_id: Option<String>,
    project_id: Option<String>,
    controller_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceMetadata<'a> {
    schema: &'a str,
    product_type: &'a str,
    serial_number: &'a str,
    platform_binding: PlatformBinding,
    created_at_ms: u64,
}

#[derive(Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentConfigPointer {
    revision_id: String,
    relative_path: String,
    imported_at_ms: u64,
}

fn now_ms() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| format!("系统时间无效: {error}"))?;
    u64::try_from(millis).map_err(|_| "系统时间超出工作空间格式范围".to_string())
}

fn now_ns() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|error| format!("系统时间无效: {error}"))
}

fn validate_workspace_root(root: &str) -> Result<PathBuf, String> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Err("请先选择本地工作空间目录".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("工作空间必须使用绝对路径".to_string());
    }
    Ok(path)
}

fn validate_serial_number(serial_number: &str) -> Result<&str, String> {
    let serial_number = serial_number.trim();
    if serial_number.is_empty() || serial_number.len() > 64 {
        return Err("设备 SN 长度必须为 1..64 个 ASCII 字符".to_string());
    }
    if !serial_number
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("设备 SN 只能包含字母、数字、中划线和下划线".to_string());
    }
    Ok(serial_number)
}

fn controller_root(root: &Path, serial_number: &str) -> PathBuf {
    root.join("devices").join("KZ3").join(serial_number)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| format!("生成工作空间元数据失败: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("写入工作空间元数据失败 {}: {error}", path.display()))
}

fn initialize_workspace(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.join("devices").join("KZ3"))
        .map_err(|error| format!("创建工作空间目录失败 {}: {error}", root.display()))?;
    let metadata_path = root.join("workspace.json");
    if !metadata_path.exists() {
        write_json(
            &metadata_path,
            &WorkspaceMetadata {
                schema: WORKSPACE_SCHEMA,
                created_at_ms: now_ms()?,
            },
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_initialize(root: String) -> Result<WorkspaceInfo, String> {
    let root = validate_workspace_root(&root)?;
    initialize_workspace(&root)?;
    Ok(WorkspaceInfo {
        root_path: root.to_string_lossy().into_owned(),
        devices_path: root.join("devices").to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn workspace_store_controller_config(
    root: String,
    serial_number: String,
    content: String,
) -> Result<StoredControllerConfig, String> {
    let root = validate_workspace_root(&root)?;
    let serial_number = validate_serial_number(&serial_number)?;
    if content.is_empty() {
        return Err("不能保存空配置文件".to_string());
    }
    if content.len() > MAX_CONFIG_BYTES {
        return Err(format!(
            "配置文件超过 {} MiB 安全上限",
            MAX_CONFIG_BYTES / 1024 / 1024
        ));
    }
    initialize_workspace(&root)?;

    let imported_at_ms = now_ms()?;
    let revision_id = format!("local-{}", now_ns()?);
    let device_root = controller_root(&root, serial_number);
    let revisions_root = device_root.join("configurations").join("revisions");
    let revision_root = revisions_root.join(&revision_id);
    fs::create_dir_all(&revision_root).map_err(|error| {
        format!(
            "创建设备配置版本目录失败 {}: {error}",
            revision_root.display()
        )
    })?;

    let config_path = revision_root.join("project_io.yaml");
    fs::write(&config_path, content.as_bytes())
        .map_err(|error| format!("保存设备配置失败 {}: {error}", config_path.display()))?;

    let device_metadata_path = device_root.join("device.json");
    if !device_metadata_path.exists() {
        write_json(
            &device_metadata_path,
            &DeviceMetadata {
                schema: DEVICE_SCHEMA,
                product_type: "KZ3",
                serial_number,
                platform_binding: PlatformBinding {
                    organization_id: None,
                    project_id: None,
                    controller_id: None,
                },
                created_at_ms: imported_at_ms,
            },
        )?;
    }

    let relative_path = Path::new("revisions")
        .join(&revision_id)
        .join("project_io.yaml");
    let current_pointer = CurrentConfigPointer {
        revision_id: revision_id.clone(),
        relative_path: relative_path.to_string_lossy().into_owned(),
        imported_at_ms,
    };
    let configurations_root = device_root.join("configurations");
    write_json(&configurations_root.join("current.json"), &current_pointer)?;

    Ok(StoredControllerConfig {
        serial_number: serial_number.to_string(),
        path: config_path.to_string_lossy().into_owned(),
        revision_id,
        imported_at_ms,
        content: None,
    })
}

#[tauri::command]
pub fn workspace_load_controller_config(
    root: String,
    serial_number: String,
) -> Result<Option<StoredControllerConfig>, String> {
    let root = validate_workspace_root(&root)?;
    let serial_number = validate_serial_number(&serial_number)?;
    let configurations_root = controller_root(&root, serial_number).join("configurations");
    let pointer_path = configurations_root.join("current.json");
    if !pointer_path.exists() {
        return Ok(None);
    }

    let pointer_content = fs::read_to_string(&pointer_path)
        .map_err(|error| format!("读取当前配置索引失败 {}: {error}", pointer_path.display()))?;
    let pointer: CurrentConfigPointer = serde_json::from_str(&pointer_content)
        .map_err(|error| format!("当前配置索引格式无效 {}: {error}", pointer_path.display()))?;
    if !pointer
        .revision_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("当前配置索引包含无效版本号".to_string());
    }
    let expected_relative_path = Path::new("revisions")
        .join(&pointer.revision_id)
        .join("project_io.yaml");
    if pointer.relative_path != expected_relative_path.to_string_lossy() {
        return Err("当前配置索引路径与版本号不一致".to_string());
    }
    let config_path = configurations_root.join(expected_relative_path);
    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("读取设备配置失败 {}: {error}", config_path.display()))?;
    if content.len() > MAX_CONFIG_BYTES {
        return Err(format!(
            "设备配置超过 {} MiB 安全上限",
            MAX_CONFIG_BYTES / 1024 / 1024
        ));
    }

    Ok(Some(StoredControllerConfig {
        serial_number: serial_number.to_string(),
        path: config_path.to_string_lossy().into_owned(),
        revision_id: pointer.revision_id,
        imported_at_ms: pointer.imported_at_ms,
        content: Some(content),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_serial_number_path_traversal() {
        assert!(validate_serial_number("../other-device").is_err());
        assert!(validate_serial_number("KZ3-2000000000000061").is_ok());
    }

    #[test]
    fn stores_and_loads_controller_config_by_serial_number() {
        let test_root = std::env::temp_dir().join(format!(
            "np-tools-workspace-test-{}-{}",
            std::process::id(),
            now_ns().expect("test timestamp")
        ));
        let root = test_root.to_string_lossy().into_owned();
        let serial_number = "2000000000000061".to_string();
        let yaml = "schema: kz3-project-io/v3\nproject:\n  id: local-test\n".to_string();

        workspace_initialize(root.clone()).expect("initialize workspace");
        let stored =
            workspace_store_controller_config(root.clone(), serial_number.clone(), yaml.clone())
                .expect("store controller config");
        let loaded = workspace_load_controller_config(root, serial_number)
            .expect("load controller config")
            .expect("stored config exists");

        assert_eq!(loaded.content.as_deref(), Some(yaml.as_str()));
        assert_eq!(loaded.revision_id, stored.revision_id);
        assert!(loaded.path.contains("devices"));
        assert!(loaded.path.contains("2000000000000061"));

        fs::remove_dir_all(&test_root).expect("remove isolated test workspace");
    }
}
