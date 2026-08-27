#!/bin/bash
# SmartBI 完成订单每日自动导出 + 回传看板
#
# 部署：Linux 服务器（跑 Python + Playwright，headless Chromium）。
# 由 cron 每天早上执行（建议 9:20，略晚于支付宝/美团，错开资源）。
#
# 凭据/配置通过环境变量或同目录 .smartbi-env 注入（文件不入库、权限 600）：
#   export SMARTBI_USERNAME="账号"
#   export SMARTBI_PASSWORD='密码（含 $ 必须用英文单引号）'
#   export DASHBOARD_ORDERS_UPLOAD_URL="https://看板域名"
#   export DASHBOARD_INGEST_TOKEN="看板上传token"
#
# 用法：bash scripts/smartbi/smartbi-daily.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/smartbi-$(date +%Y%m%d).log"
ENV_FILE="$SCRIPT_DIR/.smartbi-env"
PY_SCRIPT="$SCRIPT_DIR/smartbi_auto_export.py"

# cron 环境下 PATH 可能缺失，显式补上（按服务器实际 Python/playwright 位置调整）
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"

# 加载凭据（不入库）
if [ -f "$ENV_FILE" ]; then
    set -a; . "$ENV_FILE"; set +a
fi

mkdir -p "$LOG_DIR"

echo "=== SmartBI 订单导出 $(date) ===" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# 选择 python 解释器：优先项目虚拟环境，否则系统 python3
if [ -x "$PROJECT_DIR/.venv/bin/python" ]; then
    PY="$PROJECT_DIR/.venv/bin/python"
else
    PY="$(command -v python3 || command -v python)"
fi

if "$PY" "$PY_SCRIPT" >> "$LOG_FILE" 2>&1; then
    echo "✓ SmartBI 导出成功 $(date)" >> "$LOG_FILE"
    exit 0
else
    code=$?
    echo "✗ SmartBI 导出失败（退出码 $code）$(date)" >> "$LOG_FILE"
    # 失败告警由 Python 脚本内部调用飞书；这里兜底
    FEISHU="$PROJECT_DIR/scripts/feishu-alert.sh"
    if [ -x "$FEISHU" ]; then
        "$FEISHU" "SmartBI 完成订单导出失败，请检查日志: $LOG_FILE" || true
    fi
    exit "$code"
fi

# 清理 30 天前日志
find "$LOG_DIR" -name "smartbi-*.log" -mtime +30 -delete 2>/dev/null || true
