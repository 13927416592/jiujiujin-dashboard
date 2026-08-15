#!/bin/bash
# 飞书告警脚本：从 .env 读取配置，接收消息文本作为参数
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 加载 .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

: "${FEISHU_APP_ID:?FEISHU_APP_ID 未设置}"
: "${FEISHU_APP_SECRET:?FEISHU_APP_SECRET 未设置}"

MESSAGE="${1:-任务通知}"

# 获取 tenant_access_token
TOKEN_RESP=$(curl -s -X POST \
  "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
  -H "Content-Type: application/json" \
  -d "{\"app_id\":\"${FEISHU_APP_ID}\",\"app_secret\":\"${FEISHU_APP_SECRET}\"}")

TOKEN=$(echo "$TOKEN_RESP" | /usr/bin/python3 -c "import sys,json;print(json.load(sys.stdin).get('tenant_access_token',''))" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo "获取飞书 token 失败: $TOKEN_RESP" >&2
  exit 1
fi

# 发送消息
if [ -n "${FEISHU_USER_ID:-}" ]; then
  curl -s -X POST \
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"receive_id\":\"${FEISHU_USER_ID}\",\"msg_type\":\"text\",\"content\":\"{\\\"text\\\":\\\"${MESSAGE}\\\"}\"}" >/dev/null
  echo "告警已发送"
else
  echo "FEISHU_USER_ID 未配置，跳过发送。消息内容: $MESSAGE"
fi
