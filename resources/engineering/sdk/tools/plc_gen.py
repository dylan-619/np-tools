#!/usr/bin/env python3
"""生成 V3 的最小过程映像声明，并校验配置边界。

该工具只生成项目声明的字段；硬件 profile 负责描述物理通道和 Modbus
帧，project_io.yaml 负责实例绑定及北向统一字段。逻辑代码不接触 Point ID。
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
import re
import struct
import sys
import tempfile

import yaml


ADDRESS_RANGES = {
    "0": (1, 9999),       # Coils
    "1": (10001, 19999),  # Discrete Inputs
    "3": (30001, 39999),  # Input Registers
    "4": (40001, 49999),  # Holding Registers
}

SLE_TELEMETRY_MAX_KEY_BYTES = 48
# SLE 模组单次物理帧上限为 512 B，扣除 4 B 物理帧头后，应用帧上限
# 为 508 B。遥测的 stored-zlib 编码及应用头/CRC 固定占 36 B。
SLE_TELEMETRY_MAX_JSON_BYTES = 472
SLE_TELEMETRY_MAX_VALUE_BYTES = 16


def sle_telemetry_value_max_bytes(field: dict) -> int:
    """返回固定格式北向遥测值的最大文本长度，避免按 F32 上限误拒绝 BOOL/U16。"""
    value_type = field_c_type(field)

    if value_type == "bool":
        return 1
    if value_type in {"u8", "uint8_t", "u16", "uint16_t"}:
        return 5
    if value_type in {"u32", "uint32_t"}:
        return 10
    if value_type in {"i32", "int32_t"}:
        return 11
    return SLE_TELEMETRY_MAX_VALUE_BYTES
PROJECT_POINT_NAME_PATTERN = re.compile(r"[a-z][a-z0-9_]{0,47}")
PROJECT_POINT_DESCRIPTION_MAX_CHARS = 160

# 控制器生命周期属于运行时，不应要求每个 application 重复声明。
SYSTEM_COMMAND_DEFS = (
    {"name": "controller_start", "c_type": "bool", "behavior": "one_shot"},
    {"name": "controller_stop", "c_type": "bool", "behavior": "one_shot"},
    {"name": "controller_reset", "c_type": "bool", "behavior": "one_shot"},
)
SYSTEM_COMMAND_NAMES = {item["name"] for item in SYSTEM_COMMAND_DEFS}


def load(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as stream:
        value = yaml.safe_load(stream)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: 根节点必须是 mapping")
    return value


def validate_reference(raw: str, where: str) -> int:
    if not re.fullmatch(r"[0-9]{5}", str(raw)):
        raise ValueError(f"{where}: reference 必须是 5 位标准 Modbus 地址")
    address = int(raw)
    prefix = str(raw)[0]
    low, high = ADDRESS_RANGES[prefix] if prefix in ADDRESS_RANGES else (0, 0)
    if not low <= address <= high:
        raise ValueError(f"{where}: {raw} 不在标准功能码地址区间")
    return address


def c_ident(name: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_]", "_", name)
    value = re.sub(r"_+", "_", value).strip("_")
    if not value or value[0].isdigit():
        value = "field_" + value
    return value


def c_type(type_name: str) -> str:
    return {
        "bool": "bool",
        "float": "float",
        "f32": "float",
        "u8": "uint8_t",
        "uint8_t": "uint8_t",
        "u16": "uint16_t",
        "uint16_t": "uint16_t",
        "s16": "int16_t",
        "i16": "int16_t",
        "int16_t": "int16_t",
        "u32": "uint32_t",
        "uint32_t": "uint32_t",
        "s32": "int32_t",
        "i32": "int32_t",
        "int32_t": "int32_t",
    }.get(type_name, "float")


def field_c_type(field: dict) -> str:
    value = field.get("c_type")
    if value is None:
        bind = str(field.get("bind", ""))
        value = "float" if bind.endswith(".level") or bind.endswith(".level_high") else "bool"
    if value not in {"bool", "float", "f32", "u8", "u16", "u32", "s32", "i32",
                     "uint8_t", "uint16_t", "uint32_t", "int32_t"}:
        raise ValueError(f"字段 {field.get('name')}: 不支持的 c_type: {value}")
    return value


def field_width(field: dict) -> int:
    return 2 if field_c_type(field) in {
        "float", "f32", "u32", "uint32_t", "s32", "i32", "int32_t"
    } else 1


def storage_type_width(type_name: str) -> int:
    return 4 if type_name in {
        "float", "f32", "u32", "s32", "i32", "uint32_t", "int32_t"
    } else (2 if type_name in {
        "u16", "s16", "i16", "uint16_t", "int16_t"
    } else 1)


def north_value_type(field: dict) -> int:
    value = field_c_type(field)
    if value == "bool":
        return 0
    if value in {"float", "f32"}:
        return 1
    if value in {"u8", "uint8_t", "u16", "uint16_t"}:
        return 2
    if value in {"u32", "uint32_t"}:
        return 3
    if value in {"s32", "i32", "int32_t"}:
        return 4
    raise ValueError(f"字段 {field.get('name')}: 不支持的 c_type: {value}")


def c_float_literal(value: float) -> str:
    text = f"{value:.7g}"
    if "." not in text and "e" not in text and "E" not in text:
        text += ".0"
    return text + "f"


def logic_value_macro(field: dict) -> str:
    value = field_c_type(field)
    return {
        "bool": "LOGIC_VALUE_BOOL",
        "float": "LOGIC_VALUE_F32",
        "f32": "LOGIC_VALUE_F32",
        "u8": "LOGIC_VALUE_U16",
        "uint8_t": "LOGIC_VALUE_U16",
        "u16": "LOGIC_VALUE_U16",
        "uint16_t": "LOGIC_VALUE_U16",
        "u32": "LOGIC_VALUE_U32",
        "uint32_t": "LOGIC_VALUE_U32",
        "i32": "LOGIC_VALUE_S32",
        "s32": "LOGIC_VALUE_S32",
        "int32_t": "LOGIC_VALUE_S32",
    }[value]


def generate_sle_manifest(output_dir: Path, body: dict) -> None:
    fields = (body.get("northbound") or {}).get("fields") or []
    sorted_fields = sorted(fields, key=lambda item: str(item["name"]))
    key_lines = []
    route_lines = []
    for index, field in enumerate(sorted_fields, 1):
        name = str(field["name"])
        bind = resolve_project_bind(body, str(field["bind"]))
        runtime_parts = bind.split(".")
        if len(runtime_parts) == 3 and runtime_parts[0] == "runtime":
            runtime_bind = {
                "seconds": f"state.{runtime_parts[1]}_runtime_seconds",
                "clear": f"command.{runtime_parts[1]}_runtime_clear",
                "clear_pending":
                    f"state.{runtime_parts[1]}_runtime_clear_pending",
            }.get(runtime_parts[2])
            if runtime_bind is None:
                raise ValueError(f"runtime 成员不存在: {bind}")
            bind = runtime_bind
        parts = bind.split(".")
        value_macro = logic_value_macro(field)
        access = ("LOGIC_ACCESS_READ_STATUS | LOGIC_ACCESS_WRITE_PARAMETER"
                  if field.get("access") == "read_write" and bind.startswith("parameter.")
                  else ("LOGIC_ACCESS_READ_STATUS | LOGIC_ACCESS_WRITE_EXTERNAL_INPUT"
                        if field.get("access") == "read_write" and
                        bind.startswith("external.")
                        else ("LOGIC_ACCESS_WRITE_COMMAND" if bind.startswith("command.")
                              else "LOGIC_ACCESS_READ_STATUS")))
        owner = ("LOGIC_SERVICE_OWNER_PARAMETER" if bind.startswith("parameter.")
                 else ("LOGIC_SERVICE_OWNER_BOARD" if bind.startswith("board.")
                       else ("LOGIC_SERVICE_OWNER_MODBUS_RTU" if bind.startswith("rtu.")
                             else "LOGIC_SERVICE_OWNER_LOGIC")))
        transaction = "50U" if bind.startswith("parameter.") else "0U"
        register_count = "2U" if value_macro in {"LOGIC_VALUE_U32", "LOGIC_VALUE_S32", "LOGIC_VALUE_F32"} else "1U"
        key_lines.append(
            f'    {{{index}U, {len(name)}U, 0UL, {access}, "{name}"}},')
        route_lines.append(
            f"    {{0UL, {index}U, {value_macro}, {access}, "
            f"{owner}, {transaction}, 0U, 0U, {register_count}}},")

    header = [
        "#ifndef KZ3_PLC_V2_SLE_MANIFEST_H",
        "#define KZ3_PLC_V2_SLE_MANIFEST_H", "", 
        '#include "north_contract.h"', "",
        "extern const NorthKeyGeneratedTable g_plc_v2_sle_table;", "",
        "#endif", "",
    ]
    source = [
        "/* 自动生成：plc_project_gen.py；禁止手工修改。 */",
        '#include "plc_v2_sle_manifest.h"', "", "#include <string.h>", "",
        "static const NorthKeyDescriptor s_keys[] = {",
        *key_lines, "};", "",
        "static const NorthRoute s_routes[] = {",
        *route_lines, "};", "",
        "static int CompareKey(const char *left, uint16_t left_length,",
        "                      const char *right, uint16_t right_length)",
        "{",
        "    uint16_t common = left_length < right_length ? left_length : right_length;",
        "    int result = memcmp(left, right, common);",
        "    if (result != 0) return result;",
        "    return left_length < right_length ? -1 : (left_length > right_length ? 1 : 0);",
        "}", "",
        "static LogicResult Resolve(void *context, const char *key,",
        "                           uint16_t key_length, NorthRoute *route)",
        "{",
        "    uint16_t low = 0U;",
        f"    uint16_t high = {len(sorted_fields)}U;",
        "    (void)context;",
        "    if (key == NULL || route == NULL || key_length == 0U) return LOGIC_RESULT_INVALID_ARGUMENT;",
        "    while (low < high)",
        "    {",
        "        uint16_t middle = (uint16_t)(low + (high - low) / 2U);",
        "        int compare = CompareKey(s_keys[middle].key, s_keys[middle].key_length, key, key_length);",
        "        if (compare < 0) low = (uint16_t)(middle + 1U); else high = middle;",
        "    }",
        f"    if (low >= {len(sorted_fields)}U || CompareKey(s_keys[low].key, s_keys[low].key_length, key, key_length) != 0)",
        "        return LOGIC_RESULT_NOT_FOUND;",
        "    *route = s_routes[low];",
        "    return LOGIC_RESULT_OK;",
        "}", "",
        "static LogicResult Descriptor(void *context, uint16_t north_key_id,",
        "                              const NorthKeyDescriptor **descriptor)",
        "{",
        "    uint16_t index;",
        "    (void)context;",
        "    if (descriptor == NULL || north_key_id == 0U) return LOGIC_RESULT_INVALID_ARGUMENT;",
        f"    for (index = 0U; index < {len(sorted_fields)}U; ++index)",
        "        if (s_keys[index].north_key_id == north_key_id) { *descriptor = &s_keys[index]; return LOGIC_RESULT_OK; }",
        "    return LOGIC_RESULT_NOT_FOUND;",
        "}", "",
        "const NorthKeyGeneratedTable g_plc_v2_sle_table = {",
        "    Resolve, Descriptor, NULL", "};", "",
    ]
    (output_dir / "plc_v2_sle_manifest.h").write_text("\n".join(header), encoding="utf-8")
    (output_dir / "plc_v2_sle_manifest.c").write_text("\n".join(source), encoding="utf-8")


def load_profiles(definition_dir: Path) -> dict[str, dict]:
    profiles = {}
    for item in definition_dir.glob("rtu_profile_*.yaml"):
        profile = (load(item).get("profile") or {})
        if profile.get("name"):
            profiles[profile["name"]] = profile
    return profiles


def profile_signal_names(profile: dict) -> set[str]:
    names = {item["name"] for item in profile.get("signals", []) if item.get("name")}
    for channel in profile.get("channels", []):
        names.update(channel.get("names", []))
    return names


def profile_output_target(profile: dict, signal_name: str) -> dict:
    """解析一个数字/寄存器输出的 Modbus 写组和通道偏移。"""
    groups = {
        str(item.get("name")): item
        for item in profile.get("write_groups", [])
        if item.get("name")
    }
    for channel in profile.get("channels", []):
        kind = channel.get("kind")
        if kind not in {"digital_output", "analog_output"}:
            continue
        names = channel.get("names") or []
        if signal_name not in names:
            continue
        target = channel.get("target") or {}
        group_name = str(target.get("group", ""))
        if group_name not in groups:
            raise ValueError(
                f"Profile {profile.get('name')}: 输出 {signal_name} 引用不存在的写组 {group_name}")
        group = groups[group_name]
        function_name = str(group.get("function", ""))
        function = {"write_single_coil": 5,
                    "write_multiple_coils": 15,
                    "write_multiple_registers": 16}.get(function_name)
        if function is None:
            raise ValueError(
                f"Profile {profile.get('name')}: 输出写组 {group_name} 使用不支持的功能码 {function_name}")
        quantity = group.get("count", 1)
        maximum = 1968 if kind == "digital_output" else 8
        if not isinstance(quantity, int) or quantity <= 0 or quantity > maximum:
            raise ValueError(
                f"Profile {profile.get('name')}: 输出写组 {group_name} 的 count 必须为 1..{maximum}")
        if kind == "digital_output" and function not in {5, 15}:
            raise ValueError(
                f"Profile {profile.get('name')}: 数字输出写组 {group_name} 必须使用 FC05/FC15")
        if kind == "analog_output" and function != 16:
            raise ValueError(
                f"Profile {profile.get('name')}: 模拟输出写组 {group_name} 必须使用 FC16")
        first = target.get(
            "first_bit" if kind == "digital_output" else "first_register", 0)
        if not isinstance(first, int) or first < 0:
            raise ValueError(
                f"Profile {profile.get('name')}: 输出 {signal_name} 的通道偏移非法")
        channel_index = first + names.index(signal_name)
        if channel_index >= quantity:
            raise ValueError(
                f"Profile {profile.get('name')}: 输出 {signal_name} 超出写组 {group_name} 的 count")
        if kind == "analog_output":
            raw_min = group.get("raw_min")
            raw_max = group.get("raw_max")
            safe_value = group.get("default_safe_value")
            if (group.get("wire_type") != "u16" or
                    group.get("byte_word_order", "ab") != "ab"):
                raise ValueError(
                    f"Profile {profile.get('name')}: 模拟输出写组 {group_name} 当前只支持 AB 顺序的 U16")
            if (not isinstance(raw_min, int) or not isinstance(raw_max, int) or
                    raw_min < 0 or raw_min >= raw_max or raw_max > 65535):
                raise ValueError(
                    f"Profile {profile.get('name')}: 模拟输出写组 {group_name} raw_min/raw_max 非法")
            if (not isinstance(safe_value, int) or isinstance(safe_value, bool) or
                    safe_value < raw_min or safe_value > raw_max):
                raise ValueError(
                    f"Profile {profile.get('name')}: 模拟输出写组 {group_name} 默认安全值越界")
        else:
            raw_min = 0
            raw_max = 1
            safe_value = bool(group.get("default_safe_value", False))
        return {
            "function": function,
            "pdu_address": int(group.get("pdu_address", 0)),
            "channel_index": channel_index,
            "bit_index": channel_index,
            "quantity": quantity,
            "type": "bool" if kind == "digital_output" else "u16",
            "raw_min": raw_min,
            "raw_max": raw_max,
            "default_safe_value": safe_value,
        }
    raise ValueError(
        f"Profile {profile.get('name')}: 输出 {signal_name} 未找到输出 target")


def profile_input_source(profile: dict, signal_name: str) -> dict:
    """解析一个输入信号所属的读取块和块内通道下标。"""
    for channel in profile.get("channels", []):
        if channel.get("kind") not in {
                "digital_input", "digital_feedback", "analog_input"}:
            continue
        names = channel.get("names") or []
        if signal_name not in names:
            continue
        source = channel.get("source") or {}
        block_name = str(source.get("block", ""))
        first = source.get("first_bit", source.get("register_offset", 0))
        if not isinstance(first, int) or first < 0:
            raise ValueError(
                f"Profile {profile.get('name')}: 输入 {signal_name} 的 source 偏移非法")
        return {"block": block_name, "channel_index": first + names.index(signal_name)}
    for signal in profile.get("signals", []):
        if signal.get("name") == signal_name:
            source = signal.get("source") or {}
            block_name = str(source.get("block", ""))
            offset = source.get("register_offset", 0)
            if not isinstance(offset, int) or offset < 0:
                raise ValueError(
                    f"Profile {profile.get('name')}: 输入 {signal_name} 的 register_offset 非法")
            return {"block": block_name, "channel_index": offset}
    raise ValueError(
        f"Profile {profile.get('name')}: 输入 {signal_name} 未找到读取 source")


def profile_read_block(profile: dict, block_name: str) -> dict:
    for block in profile.get("read_blocks", []):
        if str(block.get("name")) == block_name:
            return block
    raise ValueError(
        f"Profile {profile.get('name')}: 输入引用不存在的读取块 {block_name}")


def profile_input_type(profile: dict, signal_name: str) -> int:
    for channel in profile.get("channels", []):
        if signal_name in (channel.get("names") or []):
            return 0
    for signal in profile.get("signals", []):
        if signal.get("name") == signal_name:
            return 1 if signal.get("wire_type") in {"f32", "float"} else 2
    return 0


def device_input_names(device: dict) -> list[str]:
    """返回 v2 中显式启用的 RTU 输入物理信号名。"""
    inputs = ((device.get("use") or {}).get("inputs") or [])
    if not isinstance(inputs, list):
        raise ValueError(f"device {device.get('name')}: use.inputs 必须为信号名列表")
    if not all(isinstance(name, str) and name for name in inputs):
        raise ValueError(f"device {device.get('name')}: use.inputs 必须为非空字符串列表")
    if len(inputs) != len(set(inputs)):
        raise ValueError(f"device {device.get('name')}: use.inputs 存在重复信号")
    return inputs


def project_points(project: dict) -> list[dict]:
    """按输入、输出顺序返回项目业务点；完整源校验由 validate() 完成。"""
    points = project.get("points")
    if not isinstance(points, dict):
        raise ValueError("project.points 必须为 mapping")
    unknown = set(points) - {"inputs", "outputs"}
    if unknown:
        raise ValueError("project.points 存在不支持分组: " + ", ".join(sorted(unknown)))
    result: list[dict] = []
    for direction in ("inputs", "outputs"):
        items = points.get(direction) or []
        if not isinstance(items, list):
            raise ValueError(f"project.points.{direction} 必须为列表")
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise ValueError(f"project.points.{direction}[{index}] 必须为 mapping")
            result.append({**item, "direction": direction})
    return result


def runtime_counters(project: dict) -> list[dict]:
    """返回声明式运行时间累计对象；完整 bind/type 校验由 validate() 完成。"""
    items = project.get("runtime_counters") or []
    if not isinstance(items, list):
        raise ValueError("project.runtime_counters 必须为列表")
    result: list[dict] = []
    names: set[str] = set()
    identifiers: set[str] = set()
    for index, item in enumerate(items):
        where = f"project.runtime_counters[{index}]"
        if not isinstance(item, dict):
            raise ValueError(f"{where} 必须为 mapping")
        unknown = set(item) - {"name", "description", "trigger"}
        if unknown:
            raise ValueError(
                f"{where} 存在不支持字段: " + ", ".join(sorted(unknown)))
        name = item.get("name")
        if (not isinstance(name, str) or
                PROJECT_POINT_NAME_PATTERN.fullmatch(name) is None):
            raise ValueError(
                f"{where}.name 必须匹配 [a-z][a-z0-9_]{{0,47}}")
        identifier = c_ident(name)
        if name in names or identifier in identifiers:
            raise ValueError(f"{where}.name 或 C 标识符重复: {name}")
        description = item.get("description")
        if (not isinstance(description, str) or not description.strip() or
                len(description.strip()) > PROJECT_POINT_DESCRIPTION_MAX_CHARS):
            raise ValueError(
                f"{where}.description 必须为 1..{PROJECT_POINT_DESCRIPTION_MAX_CHARS} 个字符")
        trigger = item.get("trigger")
        if not isinstance(trigger, dict):
            raise ValueError(f"{where}.trigger 必须为 mapping")
        unknown_trigger = set(trigger) - {"bind", "active_value", "quality"}
        if unknown_trigger:
            raise ValueError(
                f"{where}.trigger 存在不支持字段: " +
                ", ".join(sorted(unknown_trigger)))
        if not isinstance(trigger.get("bind"), str) or not trigger["bind"]:
            raise ValueError(f"{where}.trigger.bind 必须为非空字符串")
        if not isinstance(trigger.get("active_value"), bool):
            raise ValueError(f"{where}.trigger.active_value 必须为 bool")
        names.add(name)
        identifiers.add(identifier)
        result.append(item)
    return result


def resolve_project_bind(project: dict, bind: str) -> str:
    """将 point.<业务名> 解析为配置中唯一的物理 binding。"""
    if not bind.startswith("point."):
        return bind
    name = bind.split(".", 1)[1] if bind.count(".") == 1 else ""
    for point in project_points(project):
        if point.get("name") == name:
            return str(point["source"])
    raise ValueError(f"项目点不存在: {bind}")


def validate_board_definition(board: dict) -> None:
    """在生成期冻结板型的结构性事实，避免把明显错误带到实板。"""
    board_def = board.get("board") or {}
    seen_names: set[str] = set()
    groups = (
        ("digital_inputs", False),
        ("digital_outputs", False),
        ("analog_inputs", True),
        ("analog_outputs", True),
    )
    for group_name, analog in groups:
        seen_channels: set[int] = set()
        for index, item in enumerate(board_def.get(group_name, [])):
            if not isinstance(item, dict):
                raise ValueError(f"board.{group_name}[{index}] 必须为 mapping")
            name = item.get("name")
            terminal = item.get("terminal")
            channel = item.get("driver_channel")
            if not isinstance(name, str) or not name:
                raise ValueError(f"board.{group_name}[{index}].name 必须为非空字符串")
            if name in seen_names:
                raise ValueError(f"board: 通道名称重复: {name}")
            seen_names.add(name)
            if not isinstance(terminal, str) or not terminal:
                raise ValueError(f"board.{group_name}[{index}].terminal 必须为非空字符串")
            if not isinstance(channel, int) or channel < 0 or channel > 255:
                raise ValueError(
                    f"board.{group_name}[{index}].driver_channel 必须为 0..255")
            if channel in seen_channels:
                raise ValueError(
                    f"board.{group_name}: driver_channel 重复: {channel}")
            seen_channels.add(channel)
            if not analog:
                if group_name == "digital_inputs":
                    if item.get("active") not in ("low", "high"):
                        raise ValueError(
                            f"board.{group_name}[{index}].active 必须为 low/high")
                elif not isinstance(item.get("safe_value"), bool):
                    raise ValueError(
                        f"board.{group_name}[{index}].safe_value 必须为 bool")
                continue
            if not isinstance(item.get("electrical_verified"), bool):
                raise ValueError(
                    f"board.{group_name}[{index}].electrical_verified 必须为 bool；"
                    "未确认时请显式填写 false")
            minimum = item.get("software_min")
            maximum = item.get("software_max")
            if (not isinstance(minimum, (int, float)) or
                    not isinstance(maximum, (int, float)) or
                    not math.isfinite(float(minimum)) or
                    not math.isfinite(float(maximum)) or
                    float(minimum) >= float(maximum)):
                raise ValueError(
                    f"board.{group_name}[{index}] software_min/max 必须为有限且 min<max")
            if group_name == "analog_outputs":
                safe_value = item.get("safe_value")
                if (not isinstance(safe_value, (int, float)) or
                        not math.isfinite(float(safe_value)) or
                        not float(minimum) <= float(safe_value) <= float(maximum)):
                    raise ValueError(
                        f"board.{group_name}[{index}].safe_value 必须落在软件量程内")


def validate(project_path: Path) -> tuple[dict, dict]:
    project = load(project_path)
    if project.get("schema") != "kz3-project-io/v3":
        raise ValueError("project schema 必须为 kz3-project-io/v3")
    body = project.get("project") or {}
    if (type(body.get("scan_period_ms")) is not int or
            body["scan_period_ms"] <= 0):
        raise ValueError("project.scan_period_ms 必须为正整数")
    features = body.get("features") or {}
    for feature in ("pid", "counter", "retained"):
        if feature in features and not isinstance(features[feature], bool):
            raise ValueError(f"features.{feature} 必须为 bool")
    board_name = body.get("board")
    definition_dir = project_path.parent / "io_definitions"
    board = load(definition_dir / f"board_{board_name}.yaml")
    if board.get("schema") != "kz3-board/v1":
        raise ValueError("board schema 必须为 kz3-board/v1")
    validate_board_definition(board)

    board_def = board.get("board") or {}
    board_inputs = {item.get("name") for item in board_def.get("digital_inputs", [])}
    board_outputs = {item.get("name") for item in board_def.get("digital_outputs", [])}
    board_analog_inputs = {item.get("name") for item in board_def.get("analog_inputs", [])}
    board_analog_outputs = {item.get("name") for item in board_def.get("analog_outputs", [])}
    profiles = load_profiles(definition_dir)
    ports = body.get("rs485_ports") or {}
    for port_name, policy in ports.items():
        if port_name not in ("rs485_1", "rs485_2"):
            raise ValueError(
                f"rs485_ports.{port_name} 不受 V2 双总线硬件支持；只能使用 rs485_1/rs485_2")
        if not isinstance(policy, dict):
            raise ValueError(f"rs485_ports.{port_name} 必须为 mapping")
        for key in ("response_timeout_ms", "offline_backoff_ms"):
            if (not isinstance(policy.get(key), int) or policy[key] <= 0 or
                    policy[key] > 0xFFFF):
                raise ValueError(f"rs485_ports.{port_name}.{key} 必须为 1..65535")
        if (not isinstance(policy.get("retry_count"), int) or
                policy["retry_count"] < 0 or policy["retry_count"] > 0xFF):
            raise ValueError(f"rs485_ports.{port_name}.retry_count 必须为 0..255")
    devices = body.get("devices") or []
    names = set()
    port_addresses = set()
    device_bindings: dict[str, set[str]] = {}
    for device in devices:
        name = device.get("name")
        if not name or name in names:
            raise ValueError(f"device name 重复或为空: {name!r}")
        names.add(name)
        if device.get("port") not in ports:
            raise ValueError(f"device {name}: port 不存在: {device.get('port')!r}")
        address = device.get("slave_address")
        if not isinstance(address, int) or not 1 <= address <= 247:
            raise ValueError(f"device {name}: slave_address 必须在 1..247")
        key = (device["port"], address)
        if key in port_addresses:
            raise ValueError(f"device {name}: port/slave_address 重复: {key}")
        port_addresses.add(key)
        if not isinstance(device.get("poll_period_ms"), int) or device["poll_period_ms"] <= 0:
            raise ValueError(f"device {name}: poll_period_ms 必须为正整数")
        if (not isinstance(device.get("stale_after_ms"), int) or
                device["stale_after_ms"] <= 0 or
                device["stale_after_ms"] > 0xFFFFFFFF):
            raise ValueError(f"device {name}: stale_after_ms 必须为正整数")
        profile = profiles.get(device.get("profile"))
        if profile is None:
            raise ValueError(f"找不到 RTU profile: {device['profile']}")
        available = profile_signal_names(profile)
        used = set()
        use = device.get("use") or {}
        if not isinstance(use, dict):
            raise ValueError(f"device {name}: use 必须为 mapping")
        unknown_use = set(use) - {"inputs", "outputs"}
        if unknown_use:
            raise ValueError(
                f"device {name}: use 存在不支持分组: " +
                ", ".join(sorted(unknown_use)))
        for signal_name in device_input_names(device):
            if signal_name not in available:
                raise ValueError(f"device {name}: 输入信号不在 Profile: {signal_name}")
            profile_input_source(profile, signal_name)
            used.add(signal_name)
        outputs = use.get("outputs") or {}
        if not isinstance(outputs, dict):
            raise ValueError(f"device {name}: use.outputs 必须为 mapping")
        register_groups: dict[tuple[int, int, int], set[int]] = {}
        for signal_name, output_def in outputs.items():
            if signal_name not in available:
                raise ValueError(f"device {name}: 输出信号不在 Profile: {signal_name}")
            used.add(signal_name)
            if not isinstance(output_def, dict):
                raise ValueError(f"device {name}: 输出 {signal_name} 必须为 mapping")
            unknown_output = set(output_def) - {"safe_value", "confirm_timeout_ms"}
            if unknown_output:
                raise ValueError(
                    f"device {name}: 输出 {signal_name} 存在 v2 不支持字段: " +
                    ", ".join(sorted(unknown_output)))
            profile_output_target(profile, signal_name)
            if "safe_value" not in output_def:
                raise ValueError(
                    f"device {name}: 输出 {signal_name}.safe_value 必须显式声明")
            safe_value = output_def["safe_value"]
            target = profile_output_target(profile, signal_name)
            if target["type"] == "u16":
                group_key = (target["function"], target["pdu_address"],
                             target["quantity"])
                register_groups.setdefault(group_key, set()).add(
                    target["channel_index"])
            if target["type"] == "bool":
                if not isinstance(safe_value, bool):
                    raise ValueError(
                        f"device {name}: 输出 {signal_name}.safe_value 必须为 bool")
            elif (not isinstance(safe_value, int) or isinstance(safe_value, bool) or
                  safe_value < target["raw_min"] or safe_value > target["raw_max"]):
                raise ValueError(
                    f"device {name}: 输出 {signal_name}.safe_value 必须在 "
                    f"{target['raw_min']}..{target['raw_max']} 内")
        for (_, pdu_address, quantity), indexes in register_groups.items():
            if indexes != set(range(quantity)):
                raise ValueError(
                    f"device {name}: FC16 写组 0x{pdu_address:04X} 必须完整声明 "
                    f"0..{quantity - 1} 全部寄存器，避免未声明通道被覆盖")
        device_bindings[name] = used

    variables = body.get("application_variables") or {}
    if not isinstance(variables, dict):
        raise ValueError("project.application_variables 必须为 mapping")
    unknown_variables = set(variables) - {
        "parameters", "commands", "states", "external_inputs"
    }
    if unknown_variables:
        raise ValueError(
            "project.application_variables 存在不支持分组: " +
            ", ".join(sorted(unknown_variables)))
    external_items = variables.get("external_inputs") or []
    if not isinstance(external_items, list):
        raise ValueError("project.application_variables.external_inputs 必须为 list")
    external_names: set[str] = set()
    for index, item in enumerate(external_items):
        where = f"project.application_variables.external_inputs[{index}]"
        if not isinstance(item, dict):
            raise ValueError(f"{where} 必须为 mapping")
        unknown = set(item) - {
            "name", "c_type", "default", "min", "max",
            "stale_after_ms", "startup_grace_ms"
        }
        if unknown:
            raise ValueError(
                f"{where} 存在不支持字段: " + ", ".join(sorted(unknown)))
        name = item.get("name")
        if (not isinstance(name, str) or
                PROJECT_POINT_NAME_PATTERN.fullmatch(name) is None or
                name in external_names):
            raise ValueError(f"{where}.name 非法或重复")
        external_names.add(name)
        type_name = item.get("c_type")
        if type_name not in {"bool", "s32", "float"}:
            raise ValueError(f"{where}.c_type 只允许 bool/s32/float")
        default = item.get("default")
        if c_type(str(type_name)) == "bool":
            if not isinstance(default, bool) or "min" in item or "max" in item:
                raise ValueError(f"{where}: bool 必须给出 bool default，且不得声明 min/max")
        else:
            if "min" not in item or "max" not in item:
                raise ValueError(f"{where}: s32/float 必须声明 default/min/max")
            minimum = item["min"]
            maximum = item["max"]
            if c_type(str(type_name)) == "int32_t":
                values = (default, minimum, maximum)
                if (not all(isinstance(value, int) and not isinstance(value, bool)
                            for value in values) or
                        not all(-0x80000000 <= value <= 0x7FFFFFFF
                                for value in values)):
                    raise ValueError(f"{where}: s32 default/min/max 必须为 int32")
            else:
                values = (default, minimum, maximum)
                if not all(isinstance(value, (int, float)) and
                           not isinstance(value, bool) and
                           math.isfinite(float(value)) for value in values):
                    raise ValueError(f"{where}: float default/min/max 必须为有限数值")
                try:
                    f32_values = tuple(struct.unpack(
                        "<f", struct.pack("<f", float(value)))[0]
                        for value in values)
                except OverflowError as error:
                    raise ValueError(
                        f"{where}: float default/min/max 必须可表示为 float32") from error
                if any(float(value) != 0.0 and f32 == 0.0
                       for value, f32 in zip(values, f32_values)):
                    raise ValueError(
                        f"{where}: float default/min/max 不得下溢为 0")
                if not f32_values[1] <= f32_values[0] <= f32_values[2]:
                    raise ValueError(
                        f"{where}: float32 舍入后必须满足 min <= default <= max")
            if not minimum <= default <= maximum:
                raise ValueError(f"{where}: 必须满足 min <= default <= max")
        for key, allow_zero in (("stale_after_ms", False),
                                ("startup_grace_ms", True)):
            value = item.get(key)
            lower_bound = 0 if allow_zero else 1
            if (not isinstance(value, int) or isinstance(value, bool) or
                    value < lower_bound or value >= 0x80000000):
                raise ValueError(
                    f"{where}.{key} 必须为 {lower_bound}..2147483647 的整数")
    command_items = variables.get("commands") or []
    if not isinstance(command_items, list):
        raise ValueError("project.application_variables.commands 必须为 list")
    for index, command in enumerate(command_items):
        where = f"project.application_variables.commands[{index}]"
        if not isinstance(command, dict):
            raise ValueError(f"{where} 必须为 mapping")
        unknown = set(command) - {"name", "c_type", "behavior", "effect"}
        if unknown:
            raise ValueError(f"{where} 存在不支持字段: " +
                             ", ".join(sorted(unknown)))
        if command.get("c_type", "bool") != "bool":
            raise ValueError(f"{where}.c_type 必须为 bool")
        if command.get("behavior", "one_shot") != "one_shot":
            raise ValueError(f"{where}.behavior 必须为 one_shot")
        if command.get("effect", "normal") not in {"normal", "protective"}:
            raise ValueError(f"{where}.effect 必须为 normal 或 protective")
    parameters = {item.get("name") for item in variables.get("parameters", [])}
    application_commands = {
        item.get("name") for item in command_items
    }
    reserved_commands = application_commands & SYSTEM_COMMAND_NAMES
    if reserved_commands:
        raise ValueError(
            "application_variables.commands 不得重复声明系统命令: " +
            ", ".join(sorted(str(name) for name in reserved_commands)))
    commands = application_commands | SYSTEM_COMMAND_NAMES
    states = {item.get("name") for item in variables.get("states", [])}
    duplicated_variable_names = external_names & (parameters | application_commands | states)
    if duplicated_variable_names:
        raise ValueError(
            "external_inputs 不得与 parameter/command/state 重名: " +
            ", ".join(sorted(duplicated_variable_names)))
    runtimes = runtime_counters(body)
    runtime_names = [str(item["name"]) for item in runtimes]
    runtime_commands = {f"{name}_runtime_clear" for name in runtime_names}
    runtime_states = {
        "system_boot_count", "system_total_runtime_seconds",
        "retained_store_fault", "retained_store_fault_mask",
        "retained_store_busy",
    }
    for name in runtime_names:
        runtime_states.add(f"{name}_runtime_seconds")
        runtime_states.add(f"{name}_runtime_clear_pending")
    if runtimes and (application_commands & runtime_commands or
                     states & runtime_states):
        raise ValueError("application_variables 不得重复声明 runtime 框架字段")
    if runtimes:
        states |= {
            "system_boot_count", "system_total_runtime_seconds",
            "retained_store_fault", "retained_store_fault_mask",
            "retained_store_busy",
        }

    physical_types: dict[str, tuple[str, str]] = {}
    for name in board_inputs:
        physical_types[f"board.{name}"] = ("inputs", "bool")
    for name in board_outputs:
        physical_types[f"board.{name}"] = ("outputs", "bool")
    for name in board_analog_inputs:
        physical_types[f"board.{name}"] = ("inputs", "float")
    for name in board_analog_outputs:
        physical_types[f"board.{name}"] = ("outputs", "float")
    for device in devices:
        profile = profiles[str(device["profile"])]
        for signal_name in device_input_names(device):
            type_name = "float" if profile_input_type(profile, signal_name) == 1 else (
                "u16" if profile_input_type(profile, signal_name) == 2 else "bool")
            physical_types[f"rtu.{device['name']}.{signal_name}"] = ("inputs", type_name)
        for signal_name in ((device.get("use") or {}).get("outputs") or {}):
            target = profile_output_target(profile, str(signal_name))
            physical_types[f"rtu.{device['name']}.{signal_name}"] = (
                "outputs", target["type"])

    point_sources: dict[str, str] = {}
    point_types: dict[str, str] = {}
    used_sources: dict[str, str] = {}
    for index, point in enumerate(project_points(body)):
        where = f"project.points.{point['direction']}[{index}]"
        point_name = point.get("name")
        source = point.get("source")
        description = point.get("description")
        if (not isinstance(point_name, str) or
                PROJECT_POINT_NAME_PATTERN.fullmatch(point_name) is None):
            raise ValueError(
                f"{where}.name 必须匹配 [a-z][a-z0-9_]{{0,47}}")
        if point_name in point_sources:
            raise ValueError(f"项目点 name 重复: {point_name}")
        if not isinstance(source, str) or source not in physical_types:
            raise ValueError(f"{where}.source 不是已启用的物理点: {source!r}")
        source_direction, source_type = physical_types[source]
        if point["direction"] != source_direction:
            raise ValueError(
                f"{where}.source 方向错误: {source} 属于 {source_direction}")
        if source in used_sources:
            raise ValueError(
                f"物理点 {source} 被项目点 {used_sources[source]} 与 {point_name} 重复映射")
        if (not isinstance(description, str) or not description.strip() or
                len(description.strip()) > PROJECT_POINT_DESCRIPTION_MAX_CHARS):
            raise ValueError(
                f"{where}.description 必须为 1..{PROJECT_POINT_DESCRIPTION_MAX_CHARS} 个字符")
        point_sources[point_name] = source
        point_types[point_name] = source_type
        used_sources[source] = point_name

    parameter_types = {
        str(item.get("name")): c_type(str(item.get("c_type", "float")))
        for item in variables.get("parameters", [])
    }
    state_types = {
        str(item.get("name")): c_type(str(item.get("c_type", "bool")))
        for item in variables.get("states", [])
    }
    external_types = {
        str(item["name"]): c_type(str(item["c_type"]))
        for item in external_items
    }
    for index, runtime in enumerate(runtimes):
        where = f"project.runtime_counters[{index}].trigger"
        trigger = runtime["trigger"]
        bind = str(trigger["bind"])
        parts = bind.split(".")
        is_sample = False
        if len(parts) == 2 and parts[0] == "point":
            point_name = parts[1]
            if point_name not in point_sources:
                raise ValueError(f"{where}.bind 项目点不存在: {bind}")
            if c_type(point_types[point_name]) != "bool":
                raise ValueError(f"{where}.bind 必须引用 BOOL 项目点: {bind}")
            is_sample = next(
                item["direction"] for item in project_points(body)
                if item["name"] == point_name) == "inputs"
        elif len(parts) == 2 and parts[0] == "parameter":
            if parameter_types.get(parts[1]) != "bool":
                raise ValueError(f"{where}.bind 必须引用 BOOL parameter: {bind}")
        elif len(parts) == 2 and parts[0] == "state":
            if state_types.get(parts[1]) != "bool":
                raise ValueError(f"{where}.bind 必须引用 BOOL state: {bind}")
        else:
            raise ValueError(
                f"{where}.bind 只允许 point.<业务点>、parameter.<名称> 或 state.<名称>")
        quality = trigger.get("quality")
        if is_sample and quality != "good":
            raise ValueError(f"{where}.quality 对输入业务点必须显式为 good")
        if not is_sample and "quality" in trigger:
            raise ValueError(f"{where}.quality 只适用于带质量的输入业务点")

    fields = (body.get("northbound") or {}).get("fields") or []
    field_names = set()
    used_addresses: set[tuple[str, int]] = set()
    sle_packet_max_bytes = 2
    sle_packet_bytes = 2
    for index, field in enumerate(fields):
        name = field.get("name")
        if not name or name in field_names:
            raise ValueError(f"northbound.fields[{index}] name 重复或为空")
        if (not isinstance(name, str) or
                re.fullmatch(r"[A-Za-z0-9_.-]{1,48}", name) is None or
                len(name.encode("ascii")) > SLE_TELEMETRY_MAX_KEY_BYTES):
            raise ValueError(
                f"northbound.fields[{index}] name 必须为 1..48 字节 ASCII，"
                "且只能包含字母、数字、_、-、.")
        field_names.add(name)
        field_json_bytes = len(name) + 3 + sle_telemetry_value_max_bytes(field)
        candidate_bytes = sle_packet_bytes + \
            (1 if sle_packet_bytes > 2 else 0) + field_json_bytes
        if candidate_bytes > SLE_TELEMETRY_MAX_JSON_BYTES:
            sle_packet_max_bytes = max(sle_packet_max_bytes, sle_packet_bytes)
            sle_packet_bytes = 2 + field_json_bytes
        else:
            sle_packet_bytes = candidate_bytes
        reference = str(field.get("reference", ""))
        address = validate_reference(reference, f"northbound.fields[{index}]")
        width = field_width(field)
        prefix = reference[0]
        value_type = field_c_type(field)
        if value_type == "bool" and prefix not in {"0", "1"}:
            raise ValueError(
                f"northbound.fields[{index}]: BOOL 只能使用 Coils(0xxxx) 或 Discrete Inputs(1xxxx)")
        if value_type != "bool" and prefix not in {"3", "4"}:
            raise ValueError(
                f"northbound.fields[{index}]: 数值类型只能使用 Input Registers(3xxxx) 或 Holding Registers(4xxxx)")
        if field.get("access") == "read_write" and prefix in {"1", "3"}:
            raise ValueError(
                f"northbound.fields[{index}]: {reference} 所属地址区只读，不能声明 read_write")
        base = {"0": 1, "1": 10001, "3": 30001, "4": 40001}[prefix]
        for offset in range(width):
            slot = (prefix, address - base + offset)
            if slot in used_addresses:
                raise ValueError(f"northbound.fields[{index}]: 地址重叠: {reference} (+{offset})")
            used_addresses.add(slot)
        if field.get("access") not in ("read", "read_write"):
            raise ValueError(f"northbound.fields[{index}]: access 必须为 read/read_write")
        bind = str(field.get("bind", ""))
        runtime_parts = bind.split(".")
        if len(runtime_parts) == 3 and runtime_parts[0] == "runtime":
            runtime_name = runtime_parts[1]
            runtime_member = runtime_parts[2]
            if runtime_name not in runtime_names:
                raise ValueError(
                    f"northbound.fields[{index}]: runtime 不存在: {bind}")
            expected = {
                "seconds": ("u32", "read"),
                "clear": ("bool", "read_write"),
                "clear_pending": ("bool", "read"),
            }.get(runtime_member)
            if expected is None:
                raise ValueError(
                    f"northbound.fields[{index}]: runtime 成员不存在: {bind}")
            if field_c_type(field) != expected[0] or field.get("access") != expected[1]:
                raise ValueError(
                    f"northbound.fields[{index}]: {bind} 必须为 "
                    f"{expected[0]}/{expected[1]}")
            continue
        if bind.startswith("point."):
            point_name = bind.split(".", 1)[1] if bind.count(".") == 1 else ""
            if point_name not in point_sources:
                raise ValueError(f"northbound.fields[{index}]: 项目点不存在: {bind}")
            if c_type(field_c_type(field)) != c_type(point_types[point_name]):
                raise ValueError(f"northbound.fields[{index}]: {bind} 的 c_type 与源点不一致")
            bind = point_sources[point_name]
        parts = bind.split(".")
        if parts[0] == "board":
            if len(parts) != 2:
                raise ValueError(f"northbound.fields[{index}]: 板载绑定不存在: {bind}")
            if parts[1] in board_analog_inputs | board_analog_outputs:
                raise ValueError(
                    f"northbound.fields[{index}]: {bind} 属于板载模拟量，当前 V2 过程映像尚未接入；"
                    "完成 ADC/DAC 采样任务和安全值验证后才能发布")
            if parts[1] not in board_inputs | board_outputs:
                raise ValueError(f"northbound.fields[{index}]: 板载绑定不存在: {bind}")
        elif parts[0] == "rtu":
            if len(parts) != 3 or parts[1] not in device_bindings or parts[2] not in device_bindings[parts[1]]:
                raise ValueError(f"northbound.fields[{index}]: RTU 绑定未在实例 use 中声明: {bind}")
        elif parts[0] == "parameter" and (len(parts) != 2 or parts[1] not in parameters):
            raise ValueError(f"northbound.fields[{index}]: 参数未声明: {bind}")
        elif parts[0] == "command" and (len(parts) != 2 or parts[1] not in commands):
            raise ValueError(f"northbound.fields[{index}]: 命令未声明: {bind}")
        elif parts[0] == "state" and (len(parts) != 2 or parts[1] not in states):
            raise ValueError(f"northbound.fields[{index}]: 状态未声明: {bind}")
        elif parts[0] == "external":
            if len(parts) != 2 or parts[1] not in external_types:
                raise ValueError(f"northbound.fields[{index}]: 外部输入未声明: {bind}")
            if c_type(field_c_type(field)) != external_types[parts[1]]:
                raise ValueError(
                    f"northbound.fields[{index}]: {bind} 的 c_type 与声明不一致")
        elif parts[0] not in {
                "board", "rtu", "parameter", "command", "state", "external"}:
            raise ValueError(f"northbound.fields[{index}]: 未知绑定类别: {bind}")
        if parts[0] in {"parameter", "command", "external"} and \
                field.get("access") != "read_write":
            raise ValueError(
                f"northbound.fields[{index}]: {parts[0]} 必须声明 read_write")
        if parts[0] == "state" and field.get("access") != "read":
            raise ValueError(
                f"northbound.fields[{index}]: state 只能声明 read")
    for name in external_names:
        matches = [
            field for field in fields
            if field.get("bind") == f"external.{name}"
        ]
        if len(matches) != 1 or matches[0].get("access") != "read_write":
            raise ValueError(
                f"external.{name} 必须且只能对应一个 read_write 北向字段")
    protocols = (body.get("northbound") or {}).get("protocols") or []
    sle_packet_max_bytes = max(sle_packet_max_bytes, sle_packet_bytes)
    if "sle" in protocols and sle_packet_max_bytes > SLE_TELEMETRY_MAX_JSON_BYTES:
        raise ValueError(
            f"northbound.fields 的 SLE 单分包 JSON 最坏长度 {sle_packet_max_bytes} "
            f"超过单帧上限 {SLE_TELEMETRY_MAX_JSON_BYTES}")
    return body, board


def generate(project_path: Path, output_dir: Path) -> None:
    body, board = validate(project_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    inputs = [item["name"] for item in board.get("board", {}).get("digital_inputs", [])]
    outputs = [item["name"] for item in board.get("board", {}).get("digital_outputs", [])]
    analog_inputs = [item["name"] for item in board.get("board", {}).get("analog_inputs", [])]
    analog_outputs = [item["name"] for item in board.get("board", {}).get("analog_outputs", [])]
    qualification = board.get("board", {}).get("qualification") or {}
    variables = body.get("application_variables") or {}
    features = body.get("features") or {}
    parameter_defs = variables.get("parameters", [])
    command_defs = [*SYSTEM_COMMAND_DEFS, *variables.get("commands", [])]
    state_defs = variables.get("states", [])
    parameters = [item["name"] for item in parameter_defs]
    commands = [item["name"] for item in command_defs]
    states = [item["name"] for item in state_defs]

    lines = [
        "/* 自动生成：plc_project_gen.py；请修改 project_io.yaml 后重新生成。 */",
        "#ifndef KZ3_PLC_V2_GENERATED_H",
        "#define KZ3_PLC_V2_GENERATED_H",
        "",
        "#include <stdbool.h>",
        "#include <stdint.h>",
        "",
        f"#define KZ3_PLC_V2_BOARD_INPUT_COUNT {len(inputs)}U",
        f"#define KZ3_PLC_V2_BOARD_OUTPUT_COUNT {len(outputs)}U",
        f"#define KZ3_PLC_V2_PARAMETER_COUNT {len(parameters)}U",
        f"#define KZ3_PLC_V2_COMMAND_COUNT {len(commands)}U",
        f"#define KZ3_PLC_V2_STATE_COUNT {len(states)}U",
        "",
        "typedef struct",
        "{",
    ]
    for name in inputs:
        lines.append(f"    bool {c_ident(name)};")
    lines += ["} PlcV2GeneratedBoardInputs;", "", "typedef struct", "{"]
    for name in outputs:
        lines.append(f"    bool {c_ident(name)};")
    lines += ["} PlcV2GeneratedBoardOutputs;", ""]
    for struct_name, definitions in (("Parameters", parameter_defs),
                                     ("Commands", command_defs),
                                     ("States", state_defs)):
        lines += ["typedef struct", "{"]
        for definition in definitions:
            lines.append(f"    {c_type(definition.get('c_type', 'float'))} "
                         f"{c_ident(definition['name'])};")
        lines += [f"}} PlcV2Generated{struct_name};", ""]
    for device in body.get("devices") or []:
        profile = load_profiles(project_path.parent / "io_definitions")[device["profile"]]
        signal_types = {}
        for signal in profile.get("signals", []):
            signal_types[signal.get("name")] = c_type("float" if signal.get("wire_type") == "f32" else "bool")
        use = device.get("use") or {}
        lines += ["typedef struct", "{"]
        for signal_name in device_input_names(device):
            lines.append(f"    {signal_types.get(signal_name, 'bool')} {c_ident(signal_name)};")
        for signal_name in (use.get("outputs") or {}):
            target = profile_output_target(profile, signal_name)
            lines.append(f"    {c_type(target['type'])} {c_ident(signal_name)};")
        lines += [f"}} PlcV2GeneratedRtu_{c_ident(device['name'])};", ""]
    lines += ["#endif", ""]
    (output_dir / "plc_v2_generated.h").write_text("\n".join(lines), encoding="utf-8")

    devices = body.get("devices") or []
    north_fields = [
        {**field, "bind": resolve_project_bind(body, str(field["bind"]))}
        for field in ((body.get("northbound") or {}).get("fields") or [])
    ]
    profiles = load_profiles(project_path.parent / "io_definitions")
    function_codes = {
        "read_coils": 1,
        "read_discrete_inputs": 2,
        "read_holding_registers": 3,
        "read_input_registers": 4,
    }
    project_header = [
        "/* 自动生成：plc_project_gen.py；禁止手工修改。 */",
        "#ifndef KZ3_PLC_V2_PROJECT_GENERATED_H",
        "#define KZ3_PLC_V2_PROJECT_GENERATED_H", "",
        "#include <stdbool.h>", "#include <stdint.h>", "",
        f"#define KZ3_PLC_V2_RTU_DEVICE_COUNT {len(devices)}U",
        f"#define KZ3_PLC_V2_NORTH_FIELD_COUNT {len(north_fields)}U", "",
        f"#define KZ3_PLC_V2_SCAN_PERIOD_MS {int(body['scan_period_ms'])}U", "",
    ]
    configured_ports = body.get("rs485_ports") or {}
    for port_name in ("rs485_1", "rs485_2"):
        policy = configured_ports.get(port_name)
        if policy is None:
            project_header += [
                f"#define KZ3_PLC_V2_RTU_{port_name.upper()}_RESPONSE_TIMEOUT_MS 0U",
                f"#define KZ3_PLC_V2_RTU_{port_name.upper()}_RETRY_COUNT 0U",
                f"#define KZ3_PLC_V2_RTU_{port_name.upper()}_OFFLINE_BACKOFF_MS 0U",
            ]
            continue
        macro_name = c_ident(str(port_name)).upper()
        project_header += [
            f"#define KZ3_PLC_V2_RTU_{macro_name}_RESPONSE_TIMEOUT_MS "
            f"{int(policy['response_timeout_ms'])}U",
            f"#define KZ3_PLC_V2_RTU_{macro_name}_RETRY_COUNT "
            f"{int(policy['retry_count'])}U",
            f"#define KZ3_PLC_V2_RTU_{macro_name}_OFFLINE_BACKOFF_MS "
            f"{int(policy['offline_backoff_ms'])}U",
        ]
    project_header += [""]
    for definition in parameter_defs:
        if str(definition.get("c_type", "float")) != "float":
            continue
        macro_name = c_ident(str(definition["name"])).upper()
        if definition.get("default") is not None:
            project_header.append(
                f"#define KZ3_PLC_V2_PARAMETER_DEFAULT_{macro_name} "
                f"{c_float_literal(float(definition['default']))}")
        if definition.get("min") is not None and definition.get("max") is not None:
            project_header.append(
                f"#define KZ3_PLC_V2_PARAMETER_MIN_{macro_name} "
                f"{c_float_literal(float(definition['min']))}")
            project_header.append(
                f"#define KZ3_PLC_V2_PARAMETER_MAX_{macro_name} "
                f"{c_float_literal(float(definition['max']))}")
    project_header += [
        f"#define KZ3_PLC_V2_RTU_SNAPSHOT_COUNT "
        f"{sum(1 for field in north_fields if str(field.get('bind', '')).startswith('rtu.'))}U", "",
        f"#define KZ3_PLC_V2_RTU_OUTPUT_COUNT "
        f"{sum(len((device.get('use') or {}).get('outputs') or {}) for device in devices)}U", "",
        f"#define KZ3_PLC_V2_RTU_INPUT_COUNT "
        f"{sum(len((device.get('use') or {}).get('inputs') or {}) for device in devices)}U", "",
        "typedef struct { const char *name; const char *profile; const char *port;",
        "    uint8_t slave_address; uint16_t poll_period_ms; uint32_t stale_after_ms; } PlcV2GeneratedRtuDevice;", "",
        "typedef struct { uint8_t device_index; uint8_t function; uint16_t pdu_address;",
        "    uint16_t count; uint16_t period_ms; } PlcV2GeneratedRtuPoll;", "",
        "typedef struct { const char *name; const char *bind; uint8_t area;",
        "    uint8_t function_read; uint8_t function_write; uint16_t pdu_address;",
        "    uint8_t width; uint8_t type; bool writable; bool has_range;",
        "    float minimum; float maximum; } PlcV2GeneratedNorthField;", "",
        "typedef struct { const char *device_name; const char *signal_name;",
        "    const char *bind; uint8_t device_index; uint8_t port_id;",
        "    uint8_t function; uint16_t pdu_address; uint16_t channel_index;",
        "    uint16_t quantity; uint8_t type; uint16_t raw_min; uint16_t raw_max;",
        "    const char *source_bind; uint16_t safe_value; } PlcV2GeneratedRtuOutput;", "",
        "typedef struct { const char *device_name; const char *signal_name;",
        "    const char *bind; uint8_t device_index; uint8_t function;",
        "    uint16_t pdu_address; uint16_t quantity; uint16_t channel_index;",
        "    uint8_t type; } PlcV2GeneratedRtuInput;", "",
        "extern const PlcV2GeneratedRtuDevice g_plc_v2_rtu_devices[];",
        "extern const PlcV2GeneratedRtuPoll g_plc_v2_rtu_polls[];",
        "extern const char *const g_plc_v2_rtu_snapshot_binds[];",
        "extern const PlcV2GeneratedNorthField g_plc_v2_north_fields[];", "",
        "extern const PlcV2GeneratedRtuOutput g_plc_v2_rtu_outputs[];", "",
        "extern const PlcV2GeneratedRtuInput g_plc_v2_rtu_inputs[];", "",
    ]
    project_lines = [
        "/* 自动生成：V2 项目实例和北向统一表；禁止手工修改。 */",
        '#include "plc_v2_project_generated.h"', "",
        "const PlcV2GeneratedRtuDevice g_plc_v2_rtu_devices[] = {",
    ]
    for device in devices:
        project_lines.append(
            f'    {{"{device["name"]}", "{device["profile"]}", "{device["port"]}", '
            f'{device["slave_address"]}U, {device["poll_period_ms"]}U, '
            f'{device["stale_after_ms"]}UL}},')
    project_lines += ["};", "", "const PlcV2GeneratedRtuPoll g_plc_v2_rtu_polls[] = {"]
    poll_count = 0
    for device_index, device in enumerate(devices):
        profile = profiles[device["profile"]]
        for block in profile.get("read_blocks", []):
            function = function_codes.get(block.get("function"))
            if function is None:
                raise ValueError(f"Profile {device['profile']}: 不支持的读取功能码: {block.get('function')}")
            project_lines.append(
                f"    {{{device_index}U, {function}U, {int(block.get('pdu_address', 0))}U, "
                f"{int(block.get('count', 0))}U, {int(device['poll_period_ms'])}U}},")
            poll_count += 1
    project_header += [f"#define KZ3_PLC_V2_RTU_POLL_COUNT {poll_count}U", "", "#endif", ""]
    project_lines += ["};", "", "const char *const g_plc_v2_rtu_snapshot_binds[] = {"]
    for field in north_fields:
        bind = str(field.get("bind", ""))
        if bind.startswith("rtu."):
            project_lines.append(f'    "{bind}",')
    project_lines += ["};", "", "const PlcV2GeneratedNorthField g_plc_v2_north_fields[] = {"]
    parameter_by_name = {
        str(item.get("name")): item
        for item in (body.get("application_variables") or {}).get("parameters", [])
    }
    for field in north_fields:
        reference = str(field["reference"])
        parsed = validate_reference(reference, f"northbound field {field['name']}")
        base = {"0": 1, "1": 10001, "3": 30001, "4": 40001}[reference[0]]
        function_read = {"0": 1, "1": 2, "3": 4, "4": 3}[reference[0]]
        function_write = {"0": 5, "1": 0, "3": 0, "4": 6}[reference[0]]
        parameter = parameter_by_name.get(str(field["bind"]).split(".")[-1])
        has_range = (str(field["bind"]).startswith("parameter.") and
                     parameter is not None and parameter.get("min") is not None and
                     parameter.get("max") is not None)
        minimum = float(parameter.get("min", 0.0)) if has_range else 0.0
        maximum = float(parameter.get("max", 0.0)) if has_range else 0.0
        project_lines.append(
            f'    {{"{field["name"]}", "{field["bind"]}", {int(reference[0])}U, '
            f'{function_read}U, {function_write}U, {parsed - base}U, '
            f'{field_width(field)}U, {north_value_type(field)}U, '
            f'{str(field["access"] == "read_write").lower()}, '
            f'{str(has_range).lower()}, {c_float_literal(minimum)}, '
            f'{c_float_literal(maximum)}}},')
    project_lines += ["};", ""]
    project_lines += ["const PlcV2GeneratedRtuOutput g_plc_v2_rtu_outputs[] = {"]
    for device_index, device in enumerate(devices):
        profile = profiles[device["profile"]]
        port_id = {"rs485_1": 0, "rs485_2": 1}[device["port"]]
        for signal_name, output_def in (device.get("use") or {}).get("outputs", {}).items():
            target = profile_output_target(profile, signal_name)
            public_name = str(signal_name)
            source_bind = f"rtu.{device['name']}.{public_name}"
            safe_value = output_def.get("safe_value", target["default_safe_value"])
            bind = f"rtu.{device['name']}.{public_name}"
            project_lines.append(
                f'    {{"{device["name"]}", "{signal_name}", "{bind}", '
                f'{device_index}U, {port_id}U, {target["function"]}U, '
                f'{target["pdu_address"]}U, {target["channel_index"]}U, '
                f'{target["quantity"]}U, '
                f'{0 if target["type"] == "bool" else 2}U, '
                f'{target["raw_min"]}U, {target["raw_max"]}U, '
                f'"{source_bind}", {int(safe_value)}U}},')
    project_lines += ["};", ""]
    project_lines += ["const PlcV2GeneratedRtuInput g_plc_v2_rtu_inputs[] = {"]
    for device_index, device in enumerate(devices):
        profile = profiles[device["profile"]]
        for signal_name in device_input_names(device):
            source = profile_input_source(profile, signal_name)
            block = profile_read_block(profile, source["block"])
            function = function_codes.get(block.get("function"))
            if function is None:
                raise ValueError(
                    f"Profile {device['profile']}: 输入读取块使用不支持的功能码 {block.get('function')}")
            bind = f"rtu.{device['name']}.{signal_name}"
            project_lines.append(
                f'    {{"{device["name"]}", "{signal_name}", "{bind}", '
                f'{device_index}U, {function}U, {int(block.get("pdu_address", 0))}U, '
                f'{int(block.get("count", 0))}U, {source["channel_index"]}U, '
                f'{profile_input_type(profile, signal_name)}U}},')
    project_lines += ["};", ""]
    (output_dir / "plc_v2_project_generated.h").write_text(
        "\n".join(project_header), encoding="utf-8")
    (output_dir / "plc_v2_project_generated.c").write_text(
        "\n".join(project_lines), encoding="utf-8")

    generate_sle_manifest(output_dir, body)

    feature_lines = [
        "/* 自动生成：未声明能力必须为 0；禁止手工修改。 */",
        "#ifndef KZ3_PLC_V2_FEATURES_GENERATED_H",
        "#define KZ3_PLC_V2_FEATURES_GENERATED_H", "",
    ]
    for feature in ("pid", "counter", "retained"):
        feature_lines.append(
            f"#define KZ3_PLC_V2_ENABLE_{feature.upper()} "
            f"{1 if features.get(feature, False) else 0}U")
    feature_lines += ["", "#endif", ""]
    (output_dir / "plc_v2_features_generated.h").write_text(
        "\n".join(feature_lines), encoding="utf-8")

    parameter_payload_bytes = sum(
        storage_type_width(str(item.get("c_type", "float")))
        for item in parameter_defs)
    storage_header = [
        "/* 自动生成：plc_project_gen.py；禁止手工修改。 */",
        "#ifndef KZ3_PLC_V2_STORAGE_LAYOUT_GENERATED_H",
        "#define KZ3_PLC_V2_STORAGE_LAYOUT_GENERATED_H", "",
        "#include <stdbool.h>", "#include <stdint.h>",
        '#include "plc_storage_v2.h"', "",
        f"#define KZ3_PLC_V2_PARAMETER_PAYLOAD_BYTES {parameter_payload_bytes}U",
        f"#define KZ3_PLC_V2_PARAMETER_SLOT_BYTES {parameter_payload_bytes + 8}U",
        "",
        "_Static_assert(KZ3_PLC_V2_PARAMETER_SLOT_BYTES ==",
        "                   KZ3_PLC_V2_PARAMETER_PAYLOAD_BYTES + 8U,",
        '               "V2 parameter slot header/payload geometry drift");',
        "",
        "/* page_size/total_size 必须来自新硬件 EEPROM/BOM/Bootloader 证据。 */",
        "bool PlcV2GeneratedStorage_BuildLayout(uint16_t page_size,",
        "                                          uint16_t total_size,",
        "                                          PlcV2StorageLayout *layout);",
        "",
        "#endif", "",
    ]
    storage_source = [
        "/* 自动生成：plc_project_gen.py；禁止手工修改。 */",
        '#include "plc_v2_storage_layout_generated.h"', "",
        "bool PlcV2GeneratedStorage_BuildLayout(uint16_t page_size,",
        "                                          uint16_t total_size,",
        "                                          PlcV2StorageLayout *layout)",
        "{",
        "    if (page_size < KZ3_PLC_V2_PARAMETER_SLOT_BYTES)",
        "    {",
        "        return false;",
        "    }",
        "    const PlcV2StorageLayoutConfig config = {",
        "        page_size, total_size, 16U, 0U,",
        "        KZ3_PLC_V2_PARAMETER_SLOT_BYTES, 0U, 0U, 0U};",
        "    return PlcV2Storage_BuildLayout(&config, layout);",
        "}", "",
    ]
    (output_dir / "plc_v2_storage_layout_generated.h").write_text(
        "\n".join(storage_header), encoding="utf-8")
    (output_dir / "plc_v2_storage_layout_generated.c").write_text(
        "\n".join(storage_source), encoding="utf-8")

    summary = [
        "# V2 生成摘要", "", f"- board: `{body['board']}`",
        f"- 板载 DI: {len(inputs)}", f"- 板载 DO: {len(outputs)}",
        f"- 板载 AI/AO（当前仅定义，未接入 V2 过程映像）: "
        f"{len(analog_inputs)}/{len(analog_outputs)}",
        f"- 板型 IO HIL: {qualification.get('board_io_hil', 'unknown')}",
        f"- 参数/命令/状态: {len(parameters)}/{len(commands)}/{len(states)}", "",
        f"- RTU 实例: {len(body.get('devices') or [])}（Profile 去重后由生成器共享）",
        f"- RTU 输出声明: {sum(len((device.get('use') or {}).get('outputs') or {}) for device in (body.get('devices') or []))}（业务别名在生成期映射物理输出；正式写入仍需运行时目标与 HIL）",
        f"- 北向字段: {len((body.get('northbound') or {}).get('fields') or [])}",
        f"- PID/Counter/Retained: {int(features.get('pid', False))}/"
        f"{int(features.get('counter', False))}/{int(features.get('retained', False))}",
        "北向字段统一由 project_io.yaml 声明；HTTP、星闪和 Modbus TCP 不复制字段表。", "",
    ]
    (output_dir / "plc_v2_generated.md").write_text("\n".join(summary), encoding="utf-8")


def check_generated(project_path: Path, output_dir: Path) -> None:
    validate(project_path)
    if not output_dir.is_dir():
        raise ValueError(f"生成目录不存在: {output_dir}")
    with tempfile.TemporaryDirectory(prefix="plc-project-gen-") as temporary:
        expected_dir = Path(temporary)
        generate(project_path, expected_dir)
        expected = sorted(path.name for path in expected_dir.iterdir())
        actual = sorted(path.name for path in output_dir.iterdir()
                        if path.name != ".gitkeep")
        if expected != actual:
            raise ValueError(f"生成文件集合漂移: expected={expected}, actual={actual}")
        for name in expected:
            if (expected_dir / name).read_bytes() != (output_dir / name).read_bytes():
                raise ValueError(f"生成文件过期或被手工修改: {output_dir / name}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--check", action="store_true",
                        help="只校验配置，不写入生成物")
    args = parser.parse_args()
    try:
        if args.check:
            check_generated(args.project, args.output_dir or
                            (args.project.parent / "generated_v2"))
        else:
            if args.output_dir is None:
                parser.error("生成模式必须提供 --output-dir")
            generate(args.project, args.output_dir)
    except (OSError, KeyError, TypeError, ValueError, yaml.YAMLError) as error:
        print(f"plc_v2_gen: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
