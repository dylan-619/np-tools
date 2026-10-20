#!/usr/bin/env python3
"""在临时目录生成、严格编译并运行一个 KZ3 STM32-Logic 项目测试。"""

from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

import yaml


PROJECT_ID_PATTERN = re.compile(r"[A-Za-z0-9_.-]{1,48}")
NORTHBOUND_SHORT_NAME_PATTERN = re.compile(r"[A-Z][A-Z0-9_]{0,23}")
LOGIC_ENTRYPOINT_PATTERN = re.compile(
    r"\b(?:bool|void)\s+(Logic_(?:Init|Scan|Stop))\s*\(")
IO_OUT_PATTERN = re.compile(
    r"\bIO_OUT\s*\(\s*context\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)")
UNBOUNDED_LOOP_PATTERN = re.compile(
    r"\bwhile\s*\(\s*(?:1|true)\s*\)|\bfor\s*\(\s*;\s*;\s*\)")
INTERNAL_NORTHBOUND_BIND_PATTERN = re.compile(
    r"^state\..*(?:_phase|_phase_started_ms|_since_ms|_last_ms|_prev|"
    r"_previous|_confirming|_attempt_count|_scratch|_internal)$")
FORBIDDEN_NORTHBOUND_DESCRIPTION_TERMS = (
    "软件目标",
    "软件请求",
    "软件运行",
    "软件解读",
    "软件监督",
    "软件故障",
    "故障锁存",
)
QUALITY_LIMITS = {
    "effective_lines": 2000,
    "decision_points": 400,
    "max_brace_depth": 8,
    "max_output_write_sites": 2,
    "max_function_lines": 400,
    "max_function_decisions": 90,
    "max_function_parameters": 20,
}
REQUIREMENTS_BLOCK_PATTERN = re.compile(
    r"<!--\s*KZ3_REQUIREMENTS_CONTRACT_BEGIN\s*-->\s*"
    r"```yaml\s*(.*?)\s*```\s*"
    r"<!--\s*KZ3_REQUIREMENTS_CONTRACT_END\s*-->",
    re.DOTALL,
)
FUNCTION_DEFINITION_PATTERN = re.compile(
    r"(?m)^\s*(?:(?:static|inline|const|volatile|unsigned|signed|long|short)\s+)*"
    r"(?:struct\s+[A-Za-z_][A-Za-z0-9_]*|"
    r"enum\s+[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)"
    r"(?:\s*\*)?\s+"
    r"([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*\{")
PLC_TEST_PATTERN = re.compile(r"\bPLC_TEST:\s*([A-Z][A-Z0-9_]*)")
TEST_ASSERTION_PATTERN = re.compile(
    r"\b(?:assert|CHECK|PLC_CHECK|REQUIRE|VERIFY|EXPECT_[A-Z0-9_]+|"
    r"TEST_ASSERT(?:_[A-Z0-9_]+)?)\s*\(")
SCENARIO_ID_PATTERN = re.compile(r"[A-Z][A-Z0-9_]*")
PENDING_MARKERS = ("待确认", "待提供", "pending", "tbd", "【")
REQUIRED_CONFIRMATIONS = (
    "scope",
    "point_roles",
    "output_safe_values",
    "mode_owner",
    "priority",
    "bad_quality_policy",
    "reset_scope",
    "auto_restart_policy",
    "timing_units_and_boundaries",
    "northbound_whitelist",
)
REQUIRED_EVIDENCE_FIELDS = (
    "point_source",
    "safety_source",
    "control_source",
)
BASELINE_TEST_SCENARIOS = {
    "NORMAL_PATH",
    "BAD_QUALITY",
    "COMMAND_CONFLICT",
    "STOP_SAFE",
    "RESET_FAULTS",
}
NON_FUNCTION_NAMES = {"if", "for", "while", "switch"}
ENGINEERING_SCENARIOS = {
    "io_semantics": "POINT_MAPPING",
    "ownership": "MODE_TRANSFER",
    "startup_recovery": "RECOVERY_NO_START",
    "process_arbitration": "DEMAND_PRIORITY",
    "feedback_interlocks": "FEEDBACK_FAILURE",
    "measurement_quality": "BAD_QUALITY",
    "timing_parameters": "PARAMETER_UPDATE",
    "fault_reset": "RESET_FAULTS",
    "communication": "COMMUNICATION_LOSS",
    "retention": "RUNTIME_PERSISTENCE",
    "hmi_contract": "HMI_CONTRACT",
}
CONTROL_FEATURE_SCENARIOS = {
    "STAGED_GROUP": {
        "STAGE_TRANSITIONS", "CAPACITY_OWNERSHIP", "TIME_BOUNDARY",
        "TICK_WRAP", "PARAMETER_UPDATE",
    },
    "HETEROGENEOUS_GROUP": {
        "HETEROGENEOUS_REPLACEMENT", "CAPACITY_OWNERSHIP",
    },
    "PID_LOOP": {"PID_OWNER", "PID_TRANSFER", "PID_TUNING"},
    "MANUAL_MULTI_DEVICE": {"MANUAL_INDEPENDENCE", "MODE_ISOLATION"},
    "PER_DEVICE_AUTO": {
        "AUTO_SELECTION", "AUTO_POOL_ELIGIBILITY", "AUTO_MODE_ISOLATION",
    },
    "TIMED_AUTO_CYCLE": {
        "CYCLE_PER_DEVICE_PARAMETERS", "CYCLE_TIME_BOUNDARY",
        "CYCLE_INSTANCE_ISOLATION", "CYCLE_PARAMETER_UPDATE",
    },
    "VALVE_TIMED_SEQUENCE": {
        "VALVE_TIME_ORIGINS", "VALVE_SEQUENCE_ABORT", "VALVE_SEQUENCE_SELECTION",
    },
    "POSTRUN_LINKAGE": {
        "POSTRUN_TIME_ORIGIN", "POSTRUN_RETRIGGER", "POSTRUN_SAFETY_ABORT",
    },
    "PER_DEVICE_FAULT_RESET": {
        "DEVICE_RESET_OWNERSHIP", "DEVICE_RESET_ISOLATION",
    },
    "DEVICE_FAULT_COHERENCE": {
        "FAULT_LATCH_LIFECYCLE", "FAULT_VISIBLE_COHERENCE",
        "FAULT_RESET_COHERENCE",
    },
}
FORBIDDEN_PATTERNS = {
    "直接访问非 external 物理输入": re.compile(
        r"context\s*->\s*input\s*\.\s*(?!external\s*\.)"),
    "直接访问物理输出": re.compile(r"context\s*->\s*output\s*\."),
    "调用底层 LogicBlock API": re.compile(r"\bLogicBlock_[A-Za-z0-9_]+\s*\("),
    "调用 HAL": re.compile(r"\bHAL_[A-Za-z0-9_]+\s*\("),
    "动态内存": re.compile(r"\b(?:malloc|calloc|realloc|free)\s*\("),
    "阻塞等待": re.compile(r"\b(?:HAL_Delay|osDelay|vTaskDelay|sleep|usleep)\s*\("),
    "可写文件级 static 业务状态": re.compile(
        r"^\s*static\s+(?!const\b)(?!inline\b)"
        r"(?:bool|char|float|double|u?int(?:8|16|32|64)_t|"
        r"[A-Za-z_][A-Za-z0-9_]*\s*\*?)\s+"
        r"[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]*\])?\s*(?:=[^;]*)?;",
        re.MULTILINE,
    ),
}
FORBIDDEN_INCLUDES = re.compile(
    r'^\s*#\s*include\s*[<\"](?:stm32|FreeRTOS|cmsis_os|lwip|logic_manager|'
    r'data_manager|southbound|http|sle_|eeprom|modbus)', re.IGNORECASE | re.MULTILINE)


