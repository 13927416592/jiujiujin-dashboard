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

# 注意：经实测，支付宝经营数据页在无头(headless)模式下会被风控重定向到登录页，
# 即使 Cookie 有效也无法访问。因此定时任务使用「有头模式」运行真实 Chrome，
# 抓取期间窗口会短暂出现在桌面，结束后自动关闭（约 1 分钟），与手动运行一致、最稳定。
# 如需强制无头试验，可在此处 export HEADLESS=1（不保证可用）。
unset HEADLESS

# 加载账密等环境变量（launchd 不读 .zshrc，统一从该文件注入；文件不入库、权限 600）。
# 内容只需支付宝账密（飞书告警走 .env，由 feishu-alert.sh 自行加载）：
#   export ALIPAY_USERNAME="你的账号"
#   export ALIPAY_PASSWORD="你的密码"
if [ -f "$PROJECT_DIR/.alipay-env" ]; then
    set -a; . "$PROJECT_DIR/.alipay-env"; set +a
fi

# Node 可执行文件（优先用 nvm/系统中的 node）
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"

mkdir -p "$LOG_DIR"

echo "=== 支付宝数据抓取 $(date) ===" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# 运行抓取脚本（有头模式，依赖已保存的 Cookie，保持与手动测试一致）
# 每次运行前清除浏览器缓存目录，防止 Chromium 状态数据积累导致下载时崩溃。
# 登录态由独立的 Cookie 持久化文件（cookies/）维持，清缓存不影响自动登录。
rm -rf "$PROJECT_DIR/src/exporters/browser-profile"

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
