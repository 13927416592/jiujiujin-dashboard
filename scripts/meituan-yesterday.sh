#!/bin/bash
# 美团「昨天」经营数据一键抓取
# 用法：bash scripts/meituan-yesterday.sh
#
# - 默认抓取昨天（MEITUAN_EXPORT_DAYS=1），解析后上传到云端看板
# - 首次运行会弹浏览器，扫码登录 e.dianping.com，之后自动免登录
# - 有头模式运行真实 Chrome（无头会被美团风控拦截）

set -euo pipefail

# 自动定位项目根目录（本脚本在 scripts/ 下）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# launchd/cron 下 PATH 可能不全，显式补上
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# 抓昨天：days=1 即昨天
export MEITUAN_EXPORT_DAYS=1

# 有头模式（真实 Chrome，最稳定；勿设 HEADLESS=1，会被美团风控拦截）
unset HEADLESS

echo "=== 美团昨天数据抓取 $(date '+%Y-%m-%d %H:%M:%S') ==="

npx tsx src/exporters/test-meituan-report.ts

echo "=== 完成 $(date '+%Y-%m-%d %H:%M:%S') ==="