def find_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if ((candidate / "AGENTS.md").is_file() and
                (candidate / "application").is_dir() and
                (candidate / "tools" / "point_config_gen.py").is_file()):
            return candidate
    raise ValueError("找不到 KZ3 仓库根目录")


def run(command: list[str], cwd: Path, timeout_s: float = 120.0,
        env: dict[str, str] | None = None) -> None:
    print("+", " ".join(command))
    try:
        result = subprocess.run(command, cwd=cwd, check=False, text=True,
                                capture_output=True, timeout=timeout_s, env=env)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            f"命令超时（{timeout_s:g}s），本次验证失败: {' '.join(command)}") from error
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    if result.returncode != 0:
        raise RuntimeError(
            f"命令失败（exit={result.returncode}）: {' '.join(command)}")


def validate_sources(project_dir: Path) -> dict:
    required = ("README.md", "project_io.yaml", "logic.c",
                "logic_project_test.c")
    missing = [name for name in required if not (project_dir / name).is_file()]
    if missing:
        raise ValueError("项目缺少文件: " + ", ".join(missing))

    document = yaml.safe_load(
        (project_dir / "project_io.yaml").read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema") != "kz3-project-io/v3":
        raise ValueError("project_io.yaml schema 必须为 kz3-project-io/v3")
    project = document.get("project")
    if not isinstance(project, dict):
        raise ValueError("project_io.yaml 缺少 project mapping")
    project_id = project.get("id")
    if (not isinstance(project_id, str) or
            PROJECT_ID_PATTERN.fullmatch(project_id) is None):
        raise ValueError("project.id 必须为 1..48 位受限 ASCII")

    # 固件活动逻辑必须保持平台边界；项目主机测试为了验证 one-shot、
    # STOP/FAULT_SAFE 和有状态块，可以合法包含 DataManager/LogicManager 测试接口。
    logic_text = (project_dir / "logic.c").read_text(encoding="utf-8")
    if FORBIDDEN_INCLUDES.search(logic_text):
        raise ValueError("logic.c: 包含跨层或私有头文件")
    for description, pattern in FORBIDDEN_PATTERNS.items():
        match = pattern.search(logic_text)
        if match:
            line = logic_text.count("\n", 0, match.start()) + 1
            raise ValueError(f"logic.c:{line}: 禁止{description}")
    return project


def strip_c_comments(text: str) -> str:
    """去除注释但保留换行，供稳定的项目内静态指标使用。"""
    without_blocks = re.sub(
        r"/\*.*?\*/",
        lambda match: "\n" * match.group(0).count("\n"),
        text,
        flags=re.DOTALL,
    )
    return re.sub(r"//[^\n]*", "", without_blocks)


def calculate_logic_metrics(logic_text: str) -> dict[str, int]:
    stripped = strip_c_comments(logic_text)
    effective_lines = sum(1 for line in stripped.splitlines() if line.strip())
    decision_points = len(re.findall(r"\b(?:if|for|while|case)\b", stripped))
    decision_points += stripped.count("&&") + stripped.count("||")
    decision_points += len(re.findall(r"\?(?!\?)", stripped))
    depth = 0
    max_depth = 0
    for character in stripped:
        if character == "{":
            depth += 1
            max_depth = max(max_depth, depth)
        elif character == "}":
            depth = max(0, depth - 1)
    return {
        "effective_lines": effective_lines,
        "decision_points": decision_points,
        "max_brace_depth": max_depth,
    }


def contains_pending_marker(value: str) -> bool:
    lowered = value.strip().lower()
    return not lowered or any(marker in lowered for marker in PENDING_MARKERS)


class UniqueContractLoader(yaml.SafeLoader):
    """需求契约不能以 YAML 重复键静默覆盖签核结论。"""


def construct_unique_mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as error:
            raise ValueError("需求契约 YAML key 必须为可哈希标量") from error
        if duplicate:
            raise ValueError(f"需求契约 YAML 重复 key: {key}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueContractLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_unique_mapping)


def validate_engineering_review(contract: dict, require_frozen: bool) -> None:
    """校验决策采纳与边界到场景的追溯结构，不证明证据真实性或控制安全。"""
    review = contract.get("engineering_review")
    if not isinstance(review, dict) or review.get("profile") != "TABLE_CONTROL_V1":
        raise ValueError("缺少 engineering_review.profile=TABLE_CONTROL_V1")
    decisions = review.get("decisions")
    if not isinstance(decisions, list):
        raise ValueError("engineering_review.decisions 必须为列表")
    seen: set[str] = set()
    for decision in decisions:
        if not isinstance(decision, dict):
            raise ValueError("工程决策必须为 mapping")
        identifier = decision.get("id")
        if (not isinstance(identifier, str) or
                SCENARIO_ID_PATTERN.fullmatch(identifier) is None or identifier in seen):
            raise ValueError("工程决策 id 必须为唯一的大写 ASCII 标识")
        seen.add(identifier)
        status = decision.get("status")
        if status not in {"proposed", "accepted"}:
            raise ValueError(f"工程决策 {identifier} status 非法")
        for field in ("proposal", "selection", "basis"):
            value = decision.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"工程决策 {identifier}.{field} 必须为非空字符串")
            if (require_frozen or status == "accepted") and contains_pending_marker(value):
                raise ValueError(f"已采纳决策 {identifier}.{field} 仍含占位")
        if require_frozen and status != "accepted":
            raise ValueError(f"冻结需求仍有未采纳建议: {identifier}")

    boundaries = review.get("boundaries")
    if not isinstance(boundaries, dict) or set(boundaries) != set(ENGINEERING_SCENARIOS):
        raise ValueError("工程边界必须完整包含规定的 11 个域且无未知域")
    declared = set(contract["verification"]["required_scenarios"])
    # 旧契约允许省略；显式声明后必须规划对应反例，不从点名猜测工艺。
    features = review.get("control_features", [])
    if (not isinstance(features, list) or
            any(not isinstance(item, str) or item not in CONTROL_FEATURE_SCENARIOS
                for item in features) or len(set(features)) != len(features)):
        raise ValueError("control_features 必须为无重复的已知控制特征列表")
    for feature in features:
        missing = CONTROL_FEATURE_SCENARIOS[feature] - declared
        if missing:
            raise ValueError(f"控制特征 {feature} 缺少场景: " + ", ".join(sorted(missing)))
    for domain, required_scenario in ENGINEERING_SCENARIOS.items():
        item = boundaries[domain]
        if not isinstance(item, dict):
            raise ValueError(f"工程边界 {domain} 必须为 mapping")
        status = item.get("status")
        if status not in {"pending", "specified", "not_applicable"}:
            raise ValueError(f"工程边界 {domain} status 非法")
        rationale = item.get("rationale")
        if not isinstance(rationale, str) or not rationale.strip():
            raise ValueError(f"工程边界 {domain} 缺少依据或不适用理由")
        if status != "pending" and contains_pending_marker(rationale):
            raise ValueError(f"工程边界 {domain} 的依据仍含占位")
        scenarios = item.get("scenarios")
        if (not isinstance(scenarios, list) or
                any(not isinstance(s, str) or SCENARIO_ID_PATTERN.fullmatch(s) is None
                    for s in scenarios) or len(set(scenarios)) != len(scenarios)):
            raise ValueError(f"工程边界 {domain}.scenarios 必须为无重复的场景 ID 列表")
        if set(scenarios) - declared:
            raise ValueError(f"工程边界 {domain} 引用未声明的场景")
        if status == "specified" and required_scenario not in scenarios:
            raise ValueError(f"工程边界 {domain} 缺少场景 {required_scenario}")
        if status == "not_applicable" and scenarios:
            raise ValueError(f"不适用边界 {domain} 不应挂接场景")
        if require_frozen and status == "pending":
            raise ValueError(f"冻结需求仍有未决工程边界: {domain}")


def validate_requirements_contract(
        readme_text: str, require_frozen: bool,
        require_engineering_review: bool = False) -> dict:
    matches = list(REQUIREMENTS_BLOCK_PATTERN.finditer(readme_text))
    if not matches:
        raise ValueError("README 缺少 KZ3_REQUIREMENTS_CONTRACT 机器可读需求契约")
    if (len(matches) != 1 or
            readme_text.count("KZ3_REQUIREMENTS_CONTRACT_BEGIN") != 1 or
            readme_text.count("KZ3_REQUIREMENTS_CONTRACT_END") != 1):
        raise ValueError("需求文档必须恰有一个完整有效契约块，不得并列历史或残缺契约")
    document = yaml.load(matches[0].group(1), Loader=UniqueContractLoader)
    if not isinstance(document, dict):
        raise ValueError("需求契约 YAML 必须为 mapping")
    contract = document.get("requirements_contract")
    if not isinstance(contract, dict):
        raise ValueError("需求契约缺少 requirements_contract mapping")
    if contract.get("schema") != "kz3-requirements/v1":
        raise ValueError("需求契约 schema 必须为 kz3-requirements/v1")

    status = contract.get("status")
    if status not in {"DRAFT", "BLOCKED", "FROZEN"}:
        raise ValueError("需求契约 status 必须为 DRAFT、BLOCKED 或 FROZEN")
    # 自称 FROZEN 的文档即使只做结构检查，也不能保留未决确认或未采纳建议。
    require_frozen = require_frozen or status == "FROZEN"
    project_id = contract.get("project_id")
    version = contract.get("version")
    if require_frozen:
        if status != "FROZEN":
            raise ValueError("生成和严格验证要求需求契约 status=FROZEN")
        if (not isinstance(project_id, str) or
                PROJECT_ID_PATTERN.fullmatch(project_id) is None):
            raise ValueError("冻结需求 project_id 必须为 1..48 位受限 ASCII")
        if not isinstance(version, str) or contains_pending_marker(version):
            raise ValueError("冻结需求 version 必须明确且不能含待确认占位")

    evidence = contract.get("evidence")
    if not isinstance(evidence, dict):
        raise ValueError("需求契约缺少 evidence mapping")
    for field in REQUIRED_EVIDENCE_FIELDS:
        value = evidence.get(field)
        if not isinstance(value, str):
            raise ValueError(f"需求证据 {field} 必须为字符串")
        if require_frozen and contains_pending_marker(value):
            raise ValueError(f"冻结需求证据 {field} 不能缺失或待确认")

    confirmations = contract.get("confirmations")
    if not isinstance(confirmations, dict):
        raise ValueError("需求契约缺少 confirmations mapping")
    missing_confirmations = [
        name for name in REQUIRED_CONFIRMATIONS if name not in confirmations
    ]
    if missing_confirmations:
        raise ValueError(
            "需求契约缺少确认项: " + ", ".join(missing_confirmations))
    invalid_confirmations = [
        name for name in REQUIRED_CONFIRMATIONS
        if not isinstance(confirmations.get(name), bool)
    ]
    if invalid_confirmations:
        raise ValueError(
            "需求确认项必须为 bool: " + ", ".join(invalid_confirmations))
    if require_frozen:
        unconfirmed = [
            name for name in REQUIRED_CONFIRMATIONS
            if confirmations.get(name) is not True
        ]
        if unconfirmed:
            raise ValueError("冻结需求仍有未确认项: " + ", ".join(unconfirmed))

    traceability = contract.get("traceability")
    if not isinstance(traceability, dict):
        raise ValueError("需求契约缺少 traceability mapping")
    missing_traceability = [
        name for name in REQUIRED_CONFIRMATIONS if name not in traceability
    ]
    if missing_traceability:
        raise ValueError(
            "需求契约缺少追溯引用: " + ", ".join(missing_traceability))
    for name in REQUIRED_CONFIRMATIONS:
        reference = traceability.get(name)
        if not isinstance(reference, str):
            raise ValueError(f"需求追溯引用 {name} 必须为字符串")
        if require_frozen and contains_pending_marker(reference):
            raise ValueError(f"冻结需求追溯引用 {name} 不能缺失或待确认")

    northbound = contract.get("northbound")
    if not isinstance(northbound, dict):
        raise ValueError("需求契约缺少 northbound mapping")
    if northbound.get("profile") != "HMI_SHORT_V1":
        raise ValueError("需求契约 northbound.profile 必须为 HMI_SHORT_V1")

    verification = contract.get("verification")
    scenarios = (verification.get("required_scenarios")
                 if isinstance(verification, dict) else None)
    if not isinstance(scenarios, list) or not scenarios:
        raise ValueError("需求契约必须声明 verification.required_scenarios")
    if any(not isinstance(item, str) or
           SCENARIO_ID_PATTERN.fullmatch(item) is None for item in scenarios):
        raise ValueError("required_scenarios 必须使用大写 ASCII 场景 ID")
    if len(set(scenarios)) != len(scenarios):
        raise ValueError("required_scenarios 不能重复")
    missing_baseline = sorted(BASELINE_TEST_SCENARIOS - set(scenarios))
    if missing_baseline:
        raise ValueError("需求契约缺少基础验收场景: " + ", ".join(missing_baseline))

    open_items = contract.get("open_items")
    if not isinstance(open_items, list):
        raise ValueError("需求契约 open_items 必须为列表")
    if require_frozen and open_items:
        raise ValueError("冻结需求 open_items 必须为空")
    if require_engineering_review or "engineering_review" in contract:
        validate_engineering_review(contract, require_frozen)
    return contract


def extract_function_metrics(logic_text: str) -> list[dict]:
    stripped = strip_c_comments(logic_text)
    functions: list[dict] = []
    for match in FUNCTION_DEFINITION_PATTERN.finditer(stripped):
        if match.group(1) in NON_FUNCTION_NAMES:
            continue
        body_start = stripped.find("{", match.start())
        depth = 0
        body_end = None
        for index in range(body_start, len(stripped)):
            if stripped[index] == "{":
                depth += 1
            elif stripped[index] == "}":
                depth -= 1
                if depth == 0:
                    body_end = index + 1
                    break
        if body_end is None:
            raise ValueError(f"无法解析函数边界: {match.group(1)}")
        body = stripped[body_start:body_end]
        parameters = match.group(2).strip()
        parameter_count = (
            0 if not parameters or parameters == "void"
            else len(parameters.split(","))
        )
        metrics = calculate_logic_metrics(body)
        functions.append({
            "name": match.group(1),
            "body": body,
            "parameters": parameter_count,
            **metrics,
        })
    return functions


def validate_function_quality(logic_text: str) -> dict[str, int]:
    functions = extract_function_metrics(logic_text)
    if not functions:
        raise ValueError("严格质量门禁无法识别 logic.c 函数")
    names = {function["name"] for function in functions}
    graph: dict[str, set[str]] = {}
    for function in functions:
        name = function["name"]
        for metric_name, limit_name in (
            ("effective_lines", "max_function_lines"),
            ("decision_points", "max_function_decisions"),
            ("parameters", "max_function_parameters"),
        ):
            if function[metric_name] > QUALITY_LIMITS[limit_name]:
                raise ValueError(
                    f"函数 {name} 的 {metric_name}={function[metric_name]} "
                    f"超过上限 {QUALITY_LIMITS[limit_name]}")
        calls = set(re.findall(
            r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", function["body"]))
        graph[name] = calls & names

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(name: str, path: list[str]) -> None:
        if name in visiting:
            cycle_start = path.index(name)
            cycle = path[cycle_start:]
            raise ValueError("严格质量门禁禁止递归调用: " + " -> ".join(cycle))
        if name in visited:
            return
        visiting.add(name)
        for callee in sorted(graph.get(name, set())):
            visit(callee, [*path, callee])
        visiting.remove(name)
        visited.add(name)

    for name in sorted(names):
        visit(name, [name])
    return {
        "max_function_lines": max(
            function["effective_lines"] for function in functions),
        "max_function_decisions": max(
            function["decision_points"] for function in functions),
        "max_function_parameters": max(
            function["parameters"] for function in functions),
    }


def infer_required_scenarios(
        project: dict, logic_text: str, readme_text: str) -> set[str]:
    required = set(BASELINE_TEST_SCENARIOS)
    if re.search(
            r"\b(?:TON|TOF|TP|DEBOUNCE|FILTER|RATE_LIMIT)\s*\(|\b\w+_ms\b",
            logic_text):
        required.update({"TIME_BOUNDARY", "TICK_WRAP"})
    runtime_counters = project.get("runtime_counters")
    if isinstance(runtime_counters, list) and runtime_counters:
        required.add("RUNTIME_PERSISTENCE")
    devices = project.get("devices")
    if isinstance(devices, list) and devices:
        required.add("COMMUNICATION_LOSS")
    variables = project.get("application_variables")
    external_inputs = (variables.get("external_inputs")
                       if isinstance(variables, dict) else None)
    if isinstance(external_inputs, list) and external_inputs:
        required.add("EXTERNAL_INPUT_LIFECYCLE")
    if re.search(r"主备|轮换|替补|正反转|互锁|切换", readme_text):
        required.add("NEGATIVE_SWITCH_WINDOW")
    return required


def validate_test_contract(
        project: dict, logic_text: str, readme_text: str,
        test_text: str, contract: dict) -> dict[str, int]:
    test_metrics = calculate_logic_metrics(test_text)
    if test_metrics["effective_lines"] < 25:
        raise ValueError("logic_project_test.c 有效代码不足 25 行，不能证明项目行为")
    if test_metrics["decision_points"] < 3:
        raise ValueError("logic_project_test.c 缺少足够的分支/边界测试")
    stripped_test = strip_c_comments(test_text)
    assertion_points = len(TEST_ASSERTION_PATTERN.findall(stripped_test))
    assertion_points += len(re.findall(
        r"\breturn\s+(?:false|EXIT_FAILURE|[1-9][0-9]*U?)\s*;",
        stripped_test,
    ))
    if assertion_points < 3:
        raise ValueError("logic_project_test.c 至少需要 3 个可执行断言")
    if re.search(
            r"\b(?:Logic_(?:Init|Scan|Stop)|LogicManager_[A-Za-z0-9_]+|"
            r"DataManager_[A-Za-z0-9_]+)\s*\(", stripped_test) is None:
        raise ValueError("logic_project_test.c 未调用项目逻辑或真实管理器路径")
    for keyword in ("Given", "When", "Then"):
        if keyword not in test_text:
            raise ValueError(f"logic_project_test.c 缺少 {keyword} 场景说明")

    declared = set(contract["verification"]["required_scenarios"])
    inferred = infer_required_scenarios(project, logic_text, readme_text)
    missing_declared = sorted(inferred - declared)
    if missing_declared:
        raise ValueError(
            "需求契约未声明按项目特征推导的场景: " + ", ".join(missing_declared))
    implemented = set(PLC_TEST_PATTERN.findall(test_text))
    missing_implemented = sorted(declared - implemented)
    if missing_implemented:
        raise ValueError(
            "logic_project_test.c 缺少 PLC_TEST 场景: " +
            ", ".join(missing_implemented))
    return {
        "test_effective_lines": test_metrics["effective_lines"],
        "test_decision_points": test_metrics["decision_points"],
        "test_assertions": assertion_points,
        "test_scenarios": len(implemented),
    }


def validate_northbound_contract(project: dict, host_case: bool = False) -> int:
    northbound = project.get("northbound")
    if not isinstance(northbound, dict):
        raise ValueError("严格质量门禁要求 project.northbound mapping")
    fields = northbound.get("fields")
    if not isinstance(fields, list) or not fields:
        raise ValueError("严格质量门禁要求非空 northbound.fields 白名单")
    points = project.get("points")
    outputs = points.get("outputs") if isinstance(points, dict) else []
    output_binds = {
        f"point.{item.get('name')}"
        for item in outputs
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }
    output_object_prefixes = {
        field.get("name")[:-3]
        for field in fields
        if (isinstance(field, dict) and field.get("bind") in output_binds and
            field.get("c_type") == "bool" and
            isinstance(field.get("name"), str) and
            field.get("name").endswith("_DO"))
    }
    seen: set[str] = set()
    for index, field in enumerate(fields):
        if not isinstance(field, dict):
            raise ValueError(f"northbound.fields[{index}] 必须为 mapping")
        name = field.get("name")
        if (not isinstance(name, str) or
                NORTHBOUND_SHORT_NAME_PATTERN.fullmatch(name) is None):
            raise ValueError(
                f"northbound.fields[{index}].name 必须符合 HMI_SHORT_V1 "
                "[A-Z][A-Z0-9_]{0,23}")
        if name in seen:
            raise ValueError(f"北向短名重复: {name}")
        seen.add(name)
        description = field.get("description")
        if (not isinstance(description, str) or not description.strip() or
                re.search(r"[\u4e00-\u9fff]", description) is None):
            raise ValueError(f"北向字段 {name} 缺少中文 description")
        bind = field.get("bind")
        if not isinstance(bind, str) or not bind:
            raise ValueError(f"北向字段 {name} 缺少 bind")
        if bind.startswith("runtime.") and bind.endswith(".clear_pending"):
            raise ValueError(f"北向字段 {name} 暴露累计清零内部过程态: {bind}")
        bind_tail = bind.rsplit(".", 1)[-1]
        forbidden_term = next(
            (term for term in FORBIDDEN_NORTHBOUND_DESCRIPTION_TERMS
             if term in description),
            None,
        )
        if forbidden_term is not None:
            raise ValueError(
                f"北向字段 {name} 的 description 使用内部实现术语"
                f"“{forbidden_term}”，应改为现场业务说明")
        compact_description = re.sub(r"\s+", "", description)
        if (bind in output_binds and field.get("c_type") == "bool" and
                "DO输出" not in compact_description):
            raise ValueError(
                f"北向字段 {name} 绑定 BOOL 物理输出，description 必须写明“DO输出”")
        if (bind.startswith("command.") and
                bind_tail.endswith("reset_faults") and
                "故障复位" not in description):
            raise ValueError(
                f"北向字段 {name} 绑定复位命令，description 必须使用“故障复位”")
        if name.endswith("_F_L") and "总故障" not in description:
            raise ValueError(
                f"北向字段 {name} 是故障汇总，description 必须使用“总故障”")
        if INTERNAL_NORTHBOUND_BIND_PATTERN.fullmatch(bind):
            raise ValueError(f"北向字段 {name} 暴露内部临时量: {bind}")
        expected_suffix = None
        expected_name = None
        if bind.startswith("command.") and bind_tail.endswith("reset_faults"):
            expected_suffix = "_RST"
            if bind == "command.reset_faults":
                if len(output_object_prefixes) == 1:
                    expected_name = f"{next(iter(output_object_prefixes))}_RST"
                elif len(output_object_prefixes) > 1:
                    expected_name = "SYS_RST"
        elif bind.startswith("command."):
            if re.search(r"(?:^|_)(?:start|request_on)$", bind_tail):
                expected_suffix = "_STA"
            elif re.search(r"(?:^|_)(?:stop|request_off)$", bind_tail):
                expected_suffix = "_STP"
        elif bind.startswith("runtime.") and bind.endswith(".seconds"):
            expected_suffix = "_RT_S"
        elif bind in output_binds and field.get("c_type") == "bool":
            expected_suffix = "_DO"
        elif bind.startswith("point."):
            if re.search(r"(?:^|_)(?:run_fb|running_feedback)$", bind_tail):
                expected_suffix = "_RUN"
            elif re.search(r"(?:^|_)(?:flt|fault)$", bind_tail):
                expected_suffix = "_FLT"
            elif re.search(r"(?:^|_)(?:rem|remote)$", bind_tail):
                expected_suffix = "_REM"
        elif bind.startswith("parameter."):
            if re.search(r"(?:^|_)run_min$", bind_tail):
                expected_suffix = "_RUN_M"
            elif re.search(r"(?:^|_)stop_min$", bind_tail):
                expected_suffix = "_STP_M"
        fixed_host_names = {
            "point.downstream_output": "DOWN_OUT", "point.upstream_output": "UP_OUT",
            "command.line_start": "LINE_START", "command.line_stop": "LINE_STOP",
            "command.line_protect_stop": "LINE_PROTECT_STOP",
        }
        if host_case and fixed_host_names.get(bind) == name:
            expected_suffix = None
        if expected_suffix is not None and not name.endswith(expected_suffix):
            raise ValueError(
                f"北向字段 {name} 与 bind {bind} 的 HMI_SHORT_V1 "
                f"统一缩写不一致，应使用后缀 {expected_suffix}")
        if expected_name is not None and name != expected_name:
            raise ValueError(
                f"北向字段 {name} 与 bind {bind} 的 HMI_SHORT_V1 "
                f"统一缩写不一致，应使用 {expected_name}")
    return len(fields)


def validate_run_feedback_runtime_contract(project: dict) -> int:
    """按真实运行反馈核对声明式累计；仅到位反馈不等于运行反馈。"""
    points = project.get("points") or {}
    inputs = points.get("inputs", []) if isinstance(points, dict) else []
    counters = project.get("runtime_counters") or []
    fields = (project.get("northbound") or {}).get("fields") or []
    if not isinstance(inputs, list) or not isinstance(counters, list):
        raise ValueError("运行时间门禁要求 inputs/runtime_counters 列表")

    required: list[str] = []
    for item in inputs:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            continue
        name = item["name"]
        description = item.get("description") or ""
        if not isinstance(description, str):
            description = ""
        is_run_feedback = (
            re.search(r"(?:^|_)(?:run_fb|run_feedback|running_feedback)(?:_|$)",
                      name, re.IGNORECASE) is not None or
            "运行反馈" in description or "运行状态反馈" in description
        )
        if not is_run_feedback:
            continue
        if re.search(r"(?:^|_)(?:fault|lost|timeout|alarm)(?:_|$)",
                     name, re.IGNORECASE):
            continue
        required.append(name)

    for name in required:
        matches = [
            counter for counter in counters
            if (isinstance(counter, dict) and
                isinstance(counter.get("trigger"), dict) and
                counter["trigger"].get("bind") == f"point.{name}")
        ]
        if len(matches) != 1:
            raise ValueError(
                f"真实运行反馈 point.{name} 必须对应唯一 runtime_counters 累计")
        counter = matches[0]
        trigger = counter["trigger"]
        if (trigger.get("quality") != "good" or
                type(trigger.get("active_value")) is not bool):
            raise ValueError(
                f"point.{name} 的 runtime trigger 必须显式声明 BOOL active_value 和 quality: good")
        runtime_name = counter.get("name")
        seconds_bind = f"runtime.{runtime_name}.seconds"
        published = [
            field for field in fields
            if isinstance(field, dict) and field.get("bind") == seconds_bind
        ]
        if (not isinstance(runtime_name, str) or not runtime_name or
                len(published) != 1 or published[0].get("access") != "read" or
                published[0].get("c_type") != "u32"):
            raise ValueError(
                f"point.{name} 必须发布只读 u32 累计字段 -> {seconds_bind}")
    return len(required)


def validate_runtime_clear_contract(project: dict) -> int:
    """每个声明式累计都配独立可写清零；不证明持久化事务已经完成。"""
    counters = project.get("runtime_counters") or []
    fields = (project.get("northbound") or {}).get("fields") or []
    if not isinstance(counters, list) or not isinstance(fields, list):
        raise ValueError("累计清零门禁要求 runtime_counters/northbound.fields 列表")
    for counter in counters:
        if not isinstance(counter, dict) or not isinstance(counter.get("name"), str):
            raise ValueError("累计清零门禁要求有效 runtime name")
        clear_bind = f"runtime.{counter['name']}.clear"
        matches = [field for field in fields
                   if isinstance(field, dict) and field.get("bind") == clear_bind]
        if (len(matches) != 1 or matches[0].get("c_type") != "bool" or
                matches[0].get("access") != "read_write" or
                not str(matches[0].get("name", "")).endswith("_RT_CLR")):
            raise ValueError(f"{clear_bind} 必须有唯一可写 BOOL *_RT_CLR 本机累计清零命令")
    return len(counters)


def validate_device_reset_contract(project: dict) -> int:
    """检查声明逐设备复位的北向命令归属；实际清除行为仍由项目测试证明。"""
    northbound = project.get("northbound") or {}
    fields = northbound.get("fields") or []
    prefixes = {
        name[:-4]
        for field in fields
        if isinstance(field, dict) and isinstance(name := field.get("name"), str)
        and name.endswith("_F_L") and name != "SYS_F_L"
    }
    if not prefixes:
        raise ValueError("PER_DEVICE_FAULT_RESET 缺少逐设备 *_F_L 总故障")
    variables = project.get("application_variables") or {}
    commands = {
        item.get("name"): item for item in variables.get("commands") or []
        if isinstance(item, dict)
    }
    reset_binds: set[str] = set()
    for prefix in sorted(prefixes):
        reset_name = f"{prefix}_RST"
        matches = [field for field in fields
                   if isinstance(field, dict) and field.get("name") == reset_name]
        if len(matches) != 1:
            raise ValueError(f"设备 {prefix} 缺少独立北向复位字段 {reset_name}")
        field = matches[0]
        bind = field.get("bind")
        if (not isinstance(bind, str) or not bind.startswith("command.") or
                not bind.rsplit(".", 1)[-1].endswith("reset_faults")):
            raise ValueError(f"设备 {prefix} 的 {reset_name} 必须绑定独立故障复位命令")
        command_name = bind.removeprefix("command.")
        if (len(prefixes) > 1 and command_name == "reset_faults") or bind in reset_binds:
            raise ValueError(f"设备 {prefix} 的故障复位不能复用全局或他机命令 {bind}")
        reset_binds.add(bind)
        command = commands.get(command_name)
        if (command is None or command.get("c_type", "bool") != "bool" or
                command.get("behavior", "one_shot") != "one_shot" or
                field.get("c_type") != "bool" or field.get("access") != "read_write"):
            raise ValueError(f"设备 {prefix} 的 {reset_name} 必须是可写 one-shot BOOL 命令")
    return len(prefixes)


def validate_pid_tuning_contract(
        project: dict, logic_text: str, test_text: str) -> int:
    """检查 KZ3 自有 PID 的 KP/KI 北向整定链路。

    本门禁只证明“参数—北向—项目逻辑—测试入口”完整；稳定性和现场整定仍待 HIL。
    """
    pids = project.get("pids")
    if not isinstance(pids, list) or not pids:
        raise ValueError("PID_LOOP 缺少 project.pids 回路声明")

    variables = project.get("application_variables") or {}
    parameters = {
        item.get("name"): item
        for item in variables.get("parameters") or []
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }
    fields = (project.get("northbound") or {}).get("fields") or []
    gain_fields: dict[str, dict[str, dict]] = {"kp": {}, "ki": {}}
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get("name"), str):
            continue
        name = field["name"]
        gain = "kp" if name == "PID_KP" or name.endswith("_PID_KP") else None
        if gain is None and (name == "PID_KI" or name.endswith("_PID_KI")):
            gain = "ki"
        if gain is None:
            continue
        prefix = name.removesuffix(f"PID_{gain.upper()}")
        if prefix in gain_fields[gain]:
            raise ValueError(f"PID {gain.upper()} 北向前缀重复: {prefix or '<single>'}")
        gain_fields[gain][prefix] = field

    kp_prefixes = set(gain_fields["kp"])
    ki_prefixes = set(gain_fields["ki"])
    if kp_prefixes != ki_prefixes or len(kp_prefixes) != len(pids):
        raise ValueError(
            "每个 PID 回路必须有唯一且成对的 PID_KP/PID_KI 北向字段")

    parameter_binds: dict[str, str] = {}
    for prefix in sorted(kp_prefixes):
        for gain in ("kp", "ki"):
            field = gain_fields[gain][prefix]
            bind = field.get("bind")
            if (field.get("c_type") != "float" or
                    field.get("access") != "read_write" or
                    not isinstance(bind, str) or
                    not bind.startswith("parameter.")):
                raise ValueError(
                    f"{field.get('name')} 必须是绑定 application parameter 的 "
                    "float/read_write 字段")
            parameter_name = bind.removeprefix("parameter.")
            if parameter_name in parameter_binds:
                raise ValueError(f"PID 增益参数不得跨回路复用: {bind}")
            parameter_binds[parameter_name] = bind
            parameter = parameters.get(parameter_name)
            if parameter is None or parameter.get("c_type") != "float":
                raise ValueError(f"{bind} 缺少 float application parameter")
            if not all(
                    isinstance(parameter.get(key), (int, float)) and
                    not isinstance(parameter.get(key), bool) and
                    math.isfinite(parameter[key])
                    for key in ("default", "min", "max")):
                raise ValueError(f"{bind} 必须声明有限 default/min/max")
            if parameter["min"] > parameter["max"]:
                raise ValueError(f"{bind} 的 min 不得大于 max")
            if not parameter["min"] <= parameter["default"] <= parameter["max"]:
                raise ValueError(f"{bind} 的 default 必须位于 min/max 范围内")
            if not isinstance(parameter.get("persistent"), bool):
                raise ValueError(f"{bind} 必须显式声明 persistent 策略")

    stripped_logic = strip_c_comments(logic_text)
    if re.search(r"\.use_runtime_gains\s*=\s*true\s*;", stripped_logic) is None:
        raise ValueError("PID_LOOP 未启用 LogicPidInput.use_runtime_gains")
    for member in ("runtime_kp", "runtime_ki"):
        if re.search(rf"\.{member}\s*=", stripped_logic) is None:
            raise ValueError(f"PID_LOOP 未给 LogicPidInput.{member} 赋值")
    for parameter_name, bind in sorted(parameter_binds.items()):
        if re.search(rf"->\s*(?:param\s*\.\s*)?{re.escape(parameter_name)}\b",
                     stripped_logic) is None:
            raise ValueError(f"{bind} 未被项目逻辑实际读取")
        if bind not in test_text:
            raise ValueError(f"logic_project_test.c 未覆盖 PID 参数 {bind}")
    if "PLC_TEST: PID_TUNING" not in test_text:
        raise ValueError("logic_project_test.c 缺少 PLC_TEST: PID_TUNING")
    return len(pids)


def validate_strict_quality(
        project_dir: Path, project: dict,
        require_engineering_review: bool = False) -> dict[str, int]:
    logic_text = (project_dir / "logic.c").read_text(encoding="utf-8")
    readme_text = (project_dir / "README.md").read_text(encoding="utf-8")
    test_text = (project_dir / "logic_project_test.c").read_text(encoding="utf-8")
    contract = validate_requirements_contract(
        readme_text, require_frozen=True,
        require_engineering_review=require_engineering_review)
    if contract.get("project_id") != project.get("id"):
        raise ValueError("冻结需求 project_id 与 project_io.yaml project.id 不一致")
    entrypoints = set(LOGIC_ENTRYPOINT_PATTERN.findall(logic_text))
    required_entrypoints = {"Logic_Init", "Logic_Scan", "Logic_Stop"}
    if entrypoints != required_entrypoints:
        missing = sorted(required_entrypoints - entrypoints)
        raise ValueError("严格质量门禁缺少逻辑入口: " + ", ".join(missing))
    if UNBOUNDED_LOOP_PATTERN.search(strip_c_comments(logic_text)):
        raise ValueError("严格质量门禁禁止 while(true)/while(1)/for(;;) 无界循环")

    points = project.get("points")
    outputs = points.get("outputs") if isinstance(points, dict) else None
    if not isinstance(outputs, list):
        raise ValueError("严格质量门禁要求 project.points.outputs 列表")
    output_names = {
        item.get("name") for item in outputs
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }
    write_counts: dict[str, int] = {}
    for name in IO_OUT_PATTERN.findall(logic_text):
        write_counts[name] = write_counts.get(name, 0) + 1
    unknown_outputs = sorted(set(write_counts) - output_names)
    if unknown_outputs:
        raise ValueError("logic.c 写入未声明输出: " + ", ".join(unknown_outputs))
    for name in sorted(output_names):
        count = write_counts.get(name, 0)
        if count == 0:
            raise ValueError(f"输出 {name} 没有 IO_OUT 确定性赋值")
        if count > QUALITY_LIMITS["max_output_write_sites"]:
            raise ValueError(
                f"输出 {name} 有 {count} 个 IO_OUT 写点，超过上限 "
                f"{QUALITY_LIMITS['max_output_write_sites']}")

    application_variables = project.get("application_variables")
    commands = (application_variables.get("commands")
                if isinstance(application_variables, dict) else None)
    command_names = {
        item.get("name") for item in commands or []
        if isinstance(item, dict)
    }
    host_sequence_without_faults = (
        contract.get("delivery_scope") == "host_simulation" and
        contract.get("case_id") == "two-device-output-sequence" and
        command_names == {"line_start", "line_stop", "line_protect_stop"} and
        not project.get("runtime_counters") and
        not (contract.get("engineering_review") or {}).get("control_features")
    )
    if outputs and not host_sequence_without_faults and not any(isinstance(name, str) and name.endswith("reset_faults")
               for name in command_names):
        raise ValueError("严格质量门禁要求设备故障复位 one-shot")
    if "标准与符合性" not in readme_text or "KZ3 PLC_STYLE_V1" not in readme_text:
        raise ValueError("README 缺少“标准与符合性”及 KZ3 PLC_STYLE_V1 声明")

    metrics = calculate_logic_metrics(logic_text)
    for metric_name in ("effective_lines", "decision_points", "max_brace_depth"):
        if metrics[metric_name] > QUALITY_LIMITS[metric_name]:
            raise ValueError(
                f"严格质量指标 {metric_name}={metrics[metric_name]} 超过上限 "
                f"{QUALITY_LIMITS[metric_name]}")
    metrics.update(validate_function_quality(logic_text))
    metrics.update(validate_test_contract(
        project, logic_text, readme_text, test_text, contract))
    metrics["northbound_fields"] = validate_northbound_contract(project, host_case=host_sequence_without_faults)
    metrics["run_feedback_runtime_count"] = validate_run_feedback_runtime_contract(project)
    metrics["runtime_clear_count"] = validate_runtime_clear_contract(project)
    features = (contract.get("engineering_review") or {}).get("control_features") or []
    if "PER_DEVICE_FAULT_RESET" in features:
        metrics["device_reset_count"] = validate_device_reset_contract(project)
    if "PID_LOOP" in features:
        metrics["pid_tuning_count"] = validate_pid_tuning_contract(
            project, logic_text, test_text)
    metrics["max_output_write_sites"] = max(write_counts.values(), default=0)
    return metrics


def validate_project_location(project_dir: Path, projects_root: Path) -> None:
    """只接受 application/projects 内的项目叶子目录，允许归档分组层级。"""
    try:
        relative = project_dir.relative_to(projects_root)
    except ValueError as error:
        raise ValueError(
            "目标必须是 application/projects 内的项目叶子目录"
        ) from error
    if not relative.parts:
        raise ValueError("目标不能是 application/projects 根目录")


def validate_execution_evidence(path: Path, declared: set[str]) -> dict[str, int]:
    if not path.is_file():
        raise ValueError("没有真实测试执行记录：测试可能提前退出或未执行场景")
    observed: set[str] = set()
    checks = scans = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) != 3 or SCENARIO_ID_PATTERN.fullmatch(parts[0]) is None:
            raise ValueError("非法测试执行记录")
        scenario, assertions, steps = parts
        if scenario not in declared or int(assertions) <= 0 or int(steps) <= 0:
            raise ValueError(f"未声明或未真正验证的场景: {scenario}")
        observed.add(scenario)
        checks += int(assertions)
        scans += int(steps)
    if declared - observed:
        raise ValueError("未执行的需求场景: " + ", ".join(sorted(declared - observed)))
    return {"executed_scenarios": len(observed), "executed_assertions": checks,
            "successful_manager_steps": scans}


def validate_flat_record_layout(text: str) -> int:
    """新项目排版契约：用 YAML 节点位置检查，不靠正则猜嵌套关系。"""
    document = yaml.compose(text)

    def child(node, key):
        if isinstance(node, yaml.MappingNode):
            for name, value in node.value:
                if name.value == key:
                    return value
        return None

    project = child(document, "project")
    if not isinstance(project, yaml.MappingNode) or project.flow_style:
        raise ValueError("新项目 YAML project 必须使用块式 mapping，不能把整个项目压成一行")
    paths = [("points", "inputs"), ("points", "outputs"), ("northbound", "fields")]
    paths += [("application_variables", key) for key in
              ("parameters", "commands", "states", "external_inputs")]
    count = 0
    for parent, key in paths:
        sequence = child(child(project, parent), key)
        if sequence is None:
            continue
        if not isinstance(sequence, yaml.SequenceNode):
            raise ValueError(f"{parent}.{key} 必须为列表")
        if sequence.value and sequence.flow_style:
            raise ValueError(f"{parent}.{key} 必须每条记录独占一行，不能把整个列表压成一行")
        for item in sequence.value:
            if (not isinstance(item, yaml.MappingNode) or not item.flow_style or
                    item.start_mark.line != item.end_mark.line):
                raise ValueError(f"{parent}.{key}:{item.start_mark.line + 1} 必须一条记录一行 - {{…}}")
            count += 1
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_dir", type=Path, nargs="?",
                        help="application/projects 内的项目叶子目录（可含分组层级）")
    parser.add_argument(
        "--requirements-file", type=Path,
        help="独立检查需求 Markdown 文件，无需 KZ3 工程；不生成或编译代码",
    )
    parser.add_argument(
        "--strict-quality", action="store_true",
        help="执行 KZ3 PLC_STYLE_V1 与 HMI_SHORT_V1 严格质量门禁",
    )
    parser.add_argument(
        "--requirements-only", action="store_true",
        help="只检查 README 中的 kz3-requirements/v1 需求契约",
    )
    parser.add_argument(
        "--require-frozen", action="store_true",
        help="与 --requirements-only 或 --requirements-file 联用，要求需求已冻结",
    )
    parser.add_argument(
        "--require-engineering-review", action="store_true",
        help="要求 TABLE_CONTROL_V1 工程决策和边界场景追溯（新项目必选）",
    )
    parser.add_argument(
        "--require-execution-evidence", action="store_true",
        help="新项目必选：要求 PLC_EXECUTED_V1，每个声明场景均有实际断言和真实管理器扫描",
    )
    parser.add_argument(
        "--test-timeout-s", type=int, default=120,
        help="单个项目测试的墙钟超时秒数（默认 120），超时报告失败而非无限等待",
    )
    arguments = parser.parse_args()

    try:
        if arguments.require_execution_evidence and not arguments.strict_quality:
            raise ValueError("--require-execution-evidence 必须与 --strict-quality 联用")
        if arguments.test_timeout_s <= 0:
            raise ValueError("--test-timeout-s 必须为正整数")
        if arguments.strict_quality and arguments.requirements_only:
            raise ValueError("--strict-quality 不能与 --requirements-only 联用，避免静默跳过代码验证")
        if arguments.requirements_file is not None:
            if arguments.project_dir is not None or arguments.strict_quality:
                raise ValueError("--requirements-file 不能与项目目录或 --strict-quality 联用")
            contract = validate_requirements_contract(
                arguments.requirements_file.read_text(encoding="utf-8"),
                require_frozen=arguments.require_frozen,
                require_engineering_review=arguments.require_engineering_review,
            )
            print("KZ3 独立需求契约验证通过: "
                  f"{contract.get('project_id')} ({contract.get('status')})")
            print("验证范围: document-only；未检查目标工程适配、代码或硬件")
            return 0
        if arguments.project_dir is None:
            raise ValueError("请提供项目目录或 --requirements-file <需求文件>")
        project_dir = arguments.project_dir.resolve()
        root = find_root(project_dir)
        projects_root = (root / "application" / "projects").resolve()
        validate_project_location(project_dir, projects_root)
        if arguments.require_frozen and not arguments.requirements_only:
            raise ValueError("--require-frozen 必须与 --requirements-only 联用")
        if (arguments.require_engineering_review and
                not (arguments.requirements_only or arguments.strict_quality)):
            raise ValueError("--require-engineering-review 必须与需求或严格检查联用")
        if arguments.requirements_only:
            readme_path = project_dir / "README.md"
            if not readme_path.is_file():
                raise ValueError("需求检查要求项目目录包含 README.md")
            contract = validate_requirements_contract(
                readme_path.read_text(encoding="utf-8"),
                require_frozen=arguments.require_frozen,
                require_engineering_review=arguments.require_engineering_review,
            )
            print(
                "KZ3 需求契约验证通过: "
                f"{contract.get('project_id')} ({contract.get('status')})")
            return 0
        project = validate_sources(project_dir)
        metrics = None
        if arguments.strict_quality:
            metrics = validate_strict_quality(
                project_dir, project,
                require_engineering_review=arguments.require_engineering_review)

        readme_text = (project_dir / "README.md").read_text(encoding="utf-8")
        # 旧版基础验证允许没有需求契约；只有严格模式或主动声明执行证据才加载。
        contract = {}
        if arguments.strict_quality or "execution_profile:" in readme_text:
            contract = validate_requirements_contract(
                readme_text, require_frozen=arguments.strict_quality)
        execution_profile = contract.get("verification", {}).get("execution_profile")
        if execution_profile not in (None, "PLC_EXECUTED_V1"):
            raise ValueError("未知 execution_profile")
        if arguments.require_execution_evidence and execution_profile != "PLC_EXECUTED_V1":
            raise ValueError("新项目必须声明 verification.execution_profile: PLC_EXECUTED_V1")
        execution_required = execution_profile == "PLC_EXECUTED_V1"
        if execution_required:
            validate_flat_record_layout((project_dir / "project_io.yaml").read_text(encoding="utf-8"))

        with tempfile.TemporaryDirectory(prefix="stm32-logic-verify-") as temporary:
            stage = Path(temporary)
            generated = stage / "generated"
            executable = stage / "logic_project_test"
            evidence_file = stage / "executed_scenarios.txt"
            shutil.copytree(root / "application" / "io_definitions",
                            stage / "io_definitions")
            shutil.copyfile(project_dir / "project_io.yaml",
                            stage / "project_io.yaml")

            run([
                sys.executable, str(root / "tools" / "point_config_gen.py"),
                str(stage / "project_io.yaml"), "--output-dir", str(generated),
            ], root)
            include_flags = [
                "-I", str(generated),
                "-I", str(root / "application"),
                "-I", str(root / "User" / "Inc"),
                "-I", str(root / "tests"),
            ]
            project_sources = [
                project_dir / "logic_project_test.c",
                project_dir / "logic.c",
                generated / "point_config.c",
            ]
            platform_sources = [
                root / "User" / "Src" / "data_manager.c",
                root / "User" / "Src" / "logic_manager.c",
                root / "User" / "Src" / "logic_parameter_store.c",
                root / "User" / "Src" / "logic_runtime_store.c",
                root / "tests" / "eeprom_transport_fake.c",
            ]
            objects: list[Path] = []
            for index, source in enumerate(project_sources):
                object_path = stage / f"project_{index}.o"
                evidence_flags = []
                if execution_required and index == 0:
                    evidence_flags = ["-include", str(Path(__file__).resolve().parents[1] /
                                                    "assets" / "plc_test_evidence.h")]
                run([
                    "cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                    "-c", str(source), *include_flags, *evidence_flags, "-o", str(object_path),
                ], root)
                objects.append(object_path)
            for index, source in enumerate(platform_sources):
                object_path = stage / f"platform_{index}.o"
                # 某些项目生成 0 个 runtime 描述符，平台中只服务 runtime 的
                # static helper 会因此未引用；只对平台源关闭这一配置相关告警。
                run([
                    "cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                    "-Wno-unused-function", "-c", str(source), *include_flags,
                    "-o", str(object_path),
                ], root)
                objects.append(object_path)
            run(["cc", *(str(path) for path in objects),
                 "-o", str(executable)], root)
            run([str(executable)], root, timeout_s=arguments.test_timeout_s,
                env={**os.environ, "KZ3_PLC_EVIDENCE_FILE": str(evidence_file)})
            if execution_required:
                execution = validate_execution_evidence(
                    evidence_file, set(contract["verification"]["required_scenarios"]))
                print("PLC_EXECUTED_V1: PASS (host-only); " +
                      "; ".join(f"{key}={value}" for key, value in execution.items()))

        print(f"STM32-Logic 项目验证通过: {project.get('id')}")
        if metrics is not None:
            print(
                "KZ3 PLC_STYLE_V1: PASS (host-only); "
                "HMI_SHORT_V1: PASS; "
                f"有效逻辑行={metrics['effective_lines']}; "
                f"决策点代理={metrics['decision_points']}; "
                f"最大嵌套={metrics['max_brace_depth']}; "
                f"单函数最大行数={metrics['max_function_lines']}; "
                f"单函数最大决策点={metrics['max_function_decisions']}; "
                f"单函数最大参数数={metrics['max_function_parameters']}; "
                f"单输出最大写点={metrics['max_output_write_sites']}; "
                f"北向字段={metrics['northbound_fields']}; "
                f"静态断言位置={metrics['test_assertions']}; "
                f"静态场景标签={metrics['test_scenarios']}")
        print("验证范围: host-only；HIL 与现场验证未执行")
        return 0
    except (OSError, ValueError, RuntimeError, TypeError, yaml.YAMLError) as error:
        print(f"STM32-Logic 项目验证失败: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
