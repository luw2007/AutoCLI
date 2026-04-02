#!/bin/bash

set -euo pipefail

OPENCLI_PATH="$(cd "$(dirname "$0")" && pwd)"
cd "${OPENCLI_PATH}"

CDP_HOST="${OPENCLI_CDP_HOST:-localhost}"
CDP_PORT="${OPENCLI_CDP_PORT:-9222}"
CDP_BASE="http://${CDP_HOST}:${CDP_PORT}"
BIN="${OPENCLI_PATH}/target/debug/opencli-rs"
STATE_FILE="${TMPDIR:-/tmp}/opencli-cdp-endpoint"

list_pages() {
    curl -sf "${CDP_BASE}/json/list" | jq -r '
        to_entries[]
        | select(.value.type == "page")
        | "\(.key)\t\(.value.id)\t\(.value.title)\t\(.value.url)\t\(.value.type)"
    '
}

resolve_page_id() {
    local val="$1"
    if [[ "$val" =~ ^[0-9]+$ ]]; then
        local pages
        pages=$(list_pages 2>/dev/null) || {
            echo "❌ 无法连接 CDP (${CDP_BASE})" >&2
            exit 1
        }
        local line
        line=$(echo "$pages" | sed -n "${val}p")
        if [ -z "$line" ]; then
            echo "❌ 无效 page 编号: $val" >&2
            exit 1
        fi
        echo "$line" | cut -f2
    else
        echo "$val"
    fi
}

auto_detect_endpoint() {
    if [ -n "${OPENCLI_CDP_ENDPOINT:-}" ]; then
        return 0
    fi

    if [ -n "${PAGE_IDX:-}" ]; then
        local pid
        pid=$(resolve_page_id "$PAGE_IDX")
        export OPENCLI_CDP_ENDPOINT="ws://${CDP_HOST}:${CDP_PORT}/devtools/page/${pid}"
        return 0
    fi

    if [ -f "$STATE_FILE" ]; then
        local saved
        saved=$(cat "$STATE_FILE")
        if [ -n "$saved" ]; then
            export OPENCLI_CDP_ENDPOINT="$saved"
            return 0
        fi
    fi

    local pages
    pages=$(list_pages 2>/dev/null) || {
        echo "❌ 无法连接 CDP (${CDP_BASE})" >&2
        exit 1
    }

    local count
    count=$(echo "$pages" | grep -c . || true)

    if [ "$count" -eq 0 ]; then
        echo "❌ 未发现任何 Trae page" >&2
        exit 1
    fi

    local page_id
    if [ "$count" -eq 1 ]; then
        page_id=$(echo "$pages" | cut -f2)
    else
        echo "🔍 发现 ${count} 个 Trae 窗口:" >&2
        echo "$pages" | awk -F'\t' '{ printf "  [%d] %s  (%s)\n", NR, $3, substr($2,1,8) "..." }' >&2
        local first_id first_title
        first_id=$(echo "$pages" | head -1 | cut -f2)
        first_title=$(echo "$pages" | head -1 | cut -f3)
        echo "  → 自动选择 [1] ${first_title}" >&2
        echo "  💡 用 '$0 pages' 查看全部，'$0 use <编号>' 切换" >&2
        page_id="$first_id"
    fi

    export OPENCLI_CDP_ENDPOINT="ws://${CDP_HOST}:${CDP_PORT}/devtools/page/${page_id}"
    echo "$OPENCLI_CDP_ENDPOINT" > "$STATE_FILE"
}

PAGE_IDX=""
OUTPUT_FORMAT="table"
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --page=*) PAGE_IDX="${arg#--page=}" ;;
        --format=*|-f=*) OUTPUT_FORMAT="${arg#*=}" ;;
        -f) OUTPUT_FORMAT="__next__" ;;
        *)
            if [ "$OUTPUT_FORMAT" = "__next__" ]; then
                OUTPUT_FORMAT="$arg"
            else
                ARGS+=("$arg")
            fi
            ;;
    esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

cmd="${1:-}"

