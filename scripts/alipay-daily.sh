#!/bin/bash
# 支付宝数据每日自动抓取脚本
# 由 launchd 每日 9:00 调用

set -euo pipefail

# 项目根目录（本地 Mac）
PROJECT_DIR="$HOME/jiujiujin-dashboard"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/alipay-$(date +%Y%m%d).log"
FEISHU_SCRIPT="$PROJECT_DIR/scripts/feishu-alert.sh"

# launchd 环境下 PATH 可能缺失，显式补上
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# 自动化以无头模式运行：Cookie 有效时全程无弹窗；
# Cookie 过期时抓取器会立即失败退出（非交互环境不等待回车），触发下面的飞书告警
export HEADLESS=1

# Node 可执行文件（优先用 nvm/系统中的 node）
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"

mkdir -p "$LOG_DIR"

echo "=== 支付宝数据抓取 $(date) ===" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# 运行抓取脚本（有头模式，依赖已保存的 Cookie，保持与手动测试一致）
if npx tsx src/exporters/test-alipay-full.ts >> "$LOG_FILE" 2>&1; then
    echo "✓ 抓取成功 $(date)" >> "$LOG_FILE"
else
    echo "✗ 抓取失败 $(date)" >> "$LOG_FILE"

    # 发送飞书告警
    if [ -x "$FEISHU_SCRIPT" ]; then
        "$FEISHU_SCRIPT" "支付宝数据抓取失败，请检查日志: $LOG_FILE" || true
    fi
fi

# 清理 30 天前的日志
find "$LOG_DIR" -name "alipay-*.log" -mtime +30 -delete 2>/dev/null || true

echo "=== 完成 $(date) ===" >> "$LOG_FILE"
