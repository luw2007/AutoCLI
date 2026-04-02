#!/bin/bash

set -euo pipefail

OPENCLI_PATH="OPENCLI_PATH_PLACEHOLDER"
cd ${OPENCLI_PATH}

CDP_HOST="${OPENCLI_CDP_HOST:-localhost}"
CDP_PORT="${OPENCLI_CDP_PORT:-9222}"
CDP_BASE="http://${CDP_HOST}:${CDP_PORT}"
BIN="${OPENCLI_PATH}/target/debug/opencli-rs"
STATE_FILE="${TMPDIR:-/tmp}/opencli-cdp-endpoint"

list_pages() {
    curl -sf "${CDP_BASE}/json/list" | jq -r '
        to_entries[]
        | select(.value.type == "page")
        | "\(.key)\t\(.value.id)\t\(.value.title)"
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
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --page=*) PAGE_IDX="${arg#--page=}" ;;
        *)        ARGS+=("$arg") ;;
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
        echo "Trae CDP Pages (${CDP_BASE}):"
        echo ""
        echo "$all_pages" | awk -F'\t' -v active="$active_id" '{
            mark = ($2 == active) ? " ✦" : "  ";
            printf "%s[%d] %-40s %s\n", mark, NR, $3, $2
        }'
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
        echo "  --page=N|ID  - 指定 page 编号或 page-id (优先级: --page > use 持久化 > 默认 1)"
        echo ""
        echo "脚本命令:"
        echo "  pages        - 列出所有 CDP page"
        echo "  use <编号>   - 切换到指定 page (持久化)"
        echo "  reset        - 清除 page 选择"
        echo "  build        - cargo build"
        echo "  test         - 测试连接 + 读取"
        echo "  smoke        - 冒烟测试核心命令"
        echo "  help         - 显示此帮助"
        echo ""
        echo "trae-cn 子命令 (自动检测 CDP endpoint，透传所有参数):"
        $BIN trae-cn --help 2>&1 | sed -n '/^Commands:/,/^$/p' | sed 's/^/  /'
        ;;
    *)
        auto_detect_endpoint
        shift
        $BIN trae-cn "$cmd" "$@"
        ;;
esac
