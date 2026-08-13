#!/bin/bash
# 飞书告警脚本

# 飞书 Webhook URL（需要替换为实际的 URL）
FEISHU_WEBHOOK_URL="${FEISHU_WEBHOOK_URL:-}"

# 告警消息
MESSAGE="$1"

if [ -z "$FEISHU_WEBHOOK_URL" ]; then
    echo "错误: 未配置 FEISHU_WEBHOOK_URL"
    exit 1
fi

if [ -z "$MESSAGE" ]; then
    MESSAGE="支付宝数据抓取异常，请检查日志"
fi

# 发送飞书消息
curl -X POST -H "Content-Type: application/json" \
    -d "{
        \"msg_type\": \"text\",
        \"content\": {
            \"text\": \"【久久金运营看板】\\n${MESSAGE}\\n\\n时间: $(date '+%Y-%m-%d %H:%M:%S')\"
        }
    }" \
    "$FEISHU_WEBHOOK_URL"

echo "飞书告警已发送"
