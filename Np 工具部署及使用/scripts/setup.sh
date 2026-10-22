#!/bin/bash
# 安装 OpenCode，加载 DeepSeek 配置，并以当前终端环境启动 NP-Tools。
set -euo pipefail
cd "$(dirname "$0")/.."
PACKAGE_DIR="$PWD"
APP="${NP_TOOLS_APP:-}"
PORT="${OPENCODE_PORT:-4096}"
fail() { echo "$*" >&2; exit 1; }
if [ ! -f opencode.json ] && [ -f opencode.example.json ]; then
    cp opencode.example.json opencode.json
fi
[ -f opencode.json ] || fail "交付目录缺少 opencode.json，请保持配置文件与 scripts 目录在同一层。"

# DMG 需要手动拖入“应用程序”；也支持用户目录或显式指定的 .app。
if [ -z "$APP" ]; then
    for candidate in /Applications/NP-Tools.app "$HOME/Applications/NP-Tools.app"; do
        if [ -f "$candidate/Contents/Resources/resources/engineering/engineering.py" ]; then
            APP="$candidate"
            break
        fi
    done
fi
[ -n "$APP" ] || fail "未在 /Applications 或 ~/Applications 找到含 AI 案例的 NP-Tools。请把新版 .app 拖入应用程序，或用 NP_TOOLS_APP 指定完整路径。"
[ -f "$APP/Contents/Info.plist" ] || fail "不是完整的应用包：$APP"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")
[ "$BUNDLE_ID" = com.nptools.desktop ] || fail "指定的应用不是 NP-Tools：$APP"
EXECUTABLE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")
[ -x "$APP/Contents/MacOS/$EXECUTABLE" ] || fail "应用可执行文件缺失或不可执行：$APP"
[ -f "$APP/Contents/Resources/resources/engineering/engineering.py" ] || fail "找到的 NP-Tools 缺少 AI 案例资源，请更换包含 AI 辅助工作台的安装包：$APP"
echo "使用 NP-Tools：$APP"

# NP-Tools 的工程生成和本机仿真会调用 Python、PyYAML 和 C 编译器。
if [ -x .venv/bin/python3 ]; then export PATH="$PACKAGE_DIR/.venv/bin:$PATH"; fi
command -v npm >/dev/null || fail "请先安装 Node.js/npm。"
command -v python3 >/dev/null || fail "请安装 Python 3.9 或更新版本。"
python3 -c 'import sys; assert sys.version_info >= (3, 9)' || fail "需要 Python 3.9 或更新版本，不要求固定为 3.9。"
if ! python3 -c 'import yaml; assert yaml.__version__ == "6.0.3"' 2>/dev/null; then
    fail "请先安装 PyYAML，再运行脚本：
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install PyYAML==6.0.3"
fi
cc --version >/dev/null 2>&1 || fail "请安装 Apple 编译工具：xcode-select --install"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "端口 $PORT 已占用。请停止原服务，或设置 OPENCODE_PORT=4097 后重试。"
fi

# 使用 npm 安装已验证版本；已有相同版本则直接复用。
if ! command -v opencode >/dev/null || [ "$(opencode --version)" != "1.19.2" ]; then
    npm install -g opencode-ai@1.19.2
fi

# 已在配置文件中填 Key 时直接使用；环境变量模板才读取 .env 或询问 Key。
KEY_SOURCE=$(python3 - <<'PY'
import json
import sys

try:
    with open('opencode.json', encoding='utf-8') as stream:
        key = json.load(stream)['provider']['deepseek']['options']['apiKey']
except (OSError, UnicodeError, ValueError, KeyError, TypeError):
    sys.exit('无法读取 DeepSeek Key 配置，请检查 opencode.json 的 JSON 格式和 provider.deepseek.options.apiKey。')
if not isinstance(key, str) or not key.strip():
    sys.exit('请在 opencode.json 中填写 DeepSeek Key，或将 apiKey 设置为 {env:DEEPSEEK_API_KEY}。')
print('env' if key == '{env:DEEPSEEK_API_KEY}' else 'config')
PY
) || fail "DeepSeek 配置检查失败。"
if [ "$KEY_SOURCE" = config ]; then
    echo "使用 opencode.json 中已配置的 DeepSeek Key，无需再次输入。"
else
    if [ -z "${DEEPSEEK_API_KEY:-}" ] && [ -f .env ]; then source .env; fi
    if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
        read -r -s -p "请输入 DeepSeek API Key：" DEEPSEEK_API_KEY
        echo
        [ -n "$DEEPSEEK_API_KEY" ] || fail "API Key 不能为空。"
        (umask 077; printf 'export DEEPSEEK_API_KEY=%q\n' "$DEEPSEEK_API_KEY" > .env)
    fi
    export DEEPSEEK_API_KEY
fi
export OPENCODE_CONFIG="$PACKAGE_DIR/opencode.json"

# 直接运行应用可继承终端的 PATH 和 Python 环境。
"$APP/Contents/MacOS/$EXECUTABLE" &
echo "NP-Tools 连接地址：http://127.0.0.1:${PORT}；模型：deepseek/deepseek-flash"
echo "请保持此终端开启，按 Ctrl+C 停止 OpenCode。"
exec opencode serve --pure --hostname 127.0.0.1 --port "$PORT"
