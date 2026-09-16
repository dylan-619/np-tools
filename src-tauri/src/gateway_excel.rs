use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::PathBuf;

const HEADERS: [&str; 14] = [
    "ID",
    "数据分组",
    "点位名称",
    "点位标签",
    "地址",
    "数据类型",
    "单位",
    "采集间隔(ms)",
    "从站地址",
    "功能码",
    "启用状态",
    "备注",
    "节点说明",
    "读写权限",
];

const DATA_TYPES: [&str; 6] = ["BOOLEAN", "INT16", "UINT16", "INT32", "UINT32", "FLOAT"];

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GatewayPointExportProfile {
    Kz3Northbound,
    SjzdPush,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayPointRow {
    id: String,
    group_name: String,
    point_name: String,
    point_tag: String,
    address: String,
    data_type: String,
    unit: String,
    collect_interval: u32,
    slave_id: u16,
    function_code: u8,
    enabled: String,
    remark: String,
    description: String,
    read_write_access: String,
}

fn validate_text(value: &str, label: &str, max_len: usize, required: bool) -> Result<(), String> {
    if required && value.trim().is_empty() {
        return Err(format!("{label}不能为空"));
    }
    if value.contains('\0') {
        return Err(format!("{label}不能包含 NUL 字符"));
    }
    if value.chars().count() > max_len {
        return Err(format!("{label}不能超过 {max_len} 个字符"));
    }
    Ok(())
}

fn validate_row(
    row: &GatewayPointRow,
    index: usize,
    profile: GatewayPointExportProfile,
    point_names: &mut HashSet<String>,
    occupied: &mut HashSet<(u16, u8, u32)>,
    push_keys: &mut HashSet<(u16, u32)>,
) -> Result<(), String> {
    let row_number = index + 2;
    validate_text(
        &row.group_name,
        &format!("第 {row_number} 行数据分组"),
        100,
        true,
    )?;
    validate_text(
        &row.point_name,
        &format!("第 {row_number} 行点位名称"),
        100,
        true,
    )?;
    validate_text(
        &row.point_tag,
        &format!("第 {row_number} 行点位标签"),
        100,
        true,
    )?;
    validate_text(&row.address, &format!("第 {row_number} 行地址"), 200, true)?;
    validate_text(
        &row.data_type,
        &format!("第 {row_number} 行数据类型"),
        50,
        true,
    )?;
    validate_text(&row.unit, &format!("第 {row_number} 行单位"), 20, false)?;
    validate_text(&row.remark, &format!("第 {row_number} 行备注"), 255, false)?;
    validate_text(
        &row.description,
        &format!("第 {row_number} 行节点说明"),
        500,
        false,
    )?;
    if !(1..=247).contains(&row.slave_id) {
        return Err(format!("第 {row_number} 行从站地址必须为 1～247"));
    }
    if row.collect_interval > 86_400_000 {
        return Err(format!("第 {row_number} 行采集间隔必须为 0～86400000 ms"));
    }
    if !(1..=4).contains(&row.function_code) {
        return Err(format!("第 {row_number} 行功能码必须为 1～4"));
    }
    if !DATA_TYPES.contains(&row.data_type.as_str()) {
        return Err(format!(
            "第 {row_number} 行数据类型不受网关支持：{}",
            row.data_type
        ));
    }
    if row.enabled != "启用" && row.enabled != "禁用" {
        return Err(format!("第 {row_number} 行启用状态必须为启用或禁用"));
    }
    if row.read_write_access != "R" && row.read_write_access != "R/W" {
        return Err(format!("第 {row_number} 行读写权限必须为 R 或 R/W"));
    }
    if !point_names.insert(row.point_name.clone()) {
        return Err(format!("第 {row_number} 行点位名称与前序点位重复"));
    }
    let is_boolean = row.data_type == "BOOLEAN";
    if is_boolean != matches!(row.function_code, 1 | 2) {
        return Err(format!("第 {row_number} 行数据类型与功能码不匹配"));
    }

    match profile {
        GatewayPointExportProfile::Kz3Northbound => {
            if row.address.len() != 5 || !row.address.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(format!(
                    "第 {row_number} 行地址必须是 KZ3 五位十进制 Modicon 地址"
                ));
            }
            let reference = row
                .address
                .parse::<u32>()
                .map_err(|_| format!("第 {row_number} 行地址无法解析"))?;
            let (expected_function_code, offset) = match reference {
                1..=9_999 => (1, reference - 1),
                10_001..=19_999 => (2, reference - 10_001),
                30_001..=39_999 => (4, reference - 30_001),
                40_001..=49_999 => (3, reference - 40_001),
                _ => {
                    return Err(format!(
                        "第 {row_number} 行地址不属于 KZ3 北向 Modbus 标准地址区"
                    ));
                }
            };
            if row.function_code != expected_function_code {
                return Err(format!("第 {row_number} 行地址与功能码不匹配"));
            }
            if row.read_write_access == "R/W" && matches!(row.function_code, 2 | 4) {
                return Err(format!("第 {row_number} 行只读地址区不能使用 R/W 权限"));
            }
            let width = if matches!(row.data_type.as_str(), "INT32" | "UINT32" | "FLOAT") {
                2
            } else {
                1
            };
            if offset + width - 1 > 9_998 {
                return Err(format!("第 {row_number} 行数据超出五位地址区边界"));
            }
            for register_offset in offset..offset + width {
                if !occupied.insert((row.slave_id, row.function_code, register_offset)) {
                    return Err(format!(
                        "第 {row_number} 行与前序点位的 Modbus 地址范围重叠"
                    ));
                }
            }
        }
        GatewayPointExportProfile::SjzdPush => {
            if !row.address.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(format!("第 {row_number} 行地址必须是十进制 PLC 地址"));
            }
            let address = row
                .address
                .parse::<u32>()
                .map_err(|_| format!("第 {row_number} 行地址无法解析"))?;
            if !(1..=65_535).contains(&address) {
                return Err(format!("第 {row_number} 行地址必须为 1～65535"));
            }
            if row.collect_interval != 0 {
                return Err(format!("第 {row_number} 行推送型点位采集间隔必须为 0"));
            }
            if row.read_write_access != "R" {
                return Err(format!("第 {row_number} 行终端上报点位只能使用 R 权限"));
            }
            // SJZDV3 的 JSON 键不含功能码，相同从站和起始地址会发生键覆盖。
            if !push_keys.insert((row.slave_id, address)) {
                return Err(format!(
                    "第 {row_number} 行与前序点位生成了重复的终端上报键"
                ));
            }
        }
    }
    Ok(())
}

