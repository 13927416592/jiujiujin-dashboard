#!/bin/bash
# 支付宝数据每日自动抓取脚本

set -e

# 配置
PROJECT_DIR="$HOME/jiujiujin-dashboard"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/alipay-$(date +%Y%m%d).log"
FEISHU_SCRIPT="$PROJECT_DIR/scripts/feishu-alert.sh"

# 创建日志目录
mkdir -p "$LOG_DIR"

echo "=== 支付宝数据抓取 $(date) ===" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# 运行抓取脚本
if node scripts/test-alipay-full.mjs >> "$LOG_FILE" 2>&1; then
    echo "✓ 抓取成功 $(date)" >> "$LOG_FILE"
    
    # 可选：推送到 GitHub（取消注释启用）
    # git add src/exporters/output/alipay_full_*.json
    # git commit -m "data: 支付宝数据 $(date +%Y-%m-%d)"
    # git push
else
    echo "✗ 抓取失败 $(date)" >> "$LOG_FILE"
    
    # 发送飞书告警
    if [ -x "$FEISHU_SCRIPT" ]; then
        "$FEISHU_SCRIPT" "支付宝数据抓取失败，请检查日志: $LOG_FILE"
    fi
fi

# 清理 30 天前的日志
find "$LOG_DIR" -name "alipay-*.log" -mtime +30 -delete

echo "=== 完成 $(date) ===" >> "$LOG_FILE"
