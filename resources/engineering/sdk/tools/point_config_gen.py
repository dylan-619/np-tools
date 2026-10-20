#!/usr/bin/env python3
"""生成 M1 唯一点位配置 C/H/Markdown。

本工具复用 ``plc_gen.py`` 已覆盖的 YAML/Profile 校验，但不再输出多组
generated/service/manifest 文件。固件不解析 YAML；生成结果是项目实际点位、
RTU 轮询及北向映射的静态编译输入。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile

import yaml

from plc_gen import (  # 复用已验证的 schema/Profile/地址校验，避免重复造轮子。
    SYSTEM_COMMAND_DEFS,
    c_ident,
    c_type,
    device_input_names,
    field_c_type,
    field_width,
    load_profiles,
    profile_input_source,
    profile_input_type,
    profile_output_target,
    profile_read_block,
    project_points,
    runtime_counters,
    validate,
    validate_reference,
)


FUNCTION_CODES = {
    "read_coils": 1,
    "read_discrete_inputs": 2,
    "read_holding_registers": 3,
    "read_input_registers": 4,
}

BYTE_WORD_ORDERS = {
    "ab": 1,
    "ba": 2,
    "abcd": 3,
    "badc": 4,
    "cdab": 5,
    "dcba": 6,
}

# 这是轻量控制器的发布上限，不是 PLC 全功能上限。容量在生成期失败，避免运行时
# 因映射、功能块或 RTU 排队过量而出现难以定位的确定性问题。
PROJECT_ID_PATTERN = re.compile(r"[A-Za-z0-9_.-]{1,48}")
MAX_BINDINGS = 384
MAX_LOGIC_CONTEXT_BYTES = 4096
MAX_NORTH_FIELDS = 256
MAX_RTU_DEVICES = 16
MAX_RTU_REQUESTS_PER_PORT = 32
MAX_RTU_NORMAL_UTILIZATION_PERMILLE = 500
MAX_RTU_WORST_UTILIZATION_PERMILLE = 800
BOARD_AI_SAMPLE_PERIOD_MS = 200
BOARD_AI_STALE_AFTER_DEFAULT_MS = 500
BOARD_AI_STALE_AFTER_MIN_MS = 250
BOARD_AI_STALE_AFTER_MAX_MS = 60000
MAX_TIMERS = 32
MAX_EDGES = 16
MAX_COUNTERS = 16
MAX_LATCHES = 32
MAX_DEBOUNCES = 16
MAX_FILTERS = 16
MAX_RATE_LIMITS = 16
MAX_PIDS = 4
MAX_RUNTIMES = 16
MAX_PERSISTENT_PARAMETERS = 30
MAX_PERSISTENT_PAYLOAD_BYTES = 120

PERSISTENT_TYPE_INFO = {
    "bool": {"native": "bool", "width": 1, "tag": 1,
             "enum": "POINT_CONFIG_VALUE_BOOL", "minimum": 0, "maximum": 1},
    "u16": {"native": "uint16_t", "width": 2, "tag": 2,
            "enum": "POINT_CONFIG_VALUE_U16", "minimum": 0, "maximum": 0xFFFF},
    "s16": {"native": "int16_t", "width": 2, "tag": 3,
            "enum": "POINT_CONFIG_VALUE_S16", "minimum": -0x8000, "maximum": 0x7FFF},
    "u32": {"native": "uint32_t", "width": 4, "tag": 4,
            "enum": "POINT_CONFIG_VALUE_U32", "minimum": 0, "maximum": 0xFFFFFFFF},
    "s32": {"native": "int32_t", "width": 4, "tag": 5,
            "enum": "POINT_CONFIG_VALUE_S32", "minimum": -0x80000000,
            "maximum": 0x7FFFFFFF},
    "float": {"native": "float", "width": 4, "tag": 6,
              "enum": "POINT_CONFIG_VALUE_F32", "minimum": None,
              "maximum": None},
}

# 这些编号仅兼容早期固件内部路由。SLE 线协议使用字段名，不发送
# north_key_id；未列出的项目字段可随当前生成表重新编号。
LEGACY_SLE_KEY_IDS = {
    "board.di01": 1,
    "command.pump_start": 2,
    "command.pump_stop": 3,
    "fan.device_fault": 4,
    "fan.run_feedback": 5,
    "parameter.level_high": 6,
    "pump.device_fault": 7,
    "pump.run_feedback": 8,
    "state.pump_fault": 9,
    "state.pump_running": 10,
    "tank.level": 11,
}


def _macro(name: str) -> str:
    return c_ident(name).upper()


def _bool(value: object) -> str:
    return "true" if bool(value) else "false"


def _float(value: object) -> str:
    result = f"{float(value):.7g}"
    if "." not in result and "e" not in result and "E" not in result:
        result += ".0"
    return result + "f"


def _double(value: object) -> str:
    result = f"{float(value):.17g}"
    if "." not in result and "e" not in result and "E" not in result:
        result += ".0"
    return result


def _sample_type(type_name: str) -> str:
    native_type = c_type(type_name)

    if native_type == "float":
        return "PointConfigFloatSample"
    if native_type == "uint16_t":
        return "PointConfigU16Sample"
    return "PointConfigBoolSample"


def _external_sample_type(type_name: str) -> str:
    native_type = c_type(type_name)

    if native_type == "float":
        return "PointConfigExternalFloatSample"
    if native_type == "int32_t":
        return "PointConfigExternalS32Sample"
    if native_type == "bool":
        return "PointConfigExternalBoolSample"
    raise ValueError(f"external input 类型不支持: {type_name}")


def _external_inputs(project: dict) -> list[dict]:
    return list((project.get("application_variables") or {}).get(
        "external_inputs") or [])


def _native_profile_type(profile: dict, signal_name: str) -> str:
    value_type = profile_input_type(profile, signal_name)
    if value_type == 1:
        return "float"
    if value_type == 2:
        return "uint16_t"
    return "bool"


def _profile_input_u16_engineering(profile: dict,
                                   signal_name: str) -> tuple[int, int, int, int]:
    """读取 U16 输入的整型工程量端点；未声明时保持原始 U16 恒等映射。"""
    for signal in profile.get("signals", []):
        if signal.get("name") != signal_name:
            continue
        engineering = signal.get("engineering")

        if engineering is None:
            return 0, 65535, 0, 65535
        if profile_input_type(profile, signal_name) != 2 or not isinstance(engineering, dict):
            raise ValueError(
                f"Profile {profile.get('name')}: 输入 {signal_name} engineering 只支持 U16 字典定义")
        required = {"unit", "raw_min", "raw_max", "value_min", "value_max"}
        if set(engineering) != required or not isinstance(engineering["unit"], str) or \
                not engineering["unit"].strip():
            raise ValueError(
                f"Profile {profile.get('name')}: 输入 {signal_name} engineering 必须包含 unit/raw_min/raw_max/value_min/value_max")
        raw_min = engineering["raw_min"]
        raw_max = engineering["raw_max"]
        value_min = engineering["value_min"]
        value_max = engineering["value_max"]
        if (not all(isinstance(value, int) for value in
                    (raw_min, raw_max, value_min, value_max)) or
                raw_min < 0 or raw_max > 65535 or raw_min >= raw_max or
                value_min < 0 or value_max > 65535 or value_min > value_max):
            raise ValueError(
                f"Profile {profile.get('name')}: 输入 {signal_name} engineering 端点必须是递增的 U16 整数")
        return raw_min, raw_max, value_min, value_max
    raise ValueError(
        f"Profile {profile.get('name')}: 输入 {signal_name} 未找到 engineering 定义")


def _point_config_value_type(field: dict) -> int:
    """将 YAML C 类型映射到当前 PointConfigValueType，不能复用旧 V2 的三值枚举。"""
    value_type = c_type(field_c_type(field))

    return {
        "bool": 0,
        "float": 1,
        "uint16_t": 2,
        "uint32_t": 3,
        "int32_t": 4,
        "int16_t": 5,
    }[value_type]


def _project_point_map(project: dict) -> dict[str, dict]:
    return {str(item["name"]): item for item in project_points(project)}


def _resolve_project_bind(project: dict, bind: str) -> str:
    """将配置中的 point.<业务名> 在生成期解析为唯一物理 binding。"""
    if not bind.startswith("point."):
        return bind
    name = bind.split(".", 1)[1] if bind.count(".") == 1 else ""
    point = _project_point_map(project).get(name)
    if point is None:
        raise ValueError(f"项目点不存在: {bind}")
    return str(point["source"])


def _profile_output_feedback_name(profile: dict,
                                  signal_name: str) -> str | None:
    """返回输出通道对应的设备读回信号名。"""
    for channel in profile.get("channels", []):
        if channel.get("kind") not in {"digital_output", "analog_output"}:
            continue
        names = channel.get("names") or []
        if signal_name not in names:
            continue
        feedback_names = (channel.get("feedback") or {}).get("names") or []
        index = names.index(signal_name)
        if index >= len(feedback_names):
            return None
        return str(feedback_names[index])
    return None


def _profile_output_feedback_is_unified(profile: dict,
                                        signal_name: str) -> bool:
    """判断输出读回与写目标是否可安全视为同一个业务寄存器。"""
    feedback_name = _profile_output_feedback_name(profile, signal_name)
    if feedback_name is None:
        return False
    target = profile_output_target(profile, signal_name)
    source = profile_input_source(profile, feedback_name)
    block = profile_read_block(profile, source["block"])
    expected_function = 1 if target["type"] == "bool" else 3
    feedback_type = _native_profile_type(profile, feedback_name)

    if (FUNCTION_CODES[str(block["function"])] != expected_function or
            int(block.get("pdu_address", 0)) != int(target["pdu_address"]) or
            int(source["channel_index"]) != int(target["channel_index"]) or
            feedback_type != c_type(str(target["type"]))):
        return False
    if target["type"] == "bool":
        return True
    if _profile_input_order(profile, feedback_name) != BYTE_WORD_ORDERS["ab"]:
        return False
    raw_min, raw_max, value_min, value_max = _profile_input_u16_engineering(
        profile, feedback_name)
    return (raw_min == value_min and raw_max == value_max and
            raw_min <= int(target["raw_min"]) and
            raw_max >= int(target["raw_max"]))


def _profile_output_feedback_can_decode_directly(profile: dict,
                                                 signal_name: str) -> bool:
    """判断 Southbound 能否不借助通用输入描述符直接解码读回。"""
    feedback_name = _profile_output_feedback_name(profile, signal_name)
    if feedback_name is None:
        return True
    target = profile_output_target(profile, signal_name)
    feedback_type = _native_profile_type(profile, feedback_name)

    if feedback_type != c_type(str(target["type"])):
        raise ValueError(
            f"Profile {profile.get('name')}: 输出 {signal_name} 与读回 "
            f"{feedback_name} 类型不一致")
    return target["type"] == "bool" or \
        _profile_input_order(profile, feedback_name) == BYTE_WORD_ORDERS["ab"]


def _north_observes_output_readback(project: dict, device_name: str,
                                    signal_name: str) -> bool:
    """判断北向是否需要保留某输出的读回影子。"""
    source = f"rtu.{device_name}.{signal_name}"
    points = _project_point_map(project)
    for field in ((project.get("northbound") or {}).get("fields") or []):
        bind = str(field.get("bind", ""))
        if field.get("access") != "read" or not bind.startswith("point."):
            continue
        point_name = bind.split(".", 1)[1] if bind.count(".") == 1 else ""
        point = points.get(point_name)
        if (point is not None and point.get("direction") == "outputs" and
                str(point.get("source")) == source):
            return True
    return False


def _device_runtime_input_names(project: dict, device: dict,
                                profile: dict) -> list[str]:
    """返回南向运行时必须保留的输入。

    项目只需显式声明业务输入；当北向实际读取某个输出时，
    Profile 才自动把对应寄存器读回加入内部过程映像。仅用于
    南向写后确认的读回由 Southbound 直接解码，不占用通用 binding。
    """
    names = list(device_input_names(device))
    for signal_name in ((device.get("use") or {}).get("outputs") or {}):
        feedback_name = _profile_output_feedback_name(
            profile, str(signal_name))
        observes_unified_readback = (
            _profile_output_feedback_is_unified(profile, str(signal_name)) and
            _north_observes_output_readback(
                project, str(device["name"]), str(signal_name)))
        needs_generic_decoder = not _profile_output_feedback_can_decode_directly(
            profile, str(signal_name))
        if (feedback_name is not None and feedback_name not in names and
                (observes_unified_readback or needs_generic_decoder)):
            names.append(feedback_name)
    return names


def _resolve_north_field_bind(project: dict, profiles: dict[str, dict],
                              field: dict) -> str:
    """解析北向读取的实际 binding。

    只读 RTU 输出业务点在 Profile 证明读写地址与数值表示一致时返回
    设备最后一次读回值；逻辑输出仍绑定软件目标值，否则保持原目标值语义。
    """
    bind = str(field["bind"])
    if bind.startswith("runtime."):
        return bind
    resolved = _resolve_project_bind(project, bind)
    if field.get("access") != "read" or not bind.startswith("point."):
        return resolved
    point_name = bind.split(".", 1)[1] if bind.count(".") == 1 else ""
    point = _project_point_map(project).get(point_name)
    if point is None or point.get("direction") != "outputs":
        return resolved
    parts = resolved.split(".")
    if len(parts) != 3 or parts[0] != "rtu":
        return resolved
    device = next((item for item in project.get("devices") or []
                   if str(item.get("name")) == parts[1]), None)
    if device is None:
        return resolved
    profile = profiles[str(device["profile"])]
    if not _profile_output_feedback_is_unified(profile, parts[2]):
        return resolved
    feedback_name = _profile_output_feedback_name(profile, parts[2])
    if feedback_name is None:
        return resolved
    return f"rtu.{parts[1]}.{feedback_name}"


def _profile_input_order(profile: dict, signal_name: str) -> int:
    for signal in profile.get("signals", []):
        if signal.get("name") == signal_name:
            raw = str(signal.get(
                "byte_word_order",
                "ab" if profile_input_type(profile, signal_name) == 2 else "abcd"))
            if raw not in BYTE_WORD_ORDERS:
                raise ValueError(
                    f"Profile {profile.get('name')}: 输入 {signal_name} byte_word_order 不支持: {raw}")
            if profile_input_type(profile, signal_name) == 2 and raw not in {"ab", "ba"}:
                raise ValueError(
                    f"Profile {profile.get('name')}: U16 输入 {signal_name} byte_word_order 必须为 ab/ba")
            return BYTE_WORD_ORDERS[raw]
    return 0


def _profile_output_feedback(profile: dict, signal_name: str) -> tuple[int, int, int] | None:
    """返回输出对应的独立读回 FC、PDU 地址和 bit 下标。"""
    for channel in profile.get("channels", []):
        if channel.get("kind") not in {"digital_output", "analog_output"}:
            continue
        names = channel.get("names") or []
        if signal_name not in names:
            continue
        feedback_name = _profile_output_feedback_name(profile, signal_name)
        if feedback_name is None:
            return None
        source = profile_input_source(profile, feedback_name)
        block = profile_read_block(profile, source["block"])
        return (FUNCTION_CODES[str(block["function"])],
                int(block.get("pdu_address", 0)), int(source["channel_index"]))
    return None


def _known_bind_types(project: dict, board: dict,
                      profiles: dict[str, dict]) -> dict[str, str]:
    """构造配置允许引用的具名点位类型，供 PID 等跨点位功能块校验。"""
    result: dict[str, str] = {}
    board_node = board.get("board") or {}
    for key, default_type in (("digital_inputs", "bool"),
                              ("digital_outputs", "bool"),
                              ("analog_inputs", "float"),
                              ("analog_outputs", "float")):
        for item in board_node.get(key, []):
            result[f"board.{item['name']}"] = c_type(
                str(item.get("c_type", default_type)))
    for device in project.get("devices") or []:
        profile = profiles[str(device["profile"])]
        use = device.get("use") or {}
        for signal_name in device_input_names(device):
            result[f"rtu.{device['name']}.{signal_name}"] = _native_profile_type(
                profile, str(signal_name))
        for signal_name in (use.get("outputs") or {}):
            result[f"rtu.{device['name']}.{signal_name}"] = c_type(
                profile_output_target(profile, str(signal_name))["type"])
    variables = project.get("application_variables") or {}
    for item in SYSTEM_COMMAND_DEFS:
        result[f"command.{item['name']}"] = "bool"
    for group, prefix in (("parameters", "parameter"), ("commands", "command"),
                          ("states", "state")):
        for item in variables.get(group) or []:
            result[f"{prefix}.{item['name']}"] = c_type(
                str(item.get("c_type", "float" if group == "parameters" else "bool")))
    for item in _external_inputs(project):
        result[f"external.{item['name']}"] = c_type(str(item["c_type"]))
    for item in _runtime_generated_states(project)[:5]:
        result[f"state.{item['name']}"] = c_type(str(item["c_type"]))
    for runtime in _runtime_definitions(project):
        name = str(runtime["name"])
        result[f"runtime.{name}.clear"] = "bool"
        result[f"runtime.{name}.seconds"] = "uint32_t"
        result[f"runtime.{name}.clear_pending"] = "bool"
    for point in project_points(project):
        result[f"point.{point['name']}"] = result[str(point["source"])]
    return result


def _finite_float(value: object, where: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{where} 必须为有限数值")
    return float(value)


def _validate_pids(project: dict, board: dict,
                   profiles: dict[str, dict]) -> list[dict]:
    """冻结 M1 PID 的最小参数边界，禁止模糊或危险的隐式默认值。"""
    enabled = bool((project.get("features") or {}).get("pid", False))
    pids = project.get("pids") or []
    if not enabled:
        if pids:
            raise ValueError("features.pid=false 时不得声明 pids")
        return []
    if not pids:
        raise ValueError("features.pid=true 时至少声明一个 PID 实例")
    binds = _known_bind_types(project, board, profiles)
    board_ao_ranges = {
        f"board.{item['name']}":
            (float(item["software_min"]), float(item["software_max"]))
        for item in (board.get("board") or {}).get("analog_outputs") or []
    }
    rtu_ao_ranges: dict[str, tuple[int, int]] = {}
    for device in project.get("devices") or []:
        profile = profiles[str(device["profile"])]
        for signal_name in ((device.get("use") or {}).get("outputs") or {}):
            target = profile_output_target(profile, str(signal_name))
            if target["type"] == "u16":
                rtu_ao_ranges[f"rtu.{device['name']}.{signal_name}"] = (
                    int(target["raw_min"]), int(target["raw_max"]))
    names: set[str] = set()
    output_binds: set[str] = set()
    scan_period = int(project["scan_period_ms"])
    for index, item in enumerate(pids):
        where = f"pids[{index}]"
        name = item.get("name")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError(f"{where}.name 不能为空且不能重复")
        names.add(name)
        if not isinstance(item.get("enabled"), bool):
            raise ValueError(f"{where}.enabled 必须为 bool")
        for key in ("measurement", "setpoint"):
            bind = item.get(key)
            if not isinstance(bind, str) or binds.get(bind) != "float":
                raise ValueError(f"{where}.{key} 必须引用已声明的 float 点位")
        output_bind = item.get("output")
        if not isinstance(output_bind, str):
            raise ValueError(
                f"{where}.output 必须引用 board.ao* 或已声明的 RTU analog_output")
        resolved_output = _resolve_project_bind(project, output_bind)
        if resolved_output in board_ao_ranges and binds.get(output_bind) == "float":
            output_value_type = "POINT_CONFIG_VALUE_F32"
            output_raw_min = 0
            output_raw_max = 0
            physical_min, physical_max = board_ao_ranges[resolved_output]
        elif resolved_output in rtu_ao_ranges and binds.get(output_bind) == "uint16_t":
            output_value_type = "POINT_CONFIG_VALUE_U16"
            output_raw_min, output_raw_max = rtu_ao_ranges[resolved_output]
            physical_min = float(output_raw_min)
            physical_max = float(output_raw_max)
        else:
            raise ValueError(
                f"{where}.output 必须引用 board.ao* 或已声明的 RTU analog_output")
        if resolved_output in output_binds:
            raise ValueError(
                f"{where}.output 与其他 PID 重复绑定 {resolved_output}，"
                "每个执行输出只能由一个 PID owner 控制")
        output_binds.add(resolved_output)
        period = item.get("sample_period_ms")
        if (not isinstance(period, int) or period < scan_period or
                period % scan_period != 0):
            raise ValueError(f"{where}.sample_period_ms 必须是 scan_period_ms 的正整数倍")
        direction = item.get("direction")
        if direction not in ("direct", "reverse"):
            raise ValueError(f"{where}.direction 必须为 direct/reverse")
        derivative_filter_ms = item.get("derivative_filter_ms")
        if (not isinstance(derivative_filter_ms, int) or
                derivative_filter_ms < 0 or derivative_filter_ms > 60000):
            raise ValueError(
                f"{where}.derivative_filter_ms 必须是 0..60000 ms 的整数")
        for key in ("kp", "ki", "kd", "output_min", "output_max"):
            _finite_float(item.get(key), f"{where}.{key}")
        for key in ("kp", "ki", "kd"):
            if float(item[key]) < 0.0:
                raise ValueError(f"{where}.{key} 不得为负，控制方向必须使用 direction")
        if float(item["kd"]) > 0.0 and derivative_filter_ms == 0:
            raise ValueError(
                f"{where}.kd>0 时 derivative_filter_ms 必须大于 0")
        if float(item["output_min"]) >= float(item["output_max"]):
            raise ValueError(f"{where}.output_min 必须小于 output_max")
        if (float(item["output_min"]) < physical_min or
                float(item["output_max"]) > physical_max):
            raise ValueError(
                f"{where}.output_min/max 必须落在输出 {resolved_output} 的 "
                f"{physical_min:g}..{physical_max:g} 范围内")
        if (output_value_type == "POINT_CONFIG_VALUE_U16" and
                (not float(item["output_min"]).is_integer() or
                 not float(item["output_max"]).is_integer())):
            raise ValueError(
                f"{where}.output_min/max 绑定 U16 analog_output 时必须为整数原始码")
        item["_resolved_output"] = resolved_output
        item["_output_value_type"] = output_value_type
        item["_output_raw_min"] = output_raw_min
        item["_output_raw_max"] = output_raw_max
    return pids


def _config_hash(path: Path) -> int:
    """FNV-1a 配置指纹；用于识别 YAML 与固件生成物不一致。"""
    value = 2166136261
    for byte in path.read_bytes():
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def _manifest_type(field: dict) -> str:
    """把北向字段类型归一为工具和固件共同使用的稳定名称。"""
    type_name = field_c_type(field)
    return {
        "float": "f32",
        "f32": "f32",
        "uint8_t": "u8",
        "uint16_t": "u16",
        "uint32_t": "u32",
        "int32_t": "i32",
    }.get(type_name, type_name)


def _point_manifest(project: dict) -> tuple[str, str]:
    """生成按声明顺序冻结的北向点表 SHA-256。"""
    fields = []
    for field in (project.get("northbound") or {}).get("fields") or []:
        fields.append([
            str(field["name"]),
            str(field["bind"]),
            _manifest_type(field),
            str(field["access"]),
            str(field["reference"]),
            field_width(field),
        ])
    canonical = json.dumps(
        ["kz3-point-manifest/v1", fields],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return (
        "sha256-kz3-north-fields-canonical-v1",
        hashlib.sha256(canonical).hexdigest(),
    )


def _runtime_key_hash(project: dict, name: str) -> int:
    """生成 runtime 的稳定工程校验值，防止列表重排后误恢复到其他设备。"""
    value = 2166136261
    for byte in f"{project['id']}runtime{name}".encode("utf-8"):
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def _fnv1a(data: bytes) -> int:
    value = 2166136261

    for byte in data:
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def _persistent_parameters(project: dict) -> tuple[list[dict], int, int]:
    """校验并返回按 YAML 声明顺序紧凑排列的持久化参数。"""
    variables = project.get("application_variables") or {}
    parameters = variables.get("parameters") or []
    allowed_objects = {id(item) for item in parameters if isinstance(item, dict)}

    def reject_misplaced(value: object, path: str) -> None:
        if isinstance(value, dict):
            if "persistent" in value and id(value) not in allowed_objects:
                raise ValueError(f"{path}.persistent 只允许用于 application_variables.parameters")
            for key, child in value.items():
                reject_misplaced(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                reject_misplaced(child, f"{path}[{index}]")

    reject_misplaced(project, "project")
    result: list[dict] = []
    payload_offset = 0
    for index, item in enumerate(parameters):
        where = f"application_variables.parameters[{index}]"
        if not isinstance(item, dict):
            raise ValueError(f"{where} 必须为对象")
        persistent = item.get("persistent", False)
        if not isinstance(persistent, bool):
            raise ValueError(f"{where}.persistent 必须为 bool")
        if not persistent:
            continue
        type_name = str(item.get("c_type", "float"))
        type_info = PERSISTENT_TYPE_INFO.get(type_name)
        if type_info is None:
            raise ValueError(
                f"{where}.c_type={type_name!r} 不支持持久化；允许 bool/u16/s16/u32/s32/float")
        name = item.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"{where}.name 必须为非空字符串")
        default = item.get("default")
        if type_name == "bool":
            if not isinstance(default, bool):
                raise ValueError(f"{where}.default 必须为 bool")
            if "min" in item or "max" in item:
                raise ValueError(f"{where} 的 bool 参数不得声明 min/max")
        elif type_name == "float":
            if (not isinstance(default, (int, float)) or isinstance(default, bool) or
                    not math.isfinite(float(default))):
                raise ValueError(f"{where}.default 必须为有限 float")
        else:
            if not isinstance(default, int) or isinstance(default, bool):
                raise ValueError(f"{where}.default 必须为整数")
            if default < type_info["minimum"] or default > type_info["maximum"]:
                raise ValueError(f"{where}.default 超出 {type_name} 物理范围")
        has_min = "min" in item
        has_max = "max" in item
        if has_min != has_max:
            raise ValueError(f"{where}.min/max 必须同时声明或同时省略")
        if has_min:
            minimum = item["min"]
            maximum = item["max"]
            if type_name == "float":
                if (not isinstance(minimum, (int, float)) or isinstance(minimum, bool) or
                        not isinstance(maximum, (int, float)) or isinstance(maximum, bool) or
                        not math.isfinite(float(minimum)) or
                        not math.isfinite(float(maximum))):
                    raise ValueError(f"{where}.min/max 必须为有限数值")
            elif (not isinstance(minimum, int) or isinstance(minimum, bool) or
                  not isinstance(maximum, int) or isinstance(maximum, bool)):
                raise ValueError(f"{where}.min/max 必须为整数")
            if (minimum > maximum or default < minimum or default > maximum or
                    (type_name != "float" and
                     (minimum < type_info["minimum"] or maximum > type_info["maximum"]))):
                raise ValueError(f"{where}.default/min/max 范围无效")
        width = int(type_info["width"])
        result.append({
            "item": item,
            "index": len(result),
            "payload_offset": payload_offset,
            "width": width,
            "type_name": type_name,
            "type_info": type_info,
        })
        payload_offset += width
    if len(result) > MAX_PERSISTENT_PARAMETERS:
        raise ValueError(
            f"persistent 参数数量 {len(result)} 超过上限 {MAX_PERSISTENT_PARAMETERS}")
    if payload_offset > MAX_PERSISTENT_PAYLOAD_BYTES:
        last_name = result[-1]["item"]["name"] if result else "-"
        raise ValueError(
            f"persistent 参数 {last_name} 后净荷 {payload_offset} B 超过上限 "
            f"{MAX_PERSISTENT_PAYLOAD_BYTES} B")

    canonical = bytearray(b"KZ3-LPS-LAYOUT-V1\0")
    project_id = str(project["id"]).encode("utf-8")
    canonical.extend(len(project_id).to_bytes(2, "little"))
    canonical.extend(project_id)
    canonical.append(len(result))
    for entry in result:
        name_bytes = str(entry["item"]["name"]).encode("utf-8")
        canonical.append(entry["index"])
        canonical.extend(len(name_bytes).to_bytes(2, "little"))
        canonical.extend(name_bytes)
        canonical.append(entry["type_info"]["tag"])
        canonical.append(entry["width"])
    return result, payload_offset, _fnv1a(bytes(canonical))


def _runtime_definitions(project: dict) -> list[dict]:
    runtimes = runtime_counters(project)
    if len(runtimes) > MAX_RUNTIMES:
        raise ValueError(
            f"runtime_counters 数量 {len(runtimes)} 超过轻量运行时上限 {MAX_RUNTIMES}")
    hashes: dict[int, str] = {}
    for item in runtimes:
        name = str(item["name"])
        key_hash = _runtime_key_hash(project, name)
        previous = hashes.get(key_hash)
        if previous is not None:
            raise ValueError(
                f"runtime key hash 碰撞: {previous} 与 {name} -> 0x{key_hash:08X}")
        hashes[key_hash] = name
    return runtimes


def _logic_block_names(project: dict) -> dict[str, list[str]]:
    blocks = project.get("logic_blocks") or {}
    result: dict[str, list[str]] = {}
    groups = ("timers", "edges", "counters", "latches", "debounces",
              "filters", "rate_limits")

    if not isinstance(blocks, dict):
        raise ValueError("logic_blocks 必须为对象")
    unknown = set(blocks) - set(groups)
    if unknown:
        raise ValueError("logic_blocks 存在不支持分组: " + ", ".join(sorted(unknown)))
    for group in groups:
        names = blocks.get(group) or []
        if not isinstance(names, list) or not all(
                isinstance(name, str) and name for name in names):
            raise ValueError(f"logic_blocks.{group} 必须为非空字符串列表")
        identifiers = [c_ident(name) for name in names]
        if len(set(names)) != len(names) or len(set(identifiers)) != len(identifiers):
            raise ValueError(f"logic_blocks.{group} 名称或 C 标识符重复")
        result[group] = names
    if result["counters"] and not bool(
        (project.get("features") or {}).get("counter", False)):
        raise ValueError("features.counter=false 时不得声明 logic_blocks.counters")
    return result


def _runtime_generated_commands(project: dict) -> list[dict[str, str]]:
    """返回每个运行时间对象的 one-shot 清零命令。"""
    return [
        {"name": f"{name}_runtime_clear", "c_type": "bool"}
        for name in (str(item["name"]) for item in _runtime_definitions(project))
    ]


def _runtime_generated_states(project: dict) -> list[dict[str, str]]:
    """返回框架拥有的生命周期、存储诊断和 runtime 状态字段。"""
    runtimes = [str(item["name"]) for item in _runtime_definitions(project)]
    if not runtimes:
        return []
    result = [
        {"name": "system_boot_count", "c_type": "uint32_t"},
        {"name": "system_total_runtime_seconds", "c_type": "uint32_t"},
        {"name": "retained_store_fault", "c_type": "bool"},
        {"name": "retained_store_fault_mask", "c_type": "uint32_t"},
        {"name": "retained_store_busy", "c_type": "bool"},
    ]
    for name in runtimes:
        result.extend((
            {"name": f"{name}_runtime_seconds", "c_type": "uint32_t"},
            {"name": f"{name}_runtime_clear_pending", "c_type": "bool"},
        ))
    return result


def _validate_project_identity(project: dict, board: dict,
                               profiles: dict[str, dict]) -> None:
    """冻结项目身份和板型/Profile 依赖，禁止发布不可追溯的 YAML。"""
    for key in ("id", "version"):
        value = project.get(key)
        if (not isinstance(value, str) or
                PROJECT_ID_PATTERN.fullmatch(value) is None):
            raise ValueError(
                f"project.{key} 必须为 1..48 字节 ASCII，且只能包含字母、数字、_、-、.")
    board_name = str((board.get("board") or {}).get("name", ""))
    if project.get("board") != board_name:
        raise ValueError(
            f"project.board={project.get('board')!r} 与板型定义 name={board_name!r} 不一致")
    required_profiles = project.get("required_profiles")
    if (not isinstance(required_profiles, list) or
            not all(isinstance(name, str) and name for name in required_profiles) or
            len(required_profiles) != len(set(required_profiles))):
        raise ValueError("project.required_profiles 必须为不重复的 Profile 名称列表")
    used_profiles = {str(item["profile"]) for item in project.get("devices") or []}
    if set(required_profiles) != used_profiles:
        raise ValueError(
            "project.required_profiles 必须与 devices 实际引用的 Profile 集合完全一致")
    unknown = set(required_profiles) - set(profiles)
    if unknown:
        raise ValueError("project.required_profiles 包含不存在的 Profile: " +
                         ", ".join(sorted(unknown)))


def _startup_policies(project: dict) -> dict[str, object]:
    """读取项目级启动策略；放宽硬件探测的选项默认严格关闭。"""
    startup = project.get("startup") or {}

    if not isinstance(startup, dict):
        raise ValueError("project.startup 必须为 mapping")
    supported = {"ao_deferred_activation", "parameter_restore"}
    unknown = set(startup) - supported
    if unknown:
        raise ValueError("project.startup 存在不支持字段: " +
                         ", ".join(sorted(unknown)))
    ao_deferred = startup.get("ao_deferred_activation", False)
    if not isinstance(ao_deferred, bool):
        raise ValueError("project.startup.ao_deferred_activation 必须为 bool")
    parameter_restore = startup.get("parameter_restore", "defaults")
    if parameter_restore not in {"defaults", "require_valid"}:
        raise ValueError(
            "project.startup.parameter_restore 必须为 defaults 或 require_valid")
    persistent_parameters, _, _ = _persistent_parameters(project)
    if parameter_restore == "require_valid" and not persistent_parameters:
        raise ValueError(
            "project.startup.parameter_restore=require_valid 时必须声明 retained 参数")
    return {
        "ao_deferred_activation": ao_deferred,
        "parameter_restore": parameter_restore,
    }


def _input_quality_policies(project: dict) -> dict[str, int]:
    """读取板载输入质量策略；采样周期仍由固定板级 owner 管理。"""
    policies = project.get("input_quality") or {}

    if not isinstance(policies, dict):
        raise ValueError("project.input_quality 必须为 mapping")
    unknown = set(policies) - {"board_ai_stale_after_ms"}
    if unknown:
        raise ValueError("project.input_quality 存在不支持字段: " +
                         ", ".join(sorted(unknown)))
    stale_after_ms = policies.get(
        "board_ai_stale_after_ms", BOARD_AI_STALE_AFTER_DEFAULT_MS)
    minimum = max(BOARD_AI_STALE_AFTER_MIN_MS,
                  BOARD_AI_SAMPLE_PERIOD_MS + int(project["scan_period_ms"]))
    if (type(stale_after_ms) is not int or stale_after_ms < minimum or
            stale_after_ms > BOARD_AI_STALE_AFTER_MAX_MS):
        raise ValueError(
            "project.input_quality.board_ai_stale_after_ms 必须为 "
            f"{minimum}..{BOARD_AI_STALE_AFTER_MAX_MS} 的整数")
    return {"board_ai_stale_after_ms": stale_after_ms}


def _command_policies(project: dict) -> list[dict[str, str]]:
    """冻结系统、项目和 runtime one-shot 命令的保护语义。"""
    variables = project.get("application_variables") or {}
    commands = variables.get("commands") or []
    result = [
        {"name": "controller_start", "effect": "normal"},
        {"name": "controller_stop", "effect": "protective"},
        {"name": "controller_reset", "effect": "normal"},
    ]

    for index, command in enumerate(commands):
        where = f"application_variables.commands[{index}]"
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
        effect = command.get("effect", "normal")
        if effect not in {"normal", "protective"}:
            raise ValueError(f"{where}.effect 必须为 normal 或 protective")
        result.append({"name": str(command["name"]), "effect": effect})
    result.extend(
        {"name": item["name"], "effect": "normal"}
        for item in _runtime_generated_commands(project)
    )
    return result


def _validate_unique_bindings(project: dict, board: dict,
                              profiles: dict[str, dict]) -> None:
    """绑定名和物理输出目标必须一一对应，避免静默抢占同一输出。"""
    bindings = _binding_items(project, board, profiles)
    seen: set[str] = set()
    for bind, _, _, _ in bindings:
        if bind in seen:
            raise ValueError(f"绑定名重复，无法确定唯一所有者: {bind}")
        seen.add(bind)
    source_owner: dict[str, str] = {}
    for device in project.get("devices") or []:
        for signal_name, output_def in ((device.get("use") or {}).get("outputs") or {}).items():
            target = profile_output_target(profiles[str(device["profile"])], str(signal_name))
            physical = (f"{device['port']}/{device['slave_address']}/"
                        f"{target['function']}/{target['pdu_address']}/{target['channel_index']}")
            owner = f"{device['name']}.{signal_name}"
            previous = source_owner.get(physical)
            if previous is not None:
                raise ValueError(
                    f"物理输出 {physical} 被 {previous} 与 {owner} 重复声明")
            source_owner[physical] = owner


def _validate_runtime_north_fields(project: dict) -> None:
    """runtime 秒数与清零命令可北向使用；清零中状态可仅供内部逻辑使用。"""
    runtimes = [str(item["name"]) for item in _runtime_definitions(project)]
    fields = (project.get("northbound") or {}).get("fields") or []

    for name in runtimes:
        seconds_bind = f"runtime.{name}.seconds"
        pending_bind = f"runtime.{name}.clear_pending"
        clear_bind = f"runtime.{name}.clear"
        seconds_fields = [field for field in fields if field.get("bind") == seconds_bind]
        clear_fields = [field for field in fields if field.get("bind") == clear_bind]
        pending_fields = [field for field in fields if field.get("bind") == pending_bind]

        if len(seconds_fields) != 1 or field_c_type(seconds_fields[0]) != "u32" or \
                seconds_fields[0].get("access") != "read":
            raise ValueError(
                f"runtime {name} 必须声明一个只读 U32 北向字段 {seconds_bind}")
        if clear_fields and (len(clear_fields) != 1 or
                             field_c_type(clear_fields[0]) != "bool" or
                             clear_fields[0].get("access") != "read_write"):
            raise ValueError(
                f"runtime {name} 的清零命令必须为一个可写 BOOL 北向字段")
        if pending_fields and (len(pending_fields) != 1 or
                               field_c_type(pending_fields[0]) != "bool" or
                               pending_fields[0].get("access") != "read"):
            raise ValueError(
                f"runtime {name} 已有清零中北向字段必须为一个只读 BOOL {pending_bind}")
        if not clear_fields and pending_fields:
            raise ValueError(
                f"runtime {name} 未暴露清零命令时不得单独暴露 {pending_bind}")


def _serial_character_bits(policy: dict, where: str) -> int:
    baud = policy.get("baud")
    parity = policy.get("parity")
    stop_bits = policy.get("stop_bits")
    if not isinstance(baud, int) or not 1200 <= baud <= 1000000:
        raise ValueError(f"{where}.baud 必须为 1200..1000000")
    if parity not in ("none", "even", "odd"):
        raise ValueError(f"{where}.parity 必须为 none/even/odd")
    if stop_bits not in (1, 2):
        raise ValueError(f"{where}.stop_bits 必须为 1 或 2")
    return 1 + 8 + (0 if parity == "none" else 1) + int(stop_bits)


def _read_response_bytes(function: int, count: int) -> int:
    if function in (1, 2):
        return 5 + (count + 7) // 8
    if function in (3, 4):
        return 5 + count * 2
    raise ValueError(f"RTU 读取功能码不支持: {function}")


def _calculate_rtu_budgets(project: dict, profiles: dict[str, dict]) -> dict[str, tuple[int, int, int]]:
    """返回端口的（常态、故障退避稳态）占用率千分比与轮询项数。

    常态模型包含请求、响应和 Modbus RTU 3.5 字符静默时间；故障模型按重试后
    进入 offline_backoff 的长期平均计算，不将一次超时突发误标成持续总线占用。
    """
    result: dict[str, tuple[int, int, int]] = {}
    ports = project.get("rs485_ports") or {}
    for port_name, policy in ports.items():
        bits = _serial_character_bits(policy, f"rs485_ports.{port_name}")
        char_ms = bits * 1000.0 / int(policy["baud"])
        normal = 0.0
        outage = 0.0
        polls = 0
        for device in project.get("devices") or []:
            if device["port"] != port_name:
                continue
            profile = profiles[str(device["profile"])]
            for block in profile.get("read_blocks") or []:
                function = FUNCTION_CODES[str(block["function"])]
                count = int(block["count"])
                request_ms = 8.0 * char_ms
                response_ms = _read_response_bytes(function, count) * char_ms
                transaction_ms = request_ms + response_ms + 7.0 * char_ms
                normal += transaction_ms / int(device["poll_period_ms"])
                attempts = int(policy["retry_count"]) + 1
                failed_attempt_ms = request_ms + float(policy["response_timeout_ms"]) + 3.5 * char_ms
                outage = max(outage, attempts * failed_attempt_ms /
                             (attempts * float(policy["response_timeout_ms"]) +
                              float(policy["offline_backoff_ms"])))
                polls += 1
        normal_permille = int(math.ceil(normal * 1000.0))
        worst_permille = int(math.ceil(max(normal, outage) * 1000.0))
        if normal_permille > MAX_RTU_NORMAL_UTILIZATION_PERMILLE:
            raise ValueError(
                f"{port_name} 常态 RTU 占用 {normal_permille / 10:.1f}% 超过 "
                f"{MAX_RTU_NORMAL_UTILIZATION_PERMILLE / 10:.0f}%")
        if worst_permille > MAX_RTU_WORST_UTILIZATION_PERMILLE:
            raise ValueError(
                f"{port_name} 故障退避稳态 RTU 占用 {worst_permille / 10:.1f}% 超过 "
                f"{MAX_RTU_WORST_UTILIZATION_PERMILLE / 10:.0f}%")
        result[port_name] = (normal_permille, worst_permille, polls)
    return result


def _rtu_request_counts(project: dict,
                        profiles: dict[str, dict]) -> dict[str, int]:
    """计算每端口完整请求数；同一输出写组只占一个计划项。"""
    counts = {"rs485_1": 0, "rs485_2": 0}
    for device in project.get("devices") or []:
        profile = profiles[str(device["profile"])]
        port_name = str(device["port"])
        counts[port_name] += len(profile.get("read_blocks") or [])
        write_groups: set[tuple[int, int, int]] = set()
        for signal_name in ((device.get("use") or {}).get("outputs") or {}):
            target = profile_output_target(profile, str(signal_name))
            write_groups.add((int(target["function"]), int(target["pdu_address"]),
                              int(target["quantity"])))
        counts[port_name] += len(write_groups)
    return counts


def _rtu_fault_completion_bounds(project: dict,
                                 profiles: dict[str, dict]) -> dict[str, int]:
    """计算故障场景下健康普通请求从到期到完成的保守软件调度上界。"""
    counts = _rtu_request_counts(project, profiles)
    scan_ms = int(project["scan_period_ms"])
    bounds = {"rs485_1": 0, "rs485_2": 0}
    for port_name, count in counts.items():
        if count == 0:
            continue
        policy = (project.get("rs485_ports") or {}).get(port_name) or {}
        attempt_budget = ((int(policy["retry_count"]) + 1) *
                          (int(policy["response_timeout_ms"]) + 2 * scan_ms))
        bounds[port_name] = 3 * count * attempt_budget
    return bounds


def _validate_capacity(project: dict, board: dict,
                       profiles: dict[str, dict], pids: list[dict],
                       blocks: dict[str, list[str]]) -> dict[str, tuple[int, int, int]]:
    bindings = _binding_items(project, board, profiles)
    north_fields = [
        {**field, "bind": _resolve_north_field_bind(project, profiles, field)}
        for field in ((project.get("northbound") or {}).get("fields") or [])
    ]
    if len(bindings) > MAX_BINDINGS:
        raise ValueError(f"绑定数 {len(bindings)} 超过轻量运行时上限 {MAX_BINDINGS}")
    if len(north_fields) > MAX_NORTH_FIELDS:
        raise ValueError(f"北向字段数 {len(north_fields)} 超过轻量运行时上限 {MAX_NORTH_FIELDS}")
    devices = project.get("devices") or []
    if len(devices) > MAX_RTU_DEVICES:
        raise ValueError(
            f"RTU 设备数 {len(devices)} 超过轻量运行时上限 {MAX_RTU_DEVICES}")
    request_counts = _rtu_request_counts(project, profiles)
    for port_name, request_count in request_counts.items():
        if request_count > MAX_RTU_REQUESTS_PER_PORT:
            raise ValueError(
                f"{port_name} 完整请求数 {request_count} 超过轻量运行时上限 "
                f"{MAX_RTU_REQUESTS_PER_PORT}")
    limits = {
        "timers": MAX_TIMERS, "edges": MAX_EDGES, "counters": MAX_COUNTERS,
        "latches": MAX_LATCHES, "debounces": MAX_DEBOUNCES,
        "filters": MAX_FILTERS, "rate_limits": MAX_RATE_LIMITS,
    }
    for group, maximum in limits.items():
        if len(blocks[group]) > maximum:
            raise ValueError(
                f"logic_blocks.{group} 数量 {len(blocks[group])} 超过轻量运行时上限 {maximum}")
    if len(pids) > MAX_PIDS:
        raise ValueError(f"PID 数量 {len(pids)} 超过轻量运行时上限 {MAX_PIDS}")
    return _calculate_rtu_budgets(project, profiles)


def _emit_block_enum(lines: list[str], type_name: str, prefix: str,
                     names: list[str]) -> None:
    lines.extend(["typedef enum", "{"])
    for index, name in enumerate(names):
        lines.append(f"    {prefix}_{_macro(name)} = {index}U,")
    lines.extend([f"    {prefix}_ID_COUNT = {len(names)}U", f"}} {type_name};", ""])


def _emit_struct(lines: list[str], name: str, fields: list[tuple[str, str]]) -> None:
    lines.extend(["typedef struct", "{"])
    if fields:
        for field_type, field_name in fields:
            lines.append(f"    {field_type} {c_ident(field_name)};")
    else:
        # C11 没有空 struct；该占位仅代表项目实例没有声明该方向的点位。
        lines.append("    uint8_t unused;")
    lines.extend([f"}} {name};", ""])


def _board_fields(board: dict, key: str, default_type: str) -> list[tuple[str, str]]:
    return [(default_type if default_type else c_type(str(item.get("c_type", "float"))),
             str(item["name"])) for item in board.get(key, [])]


def _rtu_fields(project: dict, profiles: dict[str, dict], direction: str) -> list[tuple[str, list[tuple[str, str]]]]:
    result: list[tuple[str, list[tuple[str, str]]]] = []
    for device in project.get("devices") or []:
        profile = profiles[str(device["profile"])]
        fields: list[tuple[str, str]] = []
        use = (device.get("use") or {}).get(direction) or {}
        if direction == "inputs":
            for signal_name in _device_runtime_input_names(
                    project, device, profile):
                fields.append((_sample_type(_native_profile_type(profile, signal_name)),
                               str(signal_name)))
        else:
            for signal_name in use:
                target = profile_output_target(profile, str(signal_name))
                fields.append((c_type(target["type"]), str(signal_name)))
        result.append((str(device["name"]), fields))
    return result


def _binding_items(project: dict, board: dict,
                   profiles: dict[str, dict]) -> list[tuple[str, str, str, str]]:
    """返回 bind、类型、分类与 LogicContext 内成员表达式。"""
    result: list[tuple[str, str, str, str]] = []
    board_node = board.get("board") or {}
    for item in board_node.get("digital_inputs") or []:
        name = c_ident(str(item["name"]))
        result.append((f"board.{item['name']}", "bool", "INPUT",
                       f"input.board.{name}"))
    for item in board_node.get("analog_inputs") or []:
        name = c_ident(str(item["name"]))
        result.append((f"board.{item['name']}", "float", "INPUT",
                       f"input.board.{name}"))
    for device in project.get("devices") or []:
        profile = profiles[str(device["profile"])]
        device_name = c_ident(str(device["name"]))
        use = device.get("use") or {}
        for signal_name in _device_runtime_input_names(
                project, device, profile):
            result.append((f"rtu.{device['name']}.{signal_name}",
                           _native_profile_type(profile, str(signal_name)), "INPUT",
                           f"input.{device_name}.{c_ident(str(signal_name))}"))
        for signal_name in (use.get("outputs") or {}):
            target = profile_output_target(profile, str(signal_name))
            result.append((f"rtu.{device['name']}.{signal_name}",
                           c_type(target["type"]), "OUTPUT",
                           f"output.{device_name}.{c_ident(str(signal_name))}"))
    variables = project.get("application_variables") or {}
    for item in _external_inputs(project):
        result.append((f"external.{item['name']}",
                       c_type(str(item["c_type"])), "EXTERNAL_INPUT",
                       f"input.external.{c_ident(str(item['name']))}"))
    for item in variables.get("parameters") or []:
        result.append((f"parameter.{item['name']}",
                       c_type(str(item.get("c_type", "float"))), "PARAMETER",
                       f"param.{c_ident(str(item['name']))}"))
    for item in (*SYSTEM_COMMAND_DEFS, *(variables.get("commands") or [])):
        result.append((f"command.{item['name']}",
                       c_type(str(item.get("c_type", "bool"))), "COMMAND",
                       f"command.{c_ident(str(item['name']))}"))
    framework_states = _runtime_generated_states(project)[:5]
    for item in (*(variables.get("states") or []), *framework_states):
        result.append((f"state.{item['name']}",
                       c_type(str(item.get("c_type", "bool"))), "STATE",
                       f"state.{c_ident(str(item['name']))}"))
    for runtime in _runtime_definitions(project):
        name = str(runtime["name"])
        result.extend((
            (f"runtime.{name}.clear", "bool", "COMMAND",
             f"command.{c_ident(name + '_runtime_clear')}"),
            (f"runtime.{name}.seconds", "uint32_t", "STATE",
             f"state.{c_ident(name + '_runtime_seconds')}"),
            (f"runtime.{name}.clear_pending", "bool", "STATE",
             f"state.{c_ident(name + '_runtime_clear_pending')}"),
        ))
    for item in board_node.get("digital_outputs") or []:
        result.append((f"board.{item['name']}", "bool", "OUTPUT",
                       f"output.board.{c_ident(str(item['name']))}"))
    for item in board_node.get("analog_outputs") or []:
        result.append((f"board.{item['name']}", "float", "OUTPUT",
                       f"output.board.{c_ident(str(item['name']))}"))
    return result


def _runtime_trigger_info(project: dict, board: dict,
                          profiles: dict[str, dict], runtime: dict) -> tuple[str, str]:
    """返回 runtime 触发源的 LogicContext 成员和生成枚举。"""
    bind = str(runtime["trigger"]["bind"])
    resolved = _resolve_project_bind(project, bind)
    binding = next(
        (item for item in _binding_items(project, board, profiles)
         if item[0] == resolved), None)
    if binding is None or binding[1] != "bool":
        raise ValueError(f"runtime {runtime['name']} 触发绑定不存在或不是 BOOL: {bind}")
    trigger_kind = (
        "POINT_CONFIG_RUNTIME_TRIGGER_BOOL_SAMPLE"
        if binding[2] == "INPUT" else
        "POINT_CONFIG_RUNTIME_TRIGGER_BOOL_SCALAR")
    return binding[3], trigger_kind


def _output_safety_items(project: dict, board: dict,
                         profiles: dict[str, dict]) -> list[tuple[str, str, object, float, float]]:
    result: list[tuple[str, str, object, float, float]] = []
    board_node = board.get("board") or {}
    for item in board_node.get("digital_outputs") or []:
        result.append((f"board.{item['name']}", "bool", item["safe_value"], 0.0, 1.0))
    for item in board_node.get("analog_outputs") or []:
        result.append((f"board.{item['name']}", "float", item["safe_value"],
                       float(item["software_min"]), float(item["software_max"])))
    for device in project.get("devices") or []:
        for signal_name, output_def in ((device.get("use") or {}).get("outputs") or {}).items():
            target = profile_output_target(
                profiles[str(device["profile"])], str(signal_name))
            result.append((f"rtu.{device['name']}.{signal_name}",
                           c_type(target["type"]), output_def["safe_value"],
                           float(target["raw_min"]), float(target["raw_max"])))
    return result


def _write_header(project: dict, board: dict, profiles: dict[str, dict],
                  pids: list[dict], budgets: dict[str, tuple[int, int, int]],
                  config_hash: int, output: Path) -> None:
    variables = project.get("application_variables") or {}
    external_inputs = _external_inputs(project)
    parameters = variables.get("parameters") or []
    commands = [*SYSTEM_COMMAND_DEFS, *(variables.get("commands") or []),
                *_runtime_generated_commands(project)]
    states = [*(variables.get("states") or []),
              *_runtime_generated_states(project)]
    north_fields = (project.get("northbound") or {}).get("fields") or []
    devices = project.get("devices") or []
    bindings = _binding_items(project, board, profiles)
    output_safety = _output_safety_items(project, board, profiles)
    points = project_points(project)
    runtimes = _runtime_definitions(project)
    persistent_parameters, persistent_payload_size, persistent_layout_hash = \
        _persistent_parameters(project)
    rtu_input_count = sum(
        len(_device_runtime_input_names(
            project, device, profiles[str(device["profile"])]))
        for device in devices)
    rtu_output_count = sum(len((device.get("use") or {}).get("outputs") or {})
                           for device in devices)
    blocks = _logic_block_names(project)
    board_node = board.get("board") or {}
    board_di = _board_fields(board_node, "digital_inputs", "PointConfigBoolSample")
    board_ai = _board_fields(board_node, "analog_inputs", "PointConfigFloatSample")
    board_do = _board_fields(board_node, "digital_outputs", "bool")
    board_ao = _board_fields(board_node, "analog_outputs", "float")
    startup_policies = _startup_policies(project)
    input_quality_policies = _input_quality_policies(project)
    command_policies = _command_policies(project)
    request_counts = _rtu_request_counts(project, profiles)
    fault_bounds = _rtu_fault_completion_bounds(project, profiles)
    manifest_algorithm, manifest_hash = _point_manifest(project)

    lines = [
        "/* 自动生成：point_config_gen.py；禁止手工修改。 */",
        "#ifndef KZ3_POINT_CONFIG_H",
        "#define KZ3_POINT_CONFIG_H",
        "",
        "#include <stdbool.h>",
        "#include <stdint.h>",
        '#include "north_contract.h"',
        "",
        f"#define POINT_CONFIG_SCHEMA_VERSION 7U",
        f"#define POINT_CONFIG_HASH 0x{config_hash:08X}UL",
        f'#define POINT_CONFIG_PROJECT_ID "{project["id"]}"',
        f'#define POINT_CONFIG_PROJECT_VERSION "{project["version"]}"',
        f'#define POINT_CONFIG_MANIFEST_ALGORITHM "{manifest_algorithm}"',
        f'#define POINT_CONFIG_MANIFEST_HASH "{manifest_hash}"',
        f"#define POINT_CONFIG_SCAN_PERIOD_MS {int(project['scan_period_ms'])}U",
        f"#define POINT_CONFIG_AO_DEFERRED_ACTIVATION_ENABLED "
        f"{1 if startup_policies['ao_deferred_activation'] else 0}U",
        f"#define POINT_CONFIG_BOARD_AI_STALE_AFTER_MS "
        f"{input_quality_policies['board_ai_stale_after_ms']}UL",
        f"#define POINT_CONFIG_NORTHBOUND_SLE_ENABLED "
        f"{1 if 'sle' in ((project.get('northbound') or {}).get('protocols') or []) else 0}U",
        f"#define POINT_CONFIG_MAX_LOGIC_CONTEXT_BYTES {MAX_LOGIC_CONTEXT_BYTES}U",
        f"#define POINT_CONFIG_MAX_BINDINGS {MAX_BINDINGS}U",
        f"#define POINT_CONFIG_MAX_NORTH_FIELDS {MAX_NORTH_FIELDS}U",
        f"#define POINT_CONFIG_MAX_RTU_DEVICES {MAX_RTU_DEVICES}U",
        f"#define POINT_CONFIG_MAX_RTU_REQUESTS_PER_PORT {MAX_RTU_REQUESTS_PER_PORT}U",
        f"#define POINT_CONFIG_BOARD_DI_COUNT {len(board_di)}U",
        f"#define POINT_CONFIG_BOARD_DO_COUNT {len(board_do)}U",
        f"#define POINT_CONFIG_BOARD_AI_COUNT {len(board_ai)}U",
        f"#define POINT_CONFIG_BOARD_AO_COUNT {len(board_ao)}U",
        f"#define POINT_CONFIG_RTU_DEVICE_COUNT {len(devices)}U",
        f"#define POINT_CONFIG_RTU_INPUT_COUNT {rtu_input_count}U",
        f"#define POINT_CONFIG_RTU_OUTPUT_COUNT {rtu_output_count}U",
        f"#define POINT_CONFIG_NORTH_FIELD_COUNT {len(north_fields)}U",
        f"#define POINT_CONFIG_PARAMETER_COUNT {len(parameters)}U",
        f"#define POINT_CONFIG_EXTERNAL_INPUT_COUNT {len(external_inputs)}U",
        f"#define POINT_CONFIG_PERSISTENT_PARAMETER_COUNT {len(persistent_parameters)}U",
        f"#define POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE {persistent_payload_size}U",
        f"#define POINT_CONFIG_PERSISTENT_LAYOUT_HASH 0x{persistent_layout_hash:08X}UL",
        f"#define POINT_CONFIG_MAX_PERSISTENT_PARAMETERS {MAX_PERSISTENT_PARAMETERS}U",
        f"#define POINT_CONFIG_MAX_PERSISTENT_PAYLOAD_BYTES {MAX_PERSISTENT_PAYLOAD_BYTES}U",
        f"#define POINT_CONFIG_COMMAND_COUNT {len(commands)}U",
        f"#define POINT_CONFIG_COMMAND_POLICY_COUNT {len(command_policies)}U",
        f"#define POINT_CONFIG_STATE_COUNT {len(states)}U",
        f"#define POINT_CONFIG_PID_COUNT {len(pids)}U",
        f"#define POINT_CONFIG_RUNTIME_COUNT {len(runtimes)}U",
        f"#define POINT_CONFIG_BINDING_COUNT {len(bindings)}U",
        f"#define POINT_CONFIG_OUTPUT_SAFETY_COUNT {len(output_safety)}U",
        f"#define POINT_CONFIG_PROJECT_POINT_COUNT {len(points)}U",
        f"#define POINT_CONFIG_TIMER_COUNT {len(blocks['timers'])}U",
        f"#define POINT_CONFIG_EDGE_COUNT {len(blocks['edges'])}U",
        f"#define POINT_CONFIG_COUNTER_COUNT {len(blocks['counters'])}U",
        f"#define POINT_CONFIG_LATCH_COUNT {len(blocks['latches'])}U",
        f"#define POINT_CONFIG_DEBOUNCE_COUNT {len(blocks['debounces'])}U",
        f"#define POINT_CONFIG_FILTER_COUNT {len(blocks['filters'])}U",
        f"#define POINT_CONFIG_RATE_LIMIT_COUNT {len(blocks['rate_limits'])}U",
        f"#define POINT_CONFIG_RTU0_NORMAL_UTILIZATION_PERMILLE {budgets.get('rs485_1', (0, 0, 0))[0]}U",
        f"#define POINT_CONFIG_RTU0_WORST_UTILIZATION_PERMILLE {budgets.get('rs485_1', (0, 0, 0))[1]}U",
        f"#define POINT_CONFIG_RTU0_POLL_COUNT {budgets.get('rs485_1', (0, 0, 0))[2]}U",
        f"#define POINT_CONFIG_RTU0_REQUEST_COUNT {request_counts['rs485_1']}U",
        f"#define POINT_CONFIG_RTU0_FAULT_COMPLETION_BOUND_MS {fault_bounds['rs485_1']}UL",
        f"#define POINT_CONFIG_RTU1_NORMAL_UTILIZATION_PERMILLE {budgets.get('rs485_2', (0, 0, 0))[0]}U",
        f"#define POINT_CONFIG_RTU1_WORST_UTILIZATION_PERMILLE {budgets.get('rs485_2', (0, 0, 0))[1]}U",
        f"#define POINT_CONFIG_RTU1_POLL_COUNT {budgets.get('rs485_2', (0, 0, 0))[2]}U",
        f"#define POINT_CONFIG_RTU1_REQUEST_COUNT {request_counts['rs485_2']}U",
        f"#define POINT_CONFIG_RTU1_FAULT_COMPLETION_BOUND_MS {fault_bounds['rs485_2']}UL",
        "",
        "typedef enum",
        "{",
        "    POINT_CONFIG_QUALITY_INIT = 0,",
        "    POINT_CONFIG_QUALITY_GOOD,",
        "    POINT_CONFIG_QUALITY_STALE,",
        "    POINT_CONFIG_QUALITY_OFFLINE,",
        "    POINT_CONFIG_QUALITY_BAD",
        "} PointConfigQuality;",
        "",
        "typedef struct { bool value; PointConfigQuality quality; uint32_t update_ms; } PointConfigBoolSample;",
        "typedef struct { float value; PointConfigQuality quality; uint32_t update_ms; } PointConfigFloatSample;",
        "typedef struct { uint16_t value; PointConfigQuality quality; uint32_t update_ms; } PointConfigU16Sample;",
        "typedef struct { bool value; PointConfigQuality quality; uint32_t update_ms; uint32_t interruption_count; } PointConfigExternalBoolSample;",
        "typedef struct { int32_t value; PointConfigQuality quality; uint32_t update_ms; uint32_t interruption_count; } PointConfigExternalS32Sample;",
        "typedef struct { float value; PointConfigQuality quality; uint32_t update_ms; uint32_t interruption_count; } PointConfigExternalFloatSample;",
        "",
    ]
    _emit_struct(lines, "PointConfigBoardInputs", board_di + board_ai)
    _emit_struct(lines, "PointConfigBoardOutputs", board_do + board_ao)
    for device_name, fields in _rtu_fields(project, profiles, "inputs"):
        _emit_struct(lines, f"PointConfigRtu_{c_ident(device_name)}Inputs", fields)
    for device_name, fields in _rtu_fields(project, profiles, "outputs"):
        _emit_struct(lines, f"PointConfigRtu_{c_ident(device_name)}Outputs", fields)

    _emit_struct(lines, "PointConfigExternalInputs", [
        (_external_sample_type(str(item["c_type"])), str(item["name"]))
        for item in external_inputs
    ])
    input_fields = [("PointConfigBoardInputs", "board")]
    input_fields.extend((f"PointConfigRtu_{c_ident(name)}Inputs", c_ident(name))
                        for name, _ in _rtu_fields(project, profiles, "inputs"))
    input_fields.append(("PointConfigExternalInputs", "external"))
    _emit_struct(lines, "LogicInputs", input_fields)
    output_fields = [("PointConfigBoardOutputs", "board")]
    output_fields.extend((f"PointConfigRtu_{c_ident(name)}Outputs", c_ident(name))
                         for name, _ in _rtu_fields(project, profiles, "outputs"))
    _emit_struct(lines, "LogicOutputs", output_fields)
    _emit_struct(lines, "LogicParameters", [(c_type(str(item.get("c_type", "float"))), str(item["name"]))
                                               for item in parameters])
    _emit_struct(lines, "LogicCommands", [(c_type(str(item.get("c_type", "bool"))), str(item["name"]))
                                             for item in commands])
    _emit_struct(lines, "LogicStates", [(c_type(str(item.get("c_type", "bool"))), str(item["name"]))
                                           for item in states])
    _emit_block_enum(lines, "PointConfigTimerId", "POINT_CONFIG_TIMER",
                     blocks["timers"])
    _emit_block_enum(lines, "PointConfigEdgeId", "POINT_CONFIG_EDGE",
                     blocks["edges"])
    _emit_block_enum(lines, "PointConfigCounterId", "POINT_CONFIG_COUNTER",
                     blocks["counters"])
    _emit_block_enum(lines, "PointConfigLatchId", "POINT_CONFIG_LATCH",
                     blocks["latches"])
    _emit_block_enum(lines, "PointConfigDebounceId", "POINT_CONFIG_DEBOUNCE",
                     blocks["debounces"])
    _emit_block_enum(lines, "PointConfigFilterId", "POINT_CONFIG_FILTER",
                     blocks["filters"])
    _emit_block_enum(lines, "PointConfigRateLimitId", "POINT_CONFIG_RATE_LIMIT",
                     blocks["rate_limits"])
    _emit_block_enum(lines, "PointConfigPidId", "POINT_CONFIG_PID",
                     [str(item["name"]) for item in pids])
    lines.extend([
        "typedef struct",
        "{",
        "    LogicInputs input;",
        "    LogicParameters param;",
        "    LogicCommands command;",
        "    LogicOutputs output;",
        "    LogicStates state;",
        "    uint32_t now_ms;",
        "} LogicContext;",
        "",
    ])
    binding_members = {bind: member for bind, _, _, member in bindings}
    lines.extend([
        "/* 业务 I/O 访问：第二个参数必须是 project.points 中声明的 name。 */",
        "#define IO_IN(context, name) KZ3_IO_IN_ ## name(context)",
        "#define IO_OUT(context, name) KZ3_IO_OUT_ ## name(context)",
        "",
    ])
    for point in points:
        direction = "IN" if point["direction"] == "inputs" else "OUT"
        description = " ".join(str(point["description"]).strip().split()).replace("*/", "* /")
        member = binding_members[str(point["source"])]
        lines.extend([
            f"/* {description} */",
            f"#define KZ3_IO_{direction}_{str(point['name'])}(context) \\",
            f"    ((context)->{member})",
            "",
        ])
    lines.extend([
        "/* 声明式累计时间访问：name 必须是 runtime_counters 中声明的名称。 */",
        "#define RUNTIME_SECONDS(context, name) KZ3_RUNTIME_SECONDS_ ## name(context)",
        "#define RUNTIME_CLEAR_PENDING(context, name) KZ3_RUNTIME_CLEAR_PENDING_ ## name(context)",
        "",
    ])
    for runtime in runtimes:
        name = str(runtime["name"])
        description = " ".join(str(runtime["description"]).strip().split()).replace("*/", "* /")
        lines.extend([
            f"/* {description} */",
            f"#define KZ3_RUNTIME_SECONDS_{name}(context) \\",
            f"    ((context)->state.{c_ident(name + '_runtime_seconds')})",
            f"#define KZ3_RUNTIME_CLEAR_PENDING_{name}(context) \\",
            f"    ((context)->state.{c_ident(name + '_runtime_clear_pending')})",
            "",
        ])
    lines.extend([
        "typedef enum { POINT_CONFIG_VALUE_BOOL = 0, POINT_CONFIG_VALUE_F32 = 1, POINT_CONFIG_VALUE_U16 = 2, POINT_CONFIG_VALUE_U32 = 3, POINT_CONFIG_VALUE_S32 = 4, POINT_CONFIG_VALUE_S16 = 5 } PointConfigValueType;",
        "typedef enum { POINT_CONFIG_PID_DIRECT = 0, POINT_CONFIG_PID_REVERSE = 1 } PointConfigPidDirection;",
        "typedef enum { POINT_CONFIG_BIND_INPUT = 0, POINT_CONFIG_BIND_PARAMETER = 1, POINT_CONFIG_BIND_COMMAND = 2, POINT_CONFIG_BIND_OUTPUT = 3, POINT_CONFIG_BIND_STATE = 4, POINT_CONFIG_BIND_EXTERNAL_INPUT = 5 } PointConfigBindingKind;",
        "typedef enum { POINT_CONFIG_COMMAND_NORMAL = 0, POINT_CONFIG_COMMAND_PROTECTIVE = 1 } PointConfigCommandEffect;",
        "typedef enum { POINT_CONFIG_PARAMETER_RESTORE_DEFAULTS = 0, POINT_CONFIG_PARAMETER_RESTORE_REQUIRE_VALID = 1 } PointConfigParameterRestorePolicy;",
        "typedef struct { const char *name; const char *profile; uint8_t port; uint8_t slave_address; uint16_t poll_period_ms; uint32_t stale_after_ms; } PointConfigRtuDevice;",
        "typedef struct { bool enabled; uint32_t baud; uint16_t response_timeout_ms; uint8_t retry_count; uint16_t offline_backoff_ms; } PointConfigRtuPort;",
        "typedef struct { uint8_t device_index; uint8_t function; uint16_t pdu_address; uint16_t count; uint16_t period_ms; } PointConfigRtuPoll;",
        "typedef union { struct { float minimum; float maximum; } f32; struct { uint32_t minimum; uint32_t maximum; } u32; struct { int32_t minimum; int32_t maximum; } s32; } PointConfigNorthRange;",
        "typedef struct { const char *name; const char *bind; uint8_t area; uint8_t function_read; uint8_t function_write; uint16_t pdu_address; uint8_t width; PointConfigValueType type; bool writable; PointConfigNorthRange range; } PointConfigNorthField;",
        "typedef struct { const char *device_name; const char *signal_name; const char *bind; uint8_t device_index; uint8_t port; uint8_t function; uint16_t pdu_address; uint16_t channel_index; uint16_t quantity; PointConfigValueType type; uint16_t raw_min; uint16_t raw_max; uint8_t feedback_function; uint16_t feedback_pdu_address; uint16_t feedback_channel_index; bool feedback_via_input; uint32_t confirm_timeout_ms; const char *source_bind; uint16_t safe_value; } PointConfigRtuOutput;",
        "typedef struct { const char *device_name; const char *signal_name; const char *bind; uint8_t device_index; uint8_t function; uint16_t pdu_address; uint16_t quantity; uint16_t channel_index; PointConfigValueType type; uint8_t byte_word_order; uint16_t raw_min; uint16_t raw_max; uint16_t engineering_min; uint16_t engineering_max; } PointConfigRtuInput;",
        "typedef struct { const char *name; const char *measurement_bind; const char *setpoint_bind; const char *output_bind; PointConfigValueType output_type; uint16_t output_raw_min; uint16_t output_raw_max; uint16_t sample_period_ms; uint16_t derivative_filter_ms; PointConfigPidDirection direction; float kp; float ki; float kd; float output_min; float output_max; bool enabled_by_default; } PointConfigPid;",
        "typedef enum { POINT_CONFIG_RUNTIME_TRIGGER_BOOL_SAMPLE = 0, POINT_CONFIG_RUNTIME_TRIGGER_BOOL_SCALAR = 1 } PointConfigRuntimeTriggerKind;",
        "typedef struct { uint8_t slot; uint32_t key_hash; uint16_t trigger_offset; PointConfigRuntimeTriggerKind trigger_kind; bool active_value; uint16_t clear_command_offset; uint16_t seconds_state_offset; uint16_t clear_pending_state_offset; } PointConfigRuntime;",
        "typedef struct { const char *bind; uint16_t context_offset; PointConfigValueType type; PointConfigBindingKind kind; } PointConfigBinding;",
        "typedef union { bool boolean; int32_t s32; float f32; } PointConfigExternalDefault;",
        "typedef struct { const char *bind; uint16_t context_offset; PointConfigValueType type; uint32_t stale_after_ms; uint32_t startup_grace_ms; PointConfigExternalDefault default_value; PointConfigNorthRange range; } PointConfigExternalInput;",
        "typedef struct { uint16_t offset; uint8_t effect; } PointConfigCommandPolicy;",
        "typedef struct { const char *bind; uint16_t parameter_offset; uint8_t payload_offset; uint8_t width; uint8_t index; PointConfigValueType type; bool has_range; double minimum; double maximum; } PointConfigPersistentParameter;",
        "typedef struct { const char *bind; PointConfigValueType type; bool bool_value; float f32_value; uint16_t u16_value; float minimum; float maximum; } PointConfigOutputSafety;",
        "typedef struct { uint16_t schema_version; uint32_t configuration_hash; uint32_t scan_period_ms; const char *project_id; const char *project_version; const char *project_name; PointConfigParameterRestorePolicy parameter_restore_policy; uint32_t board_ai_stale_after_ms; const PointConfigCommandPolicy *command_policies; uint16_t command_policy_count; const PointConfigRtuPort rtu_ports[2]; uint16_t rtu_normal_utilization_permille[2]; uint16_t rtu_worst_utilization_permille[2]; const PointConfigRtuDevice *rtu_devices; uint16_t rtu_device_count; const PointConfigRtuPoll *rtu_polls; uint16_t rtu_poll_count; const PointConfigNorthField *north_fields; uint16_t north_field_count; const PointConfigRtuInput *rtu_inputs; uint16_t rtu_input_count; const PointConfigRtuOutput *rtu_outputs; uint16_t rtu_output_count; const PointConfigPid *pids; uint16_t pid_count; const PointConfigBinding *bindings; uint16_t binding_count; const PointConfigExternalInput *external_inputs; uint16_t external_input_count; const PointConfigOutputSafety *output_safety; uint16_t output_safety_count; const PointConfigPersistentParameter *persistent_parameters; uint8_t persistent_parameter_count; uint8_t persistent_payload_size; uint32_t persistent_layout_hash; } PointConfig;",
        "",
        "extern const PointConfig g_point_config;",
        "extern const PointConfigRuntime g_point_config_runtimes[POINT_CONFIG_RUNTIME_COUNT > 0U ? POINT_CONFIG_RUNTIME_COUNT : 1U];",
        "extern const PointConfigExternalInput g_point_config_external_inputs[POINT_CONFIG_EXTERNAL_INPUT_COUNT > 0U ? POINT_CONFIG_EXTERNAL_INPUT_COUNT : 1U];",
        "extern const PointConfigPersistentParameter g_point_config_persistent_parameters[POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U ? POINT_CONFIG_PERSISTENT_PARAMETER_COUNT : 1U];",
        "extern const LogicParameters g_point_config_default_parameters;",
        "extern const NorthKeyGeneratedTable g_point_config_sle_table;",
        "bool PointConfig_ValidateBuildContract(void);",
        "const PointConfigBinding *PointConfig_FindBinding(const char *bind);",
        "const PointConfigExternalInput *PointConfig_FindExternalInput(const char *bind);",
        "const PointConfigPersistentParameter *PointConfig_FindPersistentParameter(const char *bind);",
        "#endif",
        "",
    ])
    output.write_text("\n".join(lines), encoding="utf-8")


def _emit_sle_table(lines: list[str], north_fields: list[dict]) -> None:
    """将 SLE route 与 HTTP/Modbus 的字段清单绑定到同一 YAML。"""
    rows: list[tuple[dict, int]] = []
    used_ids = set(LEGACY_SLE_KEY_IDS.values())
    next_id = max(used_ids) + 1
    for field in sorted(north_fields, key=lambda item: str(item["name"])):
        name = str(field["name"])
        key_id = LEGACY_SLE_KEY_IDS.get(name)
        if key_id is None:
            while next_id in used_ids:
                next_id += 1
            key_id = next_id
            used_ids.add(key_id)
            next_id += 1
        rows.append((field, key_id))

    def access(field: dict) -> str:
        if field["access"] != "read_write":
            return "LOGIC_ACCESS_READ_STATUS"
        bind = str(field["bind"])
        if (bind.startswith("command.") or
                bind.startswith("runtime.") and bind.endswith(".clear")):
            return "LOGIC_ACCESS_READ_STATUS | LOGIC_ACCESS_WRITE_COMMAND"
        if bind.startswith("external."):
            return "LOGIC_ACCESS_READ_STATUS | LOGIC_ACCESS_WRITE_EXTERNAL_INPUT"
        return "LOGIC_ACCESS_READ_STATUS | LOGIC_ACCESS_WRITE_PARAMETER"

    def owner(field: dict) -> str:
        bind = str(field["bind"])
        if bind.startswith("board."):
            return "LOGIC_SERVICE_OWNER_BOARD"
        if bind.startswith("rtu."):
            return "LOGIC_SERVICE_OWNER_MODBUS_RTU"
        if bind.startswith("parameter."):
            return "LOGIC_SERVICE_OWNER_PARAMETER"
        if bind.startswith("external."):
            return "LOGIC_SERVICE_OWNER_LOGIC"
        return "LOGIC_SERVICE_OWNER_LOGIC"

    def value_type(field: dict) -> str:
        return {
            "bool": "LOGIC_VALUE_BOOL",
            "float": "LOGIC_VALUE_F32",
            "u16": "LOGIC_VALUE_U16",
            "u32": "LOGIC_VALUE_U32",
            "s32": "LOGIC_VALUE_S32",
        }[field_c_type(field)]

    def area(field: dict) -> str:
        return {"0": "LOGIC_NORTH_AREA_COILS", "1": "LOGIC_NORTH_AREA_DISCRETE_INPUTS",
                "3": "LOGIC_NORTH_AREA_INPUT_REGISTERS", "4": "LOGIC_NORTH_AREA_HOLDING_REGISTERS"}[str(field["reference"])[0]]

    lines.extend(["", "static const NorthKeyDescriptor s_sle_keys[] = {"])
    for field, key_id in rows:
        name = str(field["name"])
        lines.append(f'    {{{key_id}U, {len(name)}U, 0UL, {access(field)}, "{name}"}},')
    lines.extend(["};", "", "static const NorthRoute s_sle_routes[] = {"])
    for field, key_id in rows:
        reference = str(field["reference"])
        base = {"0": 1, "1": 10001, "3": 30001, "4": 40001}[reference[0]]
        lines.append(f"    {{0UL, {key_id}U, {value_type(field)}, {access(field)}, {owner(field)}, 0U, {area(field)}, {validate_reference(reference, 'SLE field')}U - {base}U, {field_width(field)}U}},")
    count = len(rows)
    lines.extend([
        "};", "",
        "static int SleCompareKey(const char *left, uint16_t left_length, const char *right, uint16_t right_length)",
        "{", "    uint16_t common = left_length < right_length ? left_length : right_length;",
        "    int result = memcmp(left, right, common);",
        "    return result != 0 ? result : (left_length < right_length ? -1 : (left_length > right_length ? 1 : 0));", "}", "",
        "static LogicResult SleResolve(void *context, const char *key, uint16_t key_length, NorthRoute *route)",
        "{", "    uint16_t low = 0U;", f"    uint16_t high = {count}U;", "    (void)context;",
        "    if (key == NULL || route == NULL || key_length == 0U) return LOGIC_RESULT_INVALID_ARGUMENT;",
        "    while (low < high)", "    {", "        uint16_t middle = (uint16_t)(low + (high - low) / 2U);",
        "        int compare = SleCompareKey(s_sle_keys[middle].key, s_sle_keys[middle].key_length, key, key_length);",
        "        if (compare < 0) low = (uint16_t)(middle + 1U); else high = middle;", "    }",
        f"    if (low >= {count}U || SleCompareKey(s_sle_keys[low].key, s_sle_keys[low].key_length, key, key_length) != 0) return LOGIC_RESULT_NOT_FOUND;",
        "    *route = s_sle_routes[low];", "    return LOGIC_RESULT_OK;", "}", "",
        "static LogicResult SleDescriptor(void *context, uint16_t north_key_id, const NorthKeyDescriptor **descriptor)",
        "{", "    uint16_t index;", "    (void)context;",
        "    if (descriptor == NULL || north_key_id == 0U) return LOGIC_RESULT_INVALID_ARGUMENT;",
        f"    for (index = 0U; index < {count}U; ++index)",
        "        if (s_sle_keys[index].north_key_id == north_key_id) { *descriptor = &s_sle_keys[index]; return LOGIC_RESULT_OK; }",
        "    return LOGIC_RESULT_NOT_FOUND;", "}", "",
        "const NorthKeyGeneratedTable g_point_config_sle_table = { SleResolve, SleDescriptor, NULL };", "",
    ])


def _write_source(project: dict, board: dict, profiles: dict[str, dict], pids: list[dict],
                  budgets: dict[str, tuple[int, int, int]], output: Path) -> None:
    variables = project.get("application_variables") or {}
    external_inputs = _external_inputs(project)
    parameters = variables.get("parameters") or []
    persistent_parameters, _, _ = _persistent_parameters(project)
    devices = project.get("devices") or []
    runtimes = _runtime_definitions(project)
    startup_policies = _startup_policies(project)
    input_quality_policies = _input_quality_policies(project)
    command_policies = _command_policies(project)
    north_fields = [
        {**field, "bind": _resolve_north_field_bind(project, profiles, field)}
        for field in ((project.get("northbound") or {}).get("fields") or [])
    ]
    lines = [
        "/* 自动生成：point_config_gen.py；禁止手工修改。 */",
        '#include "point_config.h"',
        "#include <stddef.h>",
        "#include <string.h>",
        "",
        "_Static_assert(sizeof(LogicContext) <= UINT16_MAX,",
        "               \"LogicContext 过大，生成的绑定偏移无法表达\");",
        "_Static_assert(sizeof(LogicContext) <= POINT_CONFIG_MAX_LOGIC_CONTEXT_BYTES,",
        "               \"LogicContext 超过轻量控制器发布上限\");",
        "_Static_assert(POINT_CONFIG_BINDING_COUNT <= POINT_CONFIG_MAX_BINDINGS,",
        "               \"绑定数量超过轻量控制器发布上限\");",
        "_Static_assert(POINT_CONFIG_NORTH_FIELD_COUNT <= POINT_CONFIG_MAX_NORTH_FIELDS,",
        "               \"北向字段数量超过轻量控制器发布上限\");",
        "_Static_assert(POINT_CONFIG_RTU_DEVICE_COUNT <= POINT_CONFIG_MAX_RTU_DEVICES,",
        "               \"RTU 设备数量超过轻量控制器发布上限\");",
        "_Static_assert(POINT_CONFIG_RTU0_REQUEST_COUNT <= POINT_CONFIG_MAX_RTU_REQUESTS_PER_PORT,",
        "               \"RS485-1 请求数量超过运行时上限\");",
        "_Static_assert(POINT_CONFIG_RTU1_REQUEST_COUNT <= POINT_CONFIG_MAX_RTU_REQUESTS_PER_PORT,",
        "               \"RS485-2 请求数量超过运行时上限\");",
        "_Static_assert(POINT_CONFIG_PERSISTENT_PARAMETER_COUNT <= POINT_CONFIG_MAX_PERSISTENT_PARAMETERS,",
        "               \"持久化参数数量超过轻量控制器发布上限\");",
        "_Static_assert(POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE <= POINT_CONFIG_MAX_PERSISTENT_PAYLOAD_BYTES,",
        "               \"持久化参数净荷超过 EEPROM owner 上限\");",
        "",
        "static const PointConfigRtuDevice s_rtu_devices[] = {",
    ]
    for device in devices:
        port = {"rs485_1": 0, "rs485_2": 1}[str(device["port"])]
        lines.append(f'    {{"{device["name"]}", "{device["profile"]}", {port}U, {int(device["slave_address"])}U, {int(device["poll_period_ms"])}U, {int(device["stale_after_ms"])}UL}},')
    if not devices:
        # C11 不允许零长度数组；运行时以 rtu_device_count=0 忽略此占位项。
        lines.append("    {0},")
    lines.extend(["};", "", "static const PointConfigRtuPoll s_rtu_polls[] = {"])
    poll_count = 0
    for device_index, device in enumerate(devices):
        for block in profiles[str(device["profile"])].get("read_blocks", []):
            function = FUNCTION_CODES[str(block["function"])]
            lines.append(f"    {{{device_index}U, {function}U, {int(block.get('pdu_address', 0))}U, {int(block['count'])}U, {int(device['poll_period_ms'])}U}},")
            poll_count += 1
    if poll_count == 0:
        # C11 不允许零长度数组；运行时以 rtu_poll_count=0 忽略此占位项。
        lines.append("    {0},")
    lines.extend(["};", "", "static const PointConfigNorthField s_north_fields[] = {"])
    parameter_by_name = {str(item["name"]): item for item in parameters}
    external_by_name = {str(item["name"]): item for item in external_inputs}
    for field in north_fields:
        reference = str(field["reference"])
        address = validate_reference(reference, f"northbound field {field['name']}")
        base = {"0": 1, "1": 10001, "3": 30001, "4": 40001}[reference[0]]
        function_read = {"0": 1, "1": 2, "3": 4, "4": 3}[reference[0]]
        function_write = {"0": 5, "1": 0, "3": 0, "4": 6}[reference[0]]
        field_name = str(field["bind"]).split(".")[-1]
        range_source = parameter_by_name.get(field_name) or external_by_name.get(field_name)
        minimum = range_source["min"] if range_source and range_source.get("min") is not None else 0
        maximum = range_source["max"] if range_source and range_source.get("max") is not None else 0
        native_type = c_type(str(field["c_type"]))
        if native_type == "uint32_t":
            range_initializer = (
                f"{{.u32 = {{{int(minimum)}UL, {int(maximum)}UL}}}}")
        elif native_type == "int32_t":
            range_initializer = (
                f"{{.s32 = {{{int(minimum)}, {int(maximum)}}}}}")
        else:
            range_initializer = (
                f"{{.f32 = {{{_float(float(minimum))}, "
                f"{_float(float(maximum))}}}}}")
        lines.append(f'    {{"{field["name"]}", "{field["bind"]}", {reference[0]}U, {function_read}U, {function_write}U, {address - base}U, {field_width(field)}U, (PointConfigValueType){_point_config_value_type(field)}U, {_bool(field["access"] == "read_write")}, {range_initializer}}},')
    lines.extend(["};", "", "static const PointConfigRtuInput s_rtu_inputs[] = {"])
    input_count = 0
    for device_index, device in enumerate(devices):
        profile = profiles[str(device["profile"])]
        for signal_name in _device_runtime_input_names(
                project, device, profile):
            source = profile_input_source(profile, signal_name)
            block = profile_read_block(profile, source["block"])
            function = FUNCTION_CODES[str(block["function"])]
            raw_min, raw_max, engineering_min, engineering_max = (
                _profile_input_u16_engineering(profile, signal_name)
                if profile_input_type(profile, signal_name) == 2 else
                (0, 0, 0, 0))
            lines.append(f'    {{"{device["name"]}", "{signal_name}", "rtu.{device["name"]}.{signal_name}", {device_index}U, {function}U, {int(block.get("pdu_address", 0))}U, {int(block["count"])}U, {int(source["channel_index"])}U, (PointConfigValueType){profile_input_type(profile, signal_name)}U, {_profile_input_order(profile, signal_name)}U, {raw_min}U, {raw_max}U, {engineering_min}U, {engineering_max}U}},')
            input_count += 1
    if input_count == 0:
        # C11 不允许零长度数组；运行时以 rtu_input_count=0 忽略此占位项。
        lines.append("    {0},")
    lines.extend(["};", "", "static const PointConfigRtuOutput s_rtu_outputs[] = {"])
    output_count = 0
    for device_index, device in enumerate(devices):
        profile = profiles[str(device["profile"])]
        port = {"rs485_1": 0, "rs485_2": 1}[str(device["port"])]
        runtime_inputs = _device_runtime_input_names(project, device, profile)
        for signal_name, output_def in ((device.get("use") or {}).get("outputs") or {}).items():
            target = profile_output_target(profile, signal_name)
            feedback = _profile_output_feedback(profile, str(signal_name))
            public_name = str(signal_name)
            source_bind = f"rtu.{device['name']}.{public_name}"
            safe_value = output_def.get("safe_value", target["default_safe_value"])
            feedback_function, feedback_pdu, feedback_bit = feedback or (0, 0, 0)
            feedback_name = _profile_output_feedback_name(profile, str(signal_name))
            feedback_via_input = feedback_name in runtime_inputs
            confirm_timeout_ms = int(output_def.get(
                "confirm_timeout_ms", int(device["poll_period_ms"]) * 3))
            if confirm_timeout_ms <= 0 or confirm_timeout_ms > 0xFFFFFFFF:
                raise ValueError(
                    f"device {device['name']}: 输出 {signal_name}.confirm_timeout_ms 必须为正整数")
            value_type = "POINT_CONFIG_VALUE_BOOL" if target["type"] == "bool" else "POINT_CONFIG_VALUE_U16"
            lines.append(f'    {{"{device["name"]}", "{signal_name}", "rtu.{device["name"]}.{public_name}", {device_index}U, {port}U, {target["function"]}U, {target["pdu_address"]}U, {target["channel_index"]}U, {target["quantity"]}U, {value_type}, {target["raw_min"]}U, {target["raw_max"]}U, {feedback_function}U, {feedback_pdu}U, {feedback_bit}U, {_bool(feedback_via_input)}, {confirm_timeout_ms}UL, "{source_bind}", {int(safe_value)}U}},')
            output_count += 1
    if output_count == 0:
        # C11 不允许零长度数组；运行时以 rtu_output_count=0 忽略此占位项。
        lines.append("    {0},")
    lines.extend(["};", "", "static const PointConfigPid s_pids[] = {"])
    for item in pids:
        direction = ("POINT_CONFIG_PID_DIRECT" if item["direction"] == "direct"
                     else "POINT_CONFIG_PID_REVERSE")
        lines.append(
            f'    {{"{item["name"]}", "{_resolve_project_bind(project, str(item["measurement"]))}", '
            f'"{_resolve_project_bind(project, str(item["setpoint"]))}", '
            f'"{item["_resolved_output"]}", {item["_output_value_type"]}, '
            f'{item["_output_raw_min"]}U, {item["_output_raw_max"]}U, '
            f'{int(item["sample_period_ms"])}U, '
            f'{int(item["derivative_filter_ms"])}U, {direction}, '
            f'{_float(item["kp"])}, {_float(item["ki"])}, {_float(item["kd"])}, '
            f'{_float(item["output_min"])}, {_float(item["output_max"])}, '
            f'{_bool(item["enabled"])}}},')
    if not pids:
        # 与空 RTU 输入相同，避免依赖编译器的零长度数组扩展。
        lines.append("    {0},")
    lines.extend(["};", "", "const PointConfigRuntime g_point_config_runtimes[POINT_CONFIG_RUNTIME_COUNT > 0U ? POINT_CONFIG_RUNTIME_COUNT : 1U] = {"])
    for slot, runtime in enumerate(runtimes):
        name = str(runtime["name"])
        clear_name = c_ident(f"{name}_runtime_clear")
        seconds_name = c_ident(f"{name}_runtime_seconds")
        pending_name = c_ident(f"{name}_runtime_clear_pending")
        trigger_member, trigger_kind = _runtime_trigger_info(
            project, board, profiles, runtime)
        lines.append(
            f"    {{{slot}U, 0x{_runtime_key_hash(project, name):08X}UL, "
            f"(uint16_t)offsetof(LogicContext, {trigger_member}), "
            f"{trigger_kind}, {_bool(runtime['trigger']['active_value'])}, "
            f"(uint16_t)offsetof(LogicContext, command.{clear_name}), "
            f"(uint16_t)offsetof(LogicContext, state.{seconds_name}), "
            f"(uint16_t)offsetof(LogicContext, state.{pending_name})}},")
    if not runtimes:
        lines.append("    {0},")
    lines.extend(["};", "", "static const PointConfigBinding s_bindings[] = {"])
    value_types = {
        "bool": "POINT_CONFIG_VALUE_BOOL",
        "float": "POINT_CONFIG_VALUE_F32",
        "uint16_t": "POINT_CONFIG_VALUE_U16",
        "int16_t": "POINT_CONFIG_VALUE_S16",
        "uint32_t": "POINT_CONFIG_VALUE_U32",
        "int32_t": "POINT_CONFIG_VALUE_S32",
    }
    for bind, type_name, kind, member in _binding_items(project, board, profiles):
        lines.append(
            f'    {{"{bind}", (uint16_t)offsetof(LogicContext, {member}), '
            f'{value_types[type_name]}, POINT_CONFIG_BIND_{kind}}},')
    lines.extend(["};", "", "const PointConfigExternalInput g_point_config_external_inputs[POINT_CONFIG_EXTERNAL_INPUT_COUNT > 0U ? POINT_CONFIG_EXTERNAL_INPUT_COUNT : 1U] = {"])
    for item in external_inputs:
        native_type = c_type(str(item["c_type"]))
        value_type = value_types[native_type]
        if native_type == "bool":
            default_value = f"{{.boolean = {_bool(item['default'])}}}"
            value_range = "{.s32 = {0, 0}}"
        elif native_type == "int32_t":
            default_value = f"{{.s32 = {int(item['default'])}}}"
            value_range = (
                f"{{.s32 = {{{int(item['min'])}, {int(item['max'])}}}}}")
        else:
            default_value = f"{{.f32 = {_float(float(item['default']))}}}"
            value_range = (
                f"{{.f32 = {{{_float(float(item['min']))}, "
                f"{_float(float(item['max']))}}}}}")
        lines.append(
            f'    {{"external.{item["name"]}", '
            f'(uint16_t)offsetof(LogicContext, input.external.{c_ident(str(item["name"]))}), '
            f'{value_type}, {int(item["stale_after_ms"])}UL, '
            f'{int(item["startup_grace_ms"])}UL, {default_value}, '
            f'{value_range}}},')
    if not external_inputs:
        lines.append("    {0},")
    lines.extend(["};", "", "static const PointConfigCommandPolicy s_command_policies[POINT_CONFIG_COMMAND_POLICY_COUNT > 0U ? POINT_CONFIG_COMMAND_POLICY_COUNT : 1U] = {"])
    for policy in command_policies:
        effect = ("POINT_CONFIG_COMMAND_PROTECTIVE" if
                  policy["effect"] == "protective" else
                  "POINT_CONFIG_COMMAND_NORMAL")
        lines.append(
            f"    {{(uint16_t)offsetof(LogicContext, command."
            f"{c_ident(policy['name'])}), {effect}}},")
    if not command_policies:
        lines.append("    {0},")
    lines.extend(["};", "", "const PointConfigPersistentParameter g_point_config_persistent_parameters[POINT_CONFIG_PERSISTENT_PARAMETER_COUNT > 0U ? POINT_CONFIG_PERSISTENT_PARAMETER_COUNT : 1U] = {"])
    for entry in persistent_parameters:
        item = entry["item"]
        has_range = "min" in item and "max" in item
        minimum = float(item["min"]) if has_range else 0.0
        maximum = float(item["max"]) if has_range else 0.0
        lines.append(
            f'    {{"parameter.{item["name"]}", '
            f'(uint16_t)offsetof(LogicParameters, {c_ident(str(item["name"]))}), '
            f'{entry["payload_offset"]}U, {entry["width"]}U, {entry["index"]}U, '
            f'{entry["type_info"]["enum"]}, {_bool(has_range)}, '
            f'{_double(minimum)}, {_double(maximum)}}},')
    if not persistent_parameters:
        lines.append("    {0},")
    lines.extend(["};", "", "static const PointConfigOutputSafety s_output_safety[] = {"])
    for bind, type_name, value, minimum, maximum in _output_safety_items(
            project, board, profiles):
        value_type = value_types[type_name]
        bool_value = _bool(value) if type_name == "bool" else "false"
        float_value = _float(value) if type_name == "float" else "0.0f"
        u16_value = f"{int(value)}U" if type_name == "uint16_t" else "0U"
        lines.append(f'    {{"{bind}", {value_type}, {bool_value}, {float_value}, {u16_value}, '
                     f'{_float(minimum)}, {_float(maximum)}}},')
    lines.extend(["};", "", "const LogicParameters g_point_config_default_parameters = {"])
    if not parameters:
        lines.append("    .unused = 0U,")
    else:
        for parameter in parameters:
            value = parameter.get("default", False if c_type(str(parameter.get("c_type", "bool"))) == "bool" else 0)
            native_type = c_type(str(parameter.get("c_type", "float")))
            if native_type == "bool":
                literal = _bool(value)
            elif native_type == "float":
                literal = _float(value)
            elif native_type in {"uint16_t", "uint32_t"}:
                literal = f"{int(value)}U"
            else:
                literal = str(int(value))
            lines.append(f"    .{c_ident(str(parameter['name']))} = {literal},")
    ports = project.get("rs485_ports") or {}
    port_values = []
    for name in ("rs485_1", "rs485_2"):
        policy = ports.get(name)
        if policy is None:
            port_values.append("{false, 0UL, 0U, 0U, 0U}")
        else:
            port_values.append(
                f"{{true, {int(policy.get('baud', 0))}UL, "
                f"{int(policy['response_timeout_ms'])}U, "
                f"{int(policy['retry_count'])}U, "
                f"{int(policy['offline_backoff_ms'])}U}}")
    lines.extend(["};", "", "const PointConfig g_point_config = {",
                  "    POINT_CONFIG_SCHEMA_VERSION, POINT_CONFIG_HASH, POINT_CONFIG_SCAN_PERIOD_MS,",
                  f'    "{project["id"]}", "{project["version"]}",',
                  f'    "{project["name"]}",',
                  "    " + ("POINT_CONFIG_PARAMETER_RESTORE_REQUIRE_VALID," if
                              startup_policies["parameter_restore"] == "require_valid" else
                              "POINT_CONFIG_PARAMETER_RESTORE_DEFAULTS,"),
                  f"    {input_quality_policies['board_ai_stale_after_ms']}UL,",
                  "    s_command_policies, POINT_CONFIG_COMMAND_POLICY_COUNT,",
                  f"    {{{port_values[0]}, {port_values[1]}}},",
                  "    {POINT_CONFIG_RTU0_NORMAL_UTILIZATION_PERMILLE, POINT_CONFIG_RTU1_NORMAL_UTILIZATION_PERMILLE},",
                  "    {POINT_CONFIG_RTU0_WORST_UTILIZATION_PERMILLE, POINT_CONFIG_RTU1_WORST_UTILIZATION_PERMILLE},",
                  "    s_rtu_devices, POINT_CONFIG_RTU_DEVICE_COUNT,", 
                  f"    s_rtu_polls, {poll_count}U,",
                  "    s_north_fields, POINT_CONFIG_NORTH_FIELD_COUNT,",
                  f"    s_rtu_inputs, {input_count}U,",
                  f"    s_rtu_outputs, {output_count}U,",
                  "    s_pids, POINT_CONFIG_PID_COUNT,",
                  "    s_bindings, POINT_CONFIG_BINDING_COUNT,",
                  "    g_point_config_external_inputs, POINT_CONFIG_EXTERNAL_INPUT_COUNT,",
                  "    s_output_safety, POINT_CONFIG_OUTPUT_SAFETY_COUNT,",
                  "    g_point_config_persistent_parameters, POINT_CONFIG_PERSISTENT_PARAMETER_COUNT,",
                  "    POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE, POINT_CONFIG_PERSISTENT_LAYOUT_HASH", "};", "",
                  "static bool ValidateCommandPolicies(void)", "{",
                  "    uint16_t policy_index;", "",
                  "    for (policy_index = 0U; policy_index < POINT_CONFIG_COMMAND_POLICY_COUNT; ++policy_index)",
                  "    {",
                  "        const PointConfigCommandPolicy *policy = &s_command_policies[policy_index];",
                  "        uint16_t binding_index;",
                  "        uint16_t duplicate_index;",
                  "        bool found = false;", "",
                  "        if (policy->effect > POINT_CONFIG_COMMAND_PROTECTIVE ||",
                  "            policy->offset < offsetof(LogicContext, command) ||",
                  "            policy->offset >= offsetof(LogicContext, output))",
                  "        {", "            return false;", "        }",
                  "        for (duplicate_index = 0U; duplicate_index < policy_index; ++duplicate_index)",
                  "        {",
                  "            if (s_command_policies[duplicate_index].offset == policy->offset)",
                  "            {", "                return false;", "            }",
                  "        }",
                  "        for (binding_index = 0U; binding_index < POINT_CONFIG_BINDING_COUNT; ++binding_index)",
                  "        {",
                  "            const PointConfigBinding *binding = &s_bindings[binding_index];", "",
                  "            if (binding->context_offset == policy->offset &&",
                  "                binding->kind == POINT_CONFIG_BIND_COMMAND &&",
                  "                binding->type == POINT_CONFIG_VALUE_BOOL)",
                  "            {", "                found = true;", "                break;", "            }",
                  "        }",
                  "        if (!found)", "        {", "            return false;", "        }",
                  "    }",
                  "    return true;", "}", "",
                  "bool PointConfig_ValidateBuildContract(void)", "{",
                  "    return g_point_config.schema_version == POINT_CONFIG_SCHEMA_VERSION &&",
                  "           g_point_config.configuration_hash == POINT_CONFIG_HASH &&",
                  "           g_point_config.scan_period_ms == POINT_CONFIG_SCAN_PERIOD_MS &&",
                  "           strcmp(g_point_config.project_id, POINT_CONFIG_PROJECT_ID) == 0 &&",
                  "           strcmp(g_point_config.project_version, POINT_CONFIG_PROJECT_VERSION) == 0 &&",
                  "           g_point_config.board_ai_stale_after_ms == POINT_CONFIG_BOARD_AI_STALE_AFTER_MS &&",
                  "           g_point_config.command_policy_count == POINT_CONFIG_COMMAND_POLICY_COUNT &&",
                  "           ValidateCommandPolicies() &&",
                  "           g_point_config.rtu_device_count == POINT_CONFIG_RTU_DEVICE_COUNT &&",
                  "           g_point_config.rtu_normal_utilization_permille[0] == POINT_CONFIG_RTU0_NORMAL_UTILIZATION_PERMILLE &&",
                  "           g_point_config.rtu_normal_utilization_permille[1] == POINT_CONFIG_RTU1_NORMAL_UTILIZATION_PERMILLE &&",
                  "           g_point_config.rtu_worst_utilization_permille[0] == POINT_CONFIG_RTU0_WORST_UTILIZATION_PERMILLE &&",
                  "           g_point_config.rtu_worst_utilization_permille[1] == POINT_CONFIG_RTU1_WORST_UTILIZATION_PERMILLE &&",
                  "           g_point_config.north_field_count == POINT_CONFIG_NORTH_FIELD_COUNT &&",
                  "           g_point_config.pid_count == POINT_CONFIG_PID_COUNT &&",
                  "           g_point_config.binding_count == POINT_CONFIG_BINDING_COUNT &&",
                  "           g_point_config.external_input_count == POINT_CONFIG_EXTERNAL_INPUT_COUNT &&",
                  "           g_point_config.output_safety_count == POINT_CONFIG_OUTPUT_SAFETY_COUNT &&",
                  "           g_point_config.persistent_parameter_count == POINT_CONFIG_PERSISTENT_PARAMETER_COUNT &&",
                  "           g_point_config.persistent_payload_size == POINT_CONFIG_PERSISTENT_PAYLOAD_SIZE &&",
                  "           g_point_config.persistent_layout_hash == POINT_CONFIG_PERSISTENT_LAYOUT_HASH;",
                  "}", "",
                  "const PointConfigBinding *PointConfig_FindBinding(const char *bind)",
                  "{", "    uint16_t index;", "",
                  "    if (bind == NULL)", "    {", "        return NULL;", "    }",
                  "    for (index = 0U; index < POINT_CONFIG_BINDING_COUNT; ++index)",
                  "    {", "        if (strcmp(s_bindings[index].bind, bind) == 0)",
                  "        {", "            return &s_bindings[index];", "        }", "    }",
                  "    return NULL;", "}", ""])
    lines.extend([
        "const PointConfigExternalInput *PointConfig_FindExternalInput(const char *bind)",
        "{",
    ])
    if external_inputs:
        lines.extend(["    uint16_t index;", ""])
    lines.extend([
        "    if (bind == NULL)", "    {", "        return NULL;", "    }",
    ])
    if external_inputs:
        lines.extend([
            "    for (index = 0U; index < POINT_CONFIG_EXTERNAL_INPUT_COUNT; ++index)",
            "    {",
            "        if (strcmp(g_point_config_external_inputs[index].bind, bind) == 0)",
            "        {", "            return &g_point_config_external_inputs[index];", "        }",
            "    }",
        ])
    lines.extend(["    return NULL;", "}", ""])
    lines.extend([
        "const PointConfigPersistentParameter *PointConfig_FindPersistentParameter(const char *bind)",
        "{",
    ])
    if persistent_parameters:
        lines.extend(["    uint8_t index;", ""])
    lines.extend([
        "    if (bind == NULL)", "    {", "        return NULL;", "    }",
    ])
    if persistent_parameters:
        lines.extend([
            "    for (index = 0U; index < POINT_CONFIG_PERSISTENT_PARAMETER_COUNT; ++index)",
            "    {",
            "        if (strcmp(g_point_config_persistent_parameters[index].bind, bind) == 0)",
            "        {", "            return &g_point_config_persistent_parameters[index];", "        }",
            "    }",
        ])
    lines.extend(["    return NULL;", "}", ""])
    _emit_sle_table(lines, north_fields)
    output.write_text("\n".join(lines), encoding="utf-8")


def _write_markdown(project: dict, board: dict, profiles: dict[str, dict],
                    budgets: dict[str, tuple[int, int, int]], output: Path) -> None:
    board_node = board.get("board") or {}
    startup_policies = _startup_policies(project)
    input_quality_policies = _input_quality_policies(project)
    command_policies = _command_policies(project)
    request_counts = _rtu_request_counts(project, profiles)
    fault_bounds = _rtu_fault_completion_bounds(project, profiles)
    persistent_parameters, persistent_payload_size, persistent_layout_hash = \
        _persistent_parameters(project)
    lines = ["# 项目点位表", "", f"- 项目：`{project['name']}`",
             f"- 项目 ID：`{project['id']}`", f"- 版本：`{project['version']}`",
             f"- 板型：`{project['board']}`",
             f"- Profile 依赖：`{', '.join(project['required_profiles']) or '无'}`",
             f"- 扫描周期：`{project['scan_period_ms']} ms`",
             f"- 板载 AI 过期阈值：`{input_quality_policies['board_ai_stale_after_ms']} ms`",
             f"- 参数恢复策略：`{startup_policies['parameter_restore']}`", "",
             "## 命令策略", "",
             "| 命令 | effect |", "| --- | --- |"]
    for policy in command_policies:
        lines.append(f"| `command.{policy['name']}` | `{policy['effect']}` |")
    lines.extend(["",
             "## 项目业务点", "",
             "| 方向 | 业务名称 | 物理源 | 类型 | 安全值 | 描述 |",
             "| --- | --- | --- | --- | --- | --- |"])
    known_types = _known_bind_types(project, board, profiles)
    safety_by_bind = {bind: value for bind, _, value, _, _ in
                      _output_safety_items(project, board, profiles)}
    for point in project_points(project):
        source = str(point["source"])
        safe_value = safety_by_bind.get(source, "-")
        description = " ".join(str(point["description"]).split()).replace("|", "\\|")
        lines.append(
            f"| {'输入' if point['direction'] == 'inputs' else '输出'} | "
            f"`{point['name']}` | `{source}` | `{known_types[source]}` | "
            f"`{safe_value}` | {description} |")
    lines.extend(["", "## 板载物理点", "",
                  "| 类别 | 名称 | 端子 | 安全值/量程 |",
                  "| --- | --- | --- | --- |"])
    for category, key in (("DI", "digital_inputs"), ("DO", "digital_outputs"), ("AI", "analog_inputs"), ("AO", "analog_outputs")):
        for item in board_node.get(key, []):
            if "safe_value" in item:
                detail = item["safe_value"]
            elif "software_min" in item:
                detail = f"{item['software_min']}..{item['software_max']} {item.get('unit', '')}"
            else:
                detail = "-"
            lines.append(f"| {category} | `{item['name']}` | `{item.get('terminal', '')}` | `{detail}` |")
    persistent_by_name = {
        str(entry["item"]["name"]): entry for entry in persistent_parameters
    }
    lines.extend([
        "", "## 项目参数持久化", "",
        f"- 持久化参数：`{len(persistent_parameters)}` 个",
        f"- EEPROM 净荷：`{persistent_payload_size}` / "
        f"`{MAX_PERSISTENT_PAYLOAD_BYTES}` B",
        f"- 布局 hash：`0x{persistent_layout_hash:08X}`", "",
        "持久化参数按 YAML `application_variables.parameters` 声明顺序筛选并紧凑排列；",
        "字段缺省或为 `false` 时保持易失，不占 EEPROM。", "",
        "| 参数 | 类型 | 持久化 | 净荷 offset | 宽度 |",
        "| --- | --- | --- | ---: | ---: |",
    ])
    parameters = (project.get("application_variables") or {}).get("parameters") or []
    for item in parameters:
        name = str(item["name"])
        entry = persistent_by_name.get(name)
        if entry is None:
            lines.append(
                f"| `{name}` | `{item.get('c_type', 'float')}` | 否 | - | - |")
        else:
            lines.append(
                f"| `{name}` | `{entry['type_name']}` | 是 | "
                f"{entry['payload_offset']} | {entry['width']} B |")
    fields = (project.get("northbound") or {}).get("fields") or []
    used_ids = set(LEGACY_SLE_KEY_IDS.values())
    next_id = max(used_ids) + 1
    sle_ids: dict[str, int] = {}
    for field in sorted(fields, key=lambda item: str(item["name"])):
        name = str(field["name"])
        sle_ids[name] = LEGACY_SLE_KEY_IDS.get(name, next_id)
        if name not in LEGACY_SLE_KEY_IDS:
            next_id += 1
    lines.extend([
        "", "## 北向字段", "",
        "| 名称 | 配置绑定 | 运行时读绑定 | 类型 | 权限 | Modbus Reference | SLE 内部路由 ID |",
        "| --- | --- | --- | --- | --- | --- | ---: |"
    ])
    for field in fields:
        runtime_bind = _resolve_north_field_bind(project, profiles, field)
        lines.append(
            f"| `{field['name']}` | `{field['bind']}` | `{runtime_bind}` | "
            f"`{field_c_type(field)}` | `{field['access']}` | "
            f"`{field['reference']}` | {sle_ids[str(field['name'])]} |")
    lines.extend([
        "", "## 运行时间累计", "",
        "累计器由运行时框架在每次成功的逻辑扫描后自动更新，工程逻辑无需手工调用。",
        "输入业务点仅在质量为 `GOOD` 且值等于有效值时累计。", "",
        "| 名称 | 描述 | 触发点 | 有效值 | 质量条件 | 秒数绑定 | 清零绑定 | 清零状态绑定 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ])
    runtimes = _runtime_definitions(project)
    if runtimes:
        for runtime in runtimes:
            name = str(runtime["name"])
            trigger = runtime["trigger"]
            description = " ".join(
                str(runtime["description"]).split()).replace("|", "\\|")
            quality = trigger.get("quality", "-")
            lines.append(
                f"| `{name}` | {description} | `{trigger['bind']}` | "
                f"`{str(trigger['active_value']).lower()}` | `{quality}` | "
                f"`runtime.{name}.seconds` | `runtime.{name}.clear` | "
                f"`runtime.{name}.clear_pending` |")
    else:
        lines.append("| 无 | - | - | - | - | - | - | - |")
    lines.extend(["", "## PID 实例", "",
                  "| 名称 | 测量 | 给定 | 输出 | 输出类型/范围 | 周期 | D 滤波 | 方向 | Kp / Ki / Kd |",
                  "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |"])
    pids = project.get("pids") or []
    if pids:
        for item in pids:
            output_detail = ("float" if item["_output_value_type"] ==
                             "POINT_CONFIG_VALUE_F32" else
                             f"U16 raw {item['_output_raw_min']}..{item['_output_raw_max']}")
            lines.append(
                f"| `{item['name']}` | `{item['measurement']}` | `{item['setpoint']}` | "
                f"`{item['output']}` | {output_detail} | {item['sample_period_ms']} ms | "
                f"{item['derivative_filter_ms']} ms | "
                f"`{item['direction']}` | {item['kp']} / {item['ki']} / {item['kd']} |")
    else:
        lines.append("| 无 | - | - | - | - | - | - | - | - |")
    lines.extend(["", "## RTU 实例", "", "| 名称 | Profile | 端口 | 站号 | 轮询周期 |", "| --- | --- | --- | ---: | ---: |"])
    for device in project.get("devices") or []:
        lines.append(f"| `{device['name']}` | `{device['profile']}` | `{device['port']}` | {device['slave_address']} | {device['poll_period_ms']} ms |")
    lines.extend(["", "## RTU 容量预算", "",
                  "常态预算包含请求、响应和 RTU 静默时间；故障预算是重试后进入 "
                  "`offline_backoff_ms` 的长期平均占用，不等同于单次超时瞬时阻塞。",
                  "健康普通请求故障完成上界采用 `3 × N × B_max`，其中 "
                  "`B_i=(retry_i+1)×(response_timeout_i+2×scan_period)`；仅在底层能立即接收排队时成立。",
                  "", "| 端口 | 读取块数 | 完整请求数 | 常态占用 | 故障退避稳态占用 | 故障完成上界 | 发布阈值 |",
                  "| --- | ---: | ---: | ---: | ---: | ---: | --- |"])
    for port_name in ("rs485_1", "rs485_2"):
        normal, worst, polls = budgets.get(port_name, (0, 0, 0))
        lines.append(f"| `{port_name}` | {polls} | {request_counts[port_name]} | "
                     f"{normal / 10:.1f}% | {worst / 10:.1f}% | "
                     f"{fault_bounds[port_name]} ms | "
                     "常态 ≤50%，故障退避 ≤80%，完整请求 ≤32 |")
    lines.extend(["", "### 故障场景输入新鲜度", "",
                  "| 设备 | 端口 | stale 阈值 | 对应故障完成上界 | 判定 |",
                  "| --- | --- | ---: | ---: | --- |"])
    if project.get("devices"):
        for device in project.get("devices") or []:
            bound = fault_bounds[str(device["port"])]
            stale = int(device["stale_after_ms"])
            verdict = "可覆盖保守上界" if stale >= bound else "故障时可能进入 STALE"
            lines.append(f"| `{device['name']}` | `{device['port']}` | "
                         f"{stale} ms | {bound} ms | {verdict} |")
    else:
        lines.append("| 无 | - | - | - | - |")
    lines.append("")
    output.write_text("\n".join(lines), encoding="utf-8")


def generate(project_path: Path, output_dir: Path) -> None:
    project, board = validate(project_path)
    profiles = load_profiles(project_path.parent / "io_definitions")
    _validate_project_identity(project, board, profiles)
    _startup_policies(project)
    _input_quality_policies(project)
    _command_policies(project)
    _persistent_parameters(project)
    pids = _validate_pids(project, board, profiles)
    blocks = _logic_block_names(project)
    _validate_unique_bindings(project, board, profiles)
    _validate_runtime_north_fields(project)
    budgets = _validate_capacity(project, board, profiles, pids, blocks)
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_header(project, board, profiles, pids, budgets, _config_hash(project_path),
                  output_dir / "point_config.h")
    _write_source(project, board, profiles, pids, budgets, output_dir / "point_config.c")
    _write_markdown(project, board, profiles, budgets,
                    output_dir / "point_config.md")


def check(project_path: Path, output_dir: Path) -> None:
    if not output_dir.is_dir():
        raise ValueError(f"生成目录不存在: {output_dir}")
    with tempfile.TemporaryDirectory(prefix="point-config-") as temporary:
        expected = Path(temporary)
        generate(project_path, expected)
        expected_names = sorted(item.name for item in expected.iterdir())
        actual_names = sorted(item.name for item in output_dir.iterdir() if item.name != ".gitkeep")
        if expected_names != actual_names:
            raise ValueError(f"生成文件集合漂移: expected={expected_names}, actual={actual_names}")
        for name in expected_names:
            if (expected / name).read_bytes() != (output_dir / name).read_bytes():
                raise ValueError(f"生成文件过期或被手工修改: {output_dir / name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("application/generated"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            check(args.project, args.output_dir)
        else:
            generate(args.project, args.output_dir)
    except (OSError, KeyError, TypeError, ValueError, yaml.YAMLError) as error:
        print(f"point_config_gen: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
