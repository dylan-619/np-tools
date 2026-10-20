#!/usr/bin/env python3
"""检查 KZ3 主机生成依赖的文件可用性；不执行构建或更改工作区。"""
import argparse
import json
from pathlib import Path

REQUIRED = (
    "AGENTS.md", "application/logic.h", "User/Inc/logic_block_api.h",
    "tools/point_config_gen.py", "application/io_definitions/board_kz3_f427_standard.yaml",
    "application/case_center/standard_templates/catalog.yaml",
    "User/Src/data_manager.c", "User/Src/logic_manager.c",
    "User/Src/logic_parameter_store.c", "User/Src/logic_runtime_store.c",
    "tests/eeprom_transport_fake.c",
)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    root = args.workspace.resolve()
    missing = [name for name in REQUIRED if not (root / name).is_file()]
    print(json.dumps({"workspace": str(root), "missing": missing,
                      "status": "DEPENDENCIES_MISSING" if missing else "FILES_PRESENT",
                      "note": "尚需核对目标版本、Profile、API/schema、编译环境和项目证据"}, ensure_ascii=False, indent=2))
    return 2 if missing else 0

if __name__ == "__main__":
    raise SystemExit(main())