case "$cmd" in
    pages)
        all_pages=$(list_pages 2>/dev/null) || {
            echo "❌ 无法连接 CDP (${CDP_BASE})" >&2
            exit 1
        }
        active_id=""
        if [ -f "$STATE_FILE" ]; then
            active_id=$(cat "$STATE_FILE" | grep -oE '[^/]+$')
        fi
        case "$OUTPUT_FORMAT" in
            json)
                echo "$all_pages" | awk -F'\t' -v active="$active_id" 'BEGIN{printf "["} NR>1{printf ","} {
                    gsub(/"/, "\\\"", $3);
                    gsub(/"/, "\\\"", $4);
                    active_flag = ($2 == active) ? "true" : "false";
                    printf "{\"index\":%d,\"id\":\"%s\",\"title\":\"%s\",\"url\":\"%s\",\"type\":\"%s\",\"active\":%s}", NR, $2, $3, $4, $5, active_flag
                } END{printf "]\n"}'
                ;;
            csv)
                echo "Index,Id,Title,Url,Type,Active"
                echo "$all_pages" | awk -F'\t' -v active="$active_id" '{
                    gsub(/"/, "\"\"", $3);
                    gsub(/"/, "\"\"", $4);
                    active_flag = ($2 == active) ? "true" : "false";
                    printf "%d,\"%s\",\"%s\",\"%s\",\"%s\",%s\n", NR, $2, $3, $4, $5, active_flag
                }'
                ;;
            yaml)
                echo "$all_pages" | awk -F'\t' -v active="$active_id" '{
                    active_flag = ($2 == active) ? "true" : "false";
                    printf "- index: %d\n  id: \"%s\"\n  title: \"%s\"\n  url: \"%s\"\n  type: \"%s\"\n  active: %s\n", NR, $2, $3, $4, $5, active_flag
                }'
                ;;
            md|markdown)
                echo "| Index | Title | Id | Url | Type | Active |"
                echo "|-------|-------|----|-----|------|--------|"
                echo "$all_pages" | awk -F'\t' -v active="$active_id" '{
                    active_flag = ($2 == active) ? "✦" : "";
                    printf "| %d | %s | %s | %s | %s | %s |\n", NR, $3, $2, $4, $5, active_flag
                }'
                ;;
            *)
                echo "Trae CDP Pages (${CDP_BASE}):"
                echo ""
                echo "$all_pages" | awk -F'\t' -v active="$active_id" '{
                    mark = ($2 == active) ? " ✦" : "  ";
                    printf "%s[%d] %-40s %s\n", mark, NR, $3, $2
                }'
                ;;
        esac
        ;;
    use)
        idx="${2:?用法: $0 use <编号>}"
        pages=$(list_pages)
        line=$(echo "$pages" | sed -n "${idx}p")
        if [ -z "$line" ]; then
            echo "❌ 无效编号: $idx" >&2
            exit 1
        fi
        page_id=$(echo "$line" | cut -f2)
        title=$(echo "$line" | cut -f3)
        export OPENCLI_CDP_ENDPOINT="ws://${CDP_HOST}:${CDP_PORT}/devtools/page/${page_id}"
        echo "$OPENCLI_CDP_ENDPOINT" > "$STATE_FILE"
        echo "✅ 已切换到 [${idx}] ${title}"
        echo "   ${OPENCLI_CDP_ENDPOINT}"
        echo ""
        $BIN trae-cn status
        ;;
    build)
        cargo build
        ;;
    reset)
        rm -f "$STATE_FILE"
        echo "✅ 已清除 page 选择"
        ;;
    test)
        auto_detect_endpoint
        echo "=== status ==="
        $BIN trae-cn status
        echo ""
        echo "=== read (前 20 行) ==="
        $BIN trae-cn read | head -20
        ;;
    smoke)
        auto_detect_endpoint
        PASS=0
        FAIL=0
        TOTAL=0

        smoke_run() {
            local name="$1"
            shift
            TOTAL=$((TOTAL + 1))
            echo -n "  [$TOTAL] $name ... "
            local output exit_code
            output=$("$@" 2>&1 | head -c 5000) && exit_code=$? || exit_code=$?
            if [ "$exit_code" -eq 0 ] || [ "$exit_code" -eq 101 ]; then
                local first_line
                first_line=$(echo "$output" | head -1)
                if [ -n "$output" ] && ! echo "$first_line" | grep -qi "^error\|^.*Status.*Error\|^.*Role.*Error\|^.*Field.*Error"; then
                    echo "✅"
                    PASS=$((PASS + 1))
                else
                    echo "⚠️  (输出含错误)"
                    echo "      $(echo "$output" | head -3 | sed 's/^/      /')"
                    FAIL=$((FAIL + 1))
                fi
            else
                echo "❌ (exit $exit_code)"
                echo "      $(echo "$output" | head -3 | sed 's/^/      /')"
                FAIL=$((FAIL + 1))
            fi
        }

        echo "🧪 Trae CN 冒烟测试"
        echo "   endpoint: ${OPENCLI_CDP_ENDPOINT}"
        echo ""

        smoke_run "status"       $BIN trae-cn status
        smoke_run "read"         $BIN trae-cn read
        smoke_run "tasks"        $BIN trae-cn tasks
        smoke_run "context"      $BIN trae-cn context
        smoke_run "config"       $BIN trae-cn config
        smoke_run "history"      $BIN trae-cn history
        smoke_run "task-detail"  $BIN trae-cn task-detail 1
        smoke_run "export"       $BIN trae-cn export
        smoke_run "dump"         $BIN trae-cn dump

        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  结果: $PASS/$TOTAL 通过, $FAIL 失败"
        if [ "$FAIL" -gt 0 ]; then
            echo "  ⚠️  有失败项，请检查"
            exit 1
        else
            echo "  ✅ 全部通过"
        fi
        ;;
    help|"")
        echo "Trae CN 开发调试脚本"
        echo ""
        echo "使用方法: $0 [--page=N|ID] <command> [args...]"
        echo ""
        echo "全局选项:"
        echo "  --page=N|ID      - 指定 page 编号或 page-id (优先级: --page > use 持久化 > 默认 1)"
        echo "  -f, --format=FMT - 输出格式: table(默认), json, yaml, csv, md"
        echo ""
        echo "脚本命令:"
        echo "  pages           - 列出所有 CDP page"
        echo "  use <编号>      - 切换到指定 page (持久化)"
        echo "  reset           - 清除 page 选择"
        echo "  build           - cargo build"
        echo "  test            - 测试连接 + 读取"
        echo "  smoke           - 冒烟测试核心命令"
        echo "  init-env        - 方案3: 通过 launchd 设置 ELECTRON_EXTRA_LAUNCH_ARGS 启用 CDP"
        echo "  init-wrapper    - 方案4: 替换 Electron 二进制为 wrapper 脚本启用 CDP"
        echo "  help            - 显示此帮助"
        echo ""
        echo "trae-cn 子命令 (自动检测 CDP endpoint，透传所有参数):"
        $BIN trae-cn --help 2>&1 | sed -n '/^Commands:/,/^$/p' | sed 's/^/  /'
        ;;
    init-env)
        TRAE_APP="/Applications/Trae CN.app"
        PLIST_LABEL="com.user.electron-cdp-env"
        PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
        ENV_KEY="ELECTRON_EXTRA_LAUNCH_ARGS"
        ENV_VAL="--remote-debugging-port=${CDP_PORT}"

        current=$(launchctl getenv "$ENV_KEY" 2>/dev/null || true)
        if [ "$current" = "$ENV_VAL" ]; then
            echo "✅ 环境变量已设置: $ENV_KEY=$ENV_VAL"
            echo "   无需重复操作"
            exit 0
        fi

        launchctl setenv "$ENV_KEY" "$ENV_VAL"
        echo "✅ 已设置当前会话环境变量: $ENV_KEY=$ENV_VAL"

        cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/launchctl</string>
        <string>setenv</string>
        <string>${ENV_KEY}</string>
        <string>${ENV_VAL}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLIST

        launchctl load "$PLIST_PATH" 2>/dev/null || true
        echo "✅ 已写入 LaunchAgent: $PLIST_PATH"
        echo "   重启后自动生效"
        echo ""
        echo "⚠️  需要完全退出 Trae CN 后重新打开才能生效"
        echo "   退出: osascript -e 'quit app \"Trae CN\"'"
        echo "   启动: open \"$TRAE_APP\""
        ;;
    init-wrapper)
        TRAE_APP="/Applications/Trae CN.app"
        ELECTRON_DIR="${TRAE_APP}/Contents/MacOS"
        ELECTRON_BIN="${ELECTRON_DIR}/Electron"
        ELECTRON_ORIG="${ELECTRON_DIR}/Electron.orig"

        if [ ! -d "$TRAE_APP" ]; then
            echo "❌ 未找到 Trae CN: $TRAE_APP" >&2
            exit 1
        fi

        if [ -f "$ELECTRON_ORIG" ]; then
            file_type=$(file -b "$ELECTRON_ORIG" 2>/dev/null || true)
            if echo "$file_type" | grep -q "Mach-O"; then
                echo "ℹ️  Electron.orig 已存在 (Mach-O binary)"
            else
                echo "⚠️  Electron.orig 存在但不是 Mach-O binary: $file_type" >&2
                exit 1
            fi
        else
            file_type=$(file -b "$ELECTRON_BIN" 2>/dev/null || true)
            if echo "$file_type" | grep -q "Mach-O"; then
                sudo cp "$ELECTRON_BIN" "$ELECTRON_ORIG"
                echo "✅ 已备份原始二进制: Electron → Electron.orig"
            else
                echo "⚠️  Electron 已是脚本，但找不到 Electron.orig" >&2
                echo "    当前内容:" >&2
                head -3 "$ELECTRON_BIN" >&2
                exit 1
            fi
        fi

        WRAPPER='#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$ELECTRON_RUN_AS_NODE" = "1" ]; then
    exec "$DIR/Electron.orig" "$@"
else
    exec "$DIR/Electron.orig" --remote-debugging-port='"${CDP_PORT}"' "$@"
fi'

        echo "$WRAPPER" | sudo tee "$ELECTRON_BIN" > /dev/null
        sudo chmod +x "$ELECTRON_BIN"
        echo "✅ 已写入 wrapper 脚本: $ELECTRON_BIN"
        echo ""
        cat "$ELECTRON_BIN"
        echo ""
        echo "⚠️  需要完全退出 Trae CN 后重新打开才能生效"
        echo "   退出: osascript -e 'quit app \"Trae CN\"'"
        echo "   启动: open \"$TRAE_APP\""
        echo ""
        echo "💡 注意: Trae CN 更新后可能覆盖此修改，需重新执行 init-wrapper"
        ;;
    *)
        auto_detect_endpoint
        shift
        if [ "$OUTPUT_FORMAT" != "table" ]; then
            $BIN trae-cn "$cmd" --format "$OUTPUT_FORMAT" "$@"
        else
            $BIN trae-cn "$cmd" "$@"
        fi
        ;;
esac