fn build_workbook(
    rows: &[GatewayPointRow],
    profile: GatewayPointExportProfile,
) -> Result<Vec<u8>, String> {
    if rows.is_empty() {
        return Err("当前点位表为空，无法导出网关采集点".to_string());
    }
    let mut point_names = HashSet::new();
    let mut occupied = HashSet::new();
    let mut push_keys = HashSet::new();
    for (index, row) in rows.iter().enumerate() {
        validate_row(
            row,
            index,
            profile,
            &mut point_names,
            &mut occupied,
            &mut push_keys,
        )?;
    }

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("采集点数据")
        .map_err(|error| format!("设置 Excel 工作表名称失败: {error}"))?;

    let header_format = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x1F4E78))
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);
    let text_format = Format::new()
        .set_num_format("@")
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);
    let number_format = Format::new()
        .set_align(FormatAlign::Right)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin);

    worksheet
        .set_row_height(0, 26)
        .map_err(|error| format!("设置 Excel 表头高度失败: {error}"))?;
    for (column, header) in HEADERS.iter().enumerate() {
        worksheet
            .write_string_with_format(0, column as u16, *header, &header_format)
            .map_err(|error| format!("写入 Excel 表头失败: {error}"))?;
    }

    for (index, row) in rows.iter().enumerate() {
        let excel_row = (index + 1) as u32;
        let values = [
            row.id.as_str(),
            row.group_name.as_str(),
            row.point_name.as_str(),
            row.point_tag.as_str(),
            row.address.as_str(),
            row.data_type.as_str(),
            row.unit.as_str(),
        ];
        for (column, value) in values.iter().enumerate() {
            worksheet
                .write_string_with_format(excel_row, column as u16, *value, &text_format)
                .map_err(|error| format!("写入 Excel 第 {} 行失败: {error}", index + 2))?;
        }
        worksheet
            .write_number_with_format(excel_row, 7, row.collect_interval, &number_format)
            .and_then(|sheet| {
                sheet.write_number_with_format(excel_row, 8, row.slave_id, &number_format)
            })
            .and_then(|sheet| {
                sheet.write_number_with_format(excel_row, 9, row.function_code, &number_format)
            })
            .map_err(|error| format!("写入 Excel 第 {} 行数值字段失败: {error}", index + 2))?;
        let trailing = [
            row.enabled.as_str(),
            row.remark.as_str(),
            row.description.as_str(),
            row.read_write_access.as_str(),
        ];
        for (offset, value) in trailing.iter().enumerate() {
            worksheet
                .write_string_with_format(excel_row, (10 + offset) as u16, *value, &text_format)
                .map_err(|error| format!("写入 Excel 第 {} 行失败: {error}", index + 2))?;
        }
        worksheet
            .set_row_height(excel_row, 22)
            .map_err(|error| format!("设置 Excel 第 {} 行高度失败: {error}", index + 2))?;
    }

    let widths = [
        8.0, 18.0, 28.0, 28.0, 12.0, 12.0, 10.0, 16.0, 12.0, 10.0, 12.0, 34.0, 36.0, 12.0,
    ];
    for (column, width) in widths.iter().enumerate() {
        worksheet
            .set_column_width(column as u16, *width)
            .map_err(|error| format!("设置 Excel 列宽失败: {error}"))?;
    }
    worksheet
        .set_freeze_panes(1, 0)
        .map_err(|error| format!("冻结 Excel 表头失败: {error}"))?;
    worksheet
        .autofilter(0, 0, rows.len() as u32, 13)
        .map_err(|error| format!("设置 Excel 筛选失败: {error}"))?;

    workbook
        .save_to_buffer()
        .map_err(|error| format!("生成网关采集点 Excel 失败: {error}"))
}

