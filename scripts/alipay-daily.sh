#!/bin/bash

# 久久金集团 - 支付宝每日数据抓取
# 每天早上 9:00 执行

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="logs"
mkdir -p "$LOG_DIR"

DATE=$(date +%Y%m%d)
LOG_FILE="$LOG_DIR/alipay-$DATE.log"

echo "=== 支付宝数据抓取 $(date) ===" >> "$LOG_FILE"

/usr/local/bin/node --import tsx src/exporters/alipay-full.ts >> "$LOG_FILE" 2>&1

if [ $? -eq 0 ]; then
    echo "✓ 抓取成功" >> "$LOG_FILE"
else
    echo "✗ 抓取失败" >> "$LOG_FILE"
fi

echo "=== 完成 $(date) ===" >> "$LOG_FILE"
