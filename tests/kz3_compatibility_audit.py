"""把仓库项目交给真实工具模块往返，记录丢字段/改值和跨语言 manifest 差异。"""
import argparse
import collections
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--firmware-root', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
ROOT = args.firmware_root.resolve()
OUT = args.output_dir.resolve()
OUT.mkdir(parents=True, exist_ok=True)
TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sdk/generators"))
from point_config_gen import _point_manifest, generate


def changes(before, after, location=""):
    if isinstance(before, dict) and isinstance(after, dict):
        for key, value in before.items():
            child = f"{location}.{key}" if location else key
            if key not in after:
                yield {"path": child, "kind": "removed", "before": value}
            else:
                yield from changes(value, after[key], child)
    elif isinstance(before, list) and isinstance(after, list):
        # point 排序不构成删除；按稳定名称核对，北向顺序由独立 manifest 检查。
        if before and all(isinstance(v, dict) and "name" in v for v in before + after):
            after_by_name = {v["name"]: v for v in after}
            for value in before:
                child = f"{location}[{value['name']}]"
                if value["name"] not in after_by_name:
                    yield {"path": child, "kind": "removed", "before": value}
                else:
                    yield from changes(value, after_by_name[value["name"]], child)
        elif before != after:
            yield {"path": location, "kind": "changed", "before": before, "after": after}
    elif before != after:
        yield {"path": location, "kind": "changed", "before": before, "after": after}


inputs = []
for file in sorted((ROOT / "projects").rglob("project_io.yaml")):
    raw = yaml.safe_load(file.read_text())
    inputs.append({"path": str(file.relative_to(ROOT)), "yaml": file.read_text(),
                   "manifestHash": _point_manifest(raw["project"])[1]})
for kind in ("i32", "s32", "f32"):
    raw = yaml.safe_load(inputs[0]["yaml"])
    raw["project"]["northbound"]["fields"] = [
        {"name": "state.probe", "bind": "state.probe", "c_type": kind,
         "access": "read", "reference": "30001"}]
    inputs.append({"path": f"probe/{kind}", "yaml": yaml.safe_dump(raw),
                   "manifestHash": _point_manifest(raw["project"])[1]})
(OUT / "inputs.json").write_text(json.dumps(inputs, ensure_ascii=False, indent=2) + "\n")
subprocess.run(["node", str(TOOL / "tests/kz3CompatibilityAudit.mjs"), str(TOOL), str(OUT / "inputs.json"),
                str(OUT / "tool-results.json")], check=True)
results = json.loads((OUT / "tool-results.json").read_text())
for result in results:
    if "exportedYaml" not in result:
        continue
    source = yaml.safe_load(next(i["yaml"] for i in inputs if i["path"] == result["path"]))
    exported = yaml.safe_load(result.pop("exportedYaml"))
    result["semanticChanges"] = list(changes(source, exported))
    result["exportedManifestMatches"] = _point_manifest(exported["project"])[1] == result["firmwareManifest"]
    result["frontendErrors"] = sum(i["severity"] == "error" for i in result["issues"])
    if not result["path"].startswith("probe/"):
        # 与独立构建一样在隔离目录绑定当前 SDK 硬件定义，不改工程源/活动副本。
        with tempfile.TemporaryDirectory(prefix="kz3-tool-audit-") as temporary:
            workspace = Path(temporary)
            (workspace / "io_definitions").symlink_to(ROOT / "sdk/definitions", target_is_directory=True)
            config = workspace / "project_io.yaml"
            for name, model in (("original", source), ("exported", exported)):
                config.write_text(yaml.safe_dump(model, allow_unicode=True, sort_keys=False))
                try:
                    generate(config, workspace / name)
                    result[name + "Generation"] = {"passed": True}
                except (ValueError, KeyError, TypeError, OSError) as error:
                    result[name + "Generation"] = {"passed": False, "error": str(error)}
probes = [r for r in results if r["path"].startswith("probe/")]
results = [r for r in results if not r["path"].startswith("probe/")]
summary = {
    "firmwareCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "npToolsCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=TOOL, text=True).strip(),
    "projects": len(results),
    "manifestMatched": sum(r.get("manifestMatches", False) for r in results),
    "manifestMismatchProjects": [r["path"] for r in results if not r.get("manifestMatches", False)],
    "roundtripChangedProjects": sum(bool(r.get("semanticChanges")) for r in results),
    "nonCosmeticChangedProjects": sum(any(
        not (c["path"].endswith(".persistent") and c.get("before") is False)
        and not c["path"].endswith("required_profiles")
        for c in r.get("semanticChanges", [])) for r in results),
    "changedPaths": dict(collections.Counter(c["path"] for r in results for c in r.get("semanticChanges", []))),
    "frontendRejectedProjects": sum(r.get("frontendErrors", 0) > 0 for r in results),
    "typeProbes": [{k: r.get(k) for k in ("path", "manifestMatches", "manifestError")} for r in probes],
    "originalGenerationPassed": sum(r.get("originalGeneration", {}).get("passed", False) for r in results),
    "exportedGenerationPassed": sum(r.get("exportedGeneration", {}).get("passed", False) for r in results),
}
(OUT / "project-audit.json").write_text(json.dumps({"summary": summary, "projects": results, "probes": probes}, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(summary, ensure_ascii=False, indent=2))

if (summary['originalGenerationPassed'] != summary['projects'] or
        summary['exportedGenerationPassed'] != summary['projects'] or
        summary['manifestMatched'] != summary['projects'] or
        summary['nonCosmeticChangedProjects'] != 0 or
        not all(r['manifestMatches'] for r in summary['typeProbes'])):
    raise SystemExit('兼容性审计失败，查看project-audit.json')