#[tauri::command]
pub async fn gateway_points_export_xlsx(
    target_path: String,
    rows: Vec<GatewayPointRow>,
    profile: GatewayPointExportProfile,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = build_workbook(&rows, profile)?;
        if target_path.trim().is_empty() {
            return Err("导出路径无效，请选择 Excel 文件名".to_string());
        }
        let mut path = PathBuf::from(target_path);
        if path.file_name().is_none() {
            return Err("导出路径无效，请选择 Excel 文件名".to_string());
        }
        if path.is_dir() {
            return Err("导出目标不能是目录，请选择 Excel 文件名".to_string());
        }
        let has_xlsx_extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("xlsx"));
        if !has_xlsx_extension {
            path.set_extension("xlsx");
        }
        std::fs::write(&path, bytes)
            .map_err(|error| format!("保存网关采集点 Excel 失败 {}: {error}", path.display()))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| format!("网关采集点 Excel 导出任务异常: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    fn row(address: &str, data_type: &str, function_code: u8) -> GatewayPointRow {
        GatewayPointRow {
            id: String::new(),
            group_name: "KZ3 测试控制器".to_string(),
            point_name: format!("point_{address}"),
            point_tag: format!("point_{address}"),
            address: address.to_string(),
            data_type: data_type.to_string(),
            unit: String::new(),
            collect_interval: 1000,
            slave_id: 1,
            function_code,
            enabled: "启用".to_string(),
            remark: "KZ3 北向点位".to_string(),
            description: "测试点位".to_string(),
            read_write_access: "R".to_string(),
        }
    }

    #[test]
    fn creates_gateway_compatible_xlsx_container() {
        let bytes = build_workbook(
            &[
                row("00001", "BOOLEAN", 1),
                row("30001", "FLOAT", 4),
                row("40001", "UINT32", 3),
            ],
            GatewayPointExportProfile::Kz3Northbound,
        )
        .expect("xlsx should be generated");
        assert!(bytes.starts_with(b"PK"));
        assert!(bytes.len() > 4_000);

        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("valid OOXML zip");
        let mut shared_strings = String::new();
        archive
            .by_name("xl/sharedStrings.xml")
            .expect("shared strings should exist")
            .read_to_string(&mut shared_strings)
            .expect("shared strings should be readable");
        let mut previous_header_index = 0;
        for header in HEADERS {
            let header_index = shared_strings.find(header).expect("header should exist");
            assert!(
                header_index >= previous_header_index,
                "header order mismatch: {header}"
            );
            previous_header_index = header_index;
        }
        assert!(shared_strings.contains("00001"));
        assert!(shared_strings.contains("BOOLEAN"));
        assert!(shared_strings.contains("UINT32"));

        let mut worksheet = String::new();
        archive
            .by_name("xl/worksheets/sheet1.xml")
            .expect("first worksheet should exist")
            .read_to_string(&mut worksheet)
            .expect("worksheet should be readable");
        assert!(worksheet.contains("r=\"H2\""));
        assert!(worksheet.contains("r=\"I2\""));
        assert!(worksheet.contains("r=\"J2\""));
        let address_cell_start = worksheet
            .find("r=\"E2\"")
            .expect("address cell should exist");
        let address_cell_end = worksheet[address_cell_start..]
            .find("</c>")
            .expect("address cell should close")
            + address_cell_start;
        assert!(worksheet[address_cell_start..address_cell_end].contains("t=\"s\""));
    }

    #[test]
    fn rejects_type_function_code_mismatch_and_duplicate_key() {
        assert!(build_workbook(
            &[row("40001", "BOOLEAN", 3)],
            GatewayPointExportProfile::Kz3Northbound
        )
        .is_err());
        assert!(build_workbook(
            &[row("40001", "UINT32", 3), row("40002", "UINT16", 3),],
            GatewayPointExportProfile::Kz3Northbound
        )
        .is_err());
        assert!(build_workbook(
            &[row("30001", "UINT16", 3)],
            GatewayPointExportProfile::Kz3Northbound
        )
        .is_err());
    }

    #[test]
    fn sjzd_push_keeps_plc_address_and_rejects_duplicate_json_key() {
        let mut first = row("10001", "BOOLEAN", 1);
        first.collect_interval = 0;
        first.group_name = "SJZDV3 测试终端".to_string();
        let bytes = build_workbook(&[first], GatewayPointExportProfile::SjzdPush)
            .expect("SJZDV3 push xlsx should be generated");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("valid OOXML zip");
        let mut shared_strings = String::new();
        archive
            .by_name("xl/sharedStrings.xml")
            .expect("shared strings should exist")
            .read_to_string(&mut shared_strings)
            .expect("shared strings should be readable");
        assert!(shared_strings.contains("10001"));

        let mut duplicate = row("10001", "BOOLEAN", 2);
        duplicate.collect_interval = 0;
        duplicate.point_name = "another_point".to_string();
        duplicate.point_tag = "another_point".to_string();
        let mut original = row("10001", "BOOLEAN", 1);
        original.collect_interval = 0;
        assert!(
            build_workbook(&[original, duplicate], GatewayPointExportProfile::SjzdPush).is_err()
        );
    }
}
