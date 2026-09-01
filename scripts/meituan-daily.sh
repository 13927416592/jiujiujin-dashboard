#!/bin/bash
# 美团数据每日自动抓取脚本
# 由 launchd 每日 9:10 调用

set -euo pipefail

# 项目根目录（本地 Mac）
PROJECT_DIR="$HOME/jiujiujin-dashboard"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/meituan-$(date +%Y%m%d).log"
FEISHU_SCRIPT="$PROJECT_DIR/scripts/feishu-alert.sh"

# launchd 环境下 PATH 可能缺失，显式补上
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# 经实测，美团商家后台在无头(headless)模式下会被风控拦截/要求登录，
# 因此定时任务使用「有头模式」运行真实 Chrome，抓取期间窗口会短暂出现在桌面，
# 结束后自动关闭（约 1 分钟），与手动运行一致、最稳定。
# 登录态已通过持久化用户目录保存，正常情况下无需手动登录。
unset HEADLESS

mkdir -p "$LOG_DIR"

echo "=== 美团数据抓取 $(date) ===" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# 运行抓取脚本（有头模式，依赖已保存的 Cookie）
# 每次运行前清除浏览器缓存目录，防止 Chromium 状态数据积累导致下载时崩溃。
# 登录态由独立的 Cookie 持久化文件（cookies/）维持，清缓存不影响自动登录。
rm -rf "$PROJECT_DIR/src/exporters/browser-profile-meituan"

if npx tsx src/exporters/test-meituan-report.ts >> "$LOG_FILE" 2>&1; then
    echo "✓ 抓取成功 $(date)" >> "$LOG_FILE"
else
    echo "✗ 抓取失败 $(date)" >> "$LOG_FILE"

    # 发送飞书告警
    if [ -x "$FEISHU_SCRIPT" ]; then
        "$FEISHU_SCRIPT" "美团数据抓取失败，请检查日志: $LOG_FILE" || true
    fi
fi

# 清理 30 天前的日志
find "$LOG_DIR" -name "meituan-*.log" -mtime +30 -delete 2>/dev/null || true

echo "=== 完成 $(date) ===" >> "$LOG_FILE"
