#!/usr/bin/env python3
"""校核智能体提取的物理点事实；不推断工艺、接线或冻结状态。仅使用标准库。"""
import argparse
import json
import math
from pathlib import Path


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def audit(data):
    errors, gaps, matches = [], [], []
    if not isinstance(data, dict):
        return {"errors": ["顶层必须是对象"], "gaps": [], "matches": []}
    points, requirements = data.get("points"), data.get("requirements")
    if not isinstance(points, list) or not isinstance(requirements, list):
        return {"errors": ["points/requirements 必须是数组"], "gaps": [], "matches": []}
    ids, sources, usable = set(), {}, []
    if not requirements:
        gaps.append("尚未提取需求能力，不能判定点位是否满足要求")
    for index, point in enumerate(points):
        label = f"points[{index}]"
        if not isinstance(point, dict):
            errors.append(f"{label}: 必须是对象")
            continue
        valid = True
        for key in ("id", "device", "role", "description", "evidence"):
            if not isinstance(point.get(key), str) or not point[key].strip():
                errors.append(f"{label}: 缺少非空 {key}")
                valid = False
        if not valid:
            continue
        pid = point["id"]
        if pid in ids:
            errors.append(f"{pid}: 点名重复")
        ids.add(pid)
        kind = point.get("kind")
        dtype = point.get("data_type")
        if kind not in ("DI", "DO", "AI", "AO"):
            errors.append(f"{pid}: kind 必须是 DI/DO/AI/AO")
        elif dtype is not None and dtype not in (("bool",) if kind in ("DI", "DO") else ("float", "int", "uint")):
            errors.append(f"{pid}: I/O 类型与数据类型不一致")
        source = point.get("physical_source")
        if source is not None:
            if not isinstance(source, str) or not source.strip():
                errors.append(f"{pid}: 未绑定请使用 null，绑定须为非空完整来源")
            elif source in sources:
                errors.append(f"{pid}: 物理来源与 {sources[source]} 重复: {source}")
            else:
                sources[source] = pid
        wired = point.get("wired")
        if wired is not None and type(wired) is not bool:
            errors.append(f"{pid}: wired 必须是 true/false/null")
        bounds = point.get("range")
        if bounds is not None and (not isinstance(bounds, list) or len(bounds) != 2 or
                                   not all(number(v) for v in bounds) or bounds[0] >= bounds[1]):
            errors.append(f"{pid}: range 必须为有限且递增的数值对")
            bounds = None
        if "safe_value" in point and point["safe_value"] is not None:
            safe = point["safe_value"]
            if kind == "DO" and type(safe) is not bool:
                errors.append(f"{pid}: DO safe_value 必须是布尔值")
            if kind == "AO":
                if not number(safe):
                    errors.append(f"{pid}: AO safe_value 必须是有限数值")
                elif bounds is not None and not bounds[0] <= safe <= bounds[1]:
                    errors.append(f"{pid}: AO safe_value 超范围")
        usable.append(point)
    req_ids = set()
    for index, req in enumerate(requirements):
        if not isinstance(req, dict) or any(not isinstance(req.get(k), str) or not req[k].strip()
                                              for k in ("id", "device", "role", "kind", "evidence")):
            errors.append(f"requirements[{index}]: 缺少 id/device/role/kind/evidence")
            continue
        rid = req["id"]
        if rid in req_ids:
            errors.append(f"{rid}: 需求 ID 重复")
        req_ids.add(rid)
        if req["kind"] not in ("DI", "DO", "AI", "AO"):
            errors.append(f"{rid}: kind 不合法")
            continue
        candidates = [x for x in usable if all(x.get(k) == req[k] for k in ("device", "role", "kind"))
                      and x.get("wired") is not False]
        if len(candidates) != 1:
            gaps.append(f"{rid}: 有效角色候选数量为 {len(candidates)}，需要明确唯一映射")
            continue
        point = candidates[0]
        missing = [k for k in ("physical_source", "data_type", "wired") if point.get(k) is None]
        if point["kind"] in ("AI", "AO"):
            missing += [k for k in ("unit", "range") if not point.get(k)]
        if point["kind"] in ("DO", "AO") and point.get("safe_value") is None:
            missing.append("safe_value")
        if missing:
            gaps.append(f"{rid}/{point['id']}: 待补 {', '.join(missing)}")
        matches.append({"requirement": rid, "point": point["id"], "binding_complete": not missing})
    return {"errors": errors, "gaps": gaps, "matches": matches,
            "scope": "仅已提取事实的结构校核，不构成工程语义或现场验收"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        result = audit(data)
    except (OSError, ValueError) as error:
        result = {"errors": [str(error)], "gaps": [], "matches": []}
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 1 if result["errors"] else 2 if result["gaps"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
