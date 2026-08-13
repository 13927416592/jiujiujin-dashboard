#!/bin/bash
# 飞书告警脚本（使用飞书应用 API）

# 飞书应用配置
FEISHU_APP_ID="${FEISHU_APP_ID:-cli_aad2190108391bd3}"
FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-bFUsSZB8eJwtIqdmGMOxbd0ykWhMeGjb}"
FEISHU_USER_ID="${FEISHU_USER_ID:-}"  # 需要配置：用户的 open_id 或 user_id

# 告警消息
MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
    MESSAGE="支付宝数据抓取异常，请检查日志"
fi

# 获取 tenant_access_token
TOKEN_RESPONSE=$(curl -s -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
    -H "Content-Type: application/json" \
    -d "{\"app_id\":\"$FEISHU_APP_ID\",\"app_secret\":\"$FEISHU_APP_SECRET\"}")

TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"tenant_access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo "错误: 获取飞书 token 失败"
    echo "响应: $TOKEN_RESPONSE"
    exit 1
fi

# 如果未配置 user_id，尝试通过手机号查找
if [ -z "$FEISHU_USER_ID" ]; then
    if [ -n "$FEISHU_USER_PHONE" ]; then
        USER_RESPONSE=$(curl -s -X POST "https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"emails\":[],\"mobiles\":[\"$FEISHU_USER_PHONE\"]}")
        FEISHU_USER_ID=$(echo "$USER_RESPONSE" | grep -o '"user_id":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
fi

if [ -z "$FEISHU_USER_ID" ]; then
    echo "错误: 未配置 FEISHU_USER_ID 或 FEISHU_USER_PHONE"
    exit 1
fi

# 发送消息
curl -s -X POST "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"receive_id\": \"$FEISHU_USER_ID\",
        \"msg_type\": \"text\",
        \"content\": \"{\\\"text\\\":\\\"【久久金运营看板】\\\\n${MESSAGE}\\\\n\\\\n时间: $(date '+%Y-%m-%d %H:%M:%S')\\\"}\"
    }"

echo "飞书告警已发送"
