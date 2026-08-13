#!/bin/bash
# 美团经营宝数据每日自动导出脚本
# 配置 launchd 定时任务，每日 9:00 执行

# 项目根目录
PROJECT_DIR="/workspace/projects"

# 日志目录
LOG_DIR="/app/work/logs/bypass"
mkdir -p "$LOG_DIR"

# 日志文件
LOG_FILE="$LOG_DIR/meituan-daily.log"

echo "========================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始执行美团数据导出" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

# 进入项目目录
cd "$PROJECT_DIR" || exit 1

# 执行导出脚本
npx tsx src/exporters/test-meituan.ts >> "$LOG_FILE" 2>&1

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 美团数据导出成功" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 美团数据导出失败，退出码：$EXIT_CODE" >> "$LOG_FILE"
fi

echo "" >> "$LOG_FILE"
