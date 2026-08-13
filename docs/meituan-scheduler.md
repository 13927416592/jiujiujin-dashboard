# 美团数据定时导出配置指南

## 概述

本方案通过 Playwright 自动化抓取美团经营宝数据，每日 9:00 自动执行。

---

## 一、手动测试导出

### 1. 首次运行（需要手动登录）

```bash
cd /workspace/projects
npx tsx src/exporters/test-meituan.ts
```

- 会打开浏览器窗口
- 在浏览器中登录美团经营宝（扫码或账号密码）
- 登录成功后自动保存 Cookie 到 `src/exporters/cookies/meituan.json`
- Cookie 有效期约 7 天

### 2. 后续运行（自动登录）

```bash
npx tsx src/exporters/test-meituan.ts
```

- 使用保存的 Cookie 自动登录
- 无需手动操作

---

## 二、配置定时任务（macOS）

### 1. 加载定时任务

```bash
# 复制 plist 文件到 LaunchAgents
cp scripts/com.jiujiujin.meituan-daily.plist ~/Library/LaunchAgents/

# 加载定时任务
launchctl load ~/Library/LaunchAgents/com.jiujiujin.meituan-daily.plist

# 验证是否加载成功
launchctl list | grep meituan
```

### 2. 定时任务配置

- **执行时间**：每日 9:00
- **执行脚本**：`scripts/meituan-daily.sh`
- **日志文件**：`/app/work/logs/bypass/meituan-daily.log`

### 3. 管理定时任务

```bash
# 查看任务状态
launchctl list | grep meituan

# 手动触发执行
launchctl start com.jiujiujin.meituan-daily

# 停止定时任务
launchctl unload ~/Library/LaunchAgents/com.jiujiujin.meituan-daily.plist

# 重新启动
launchctl load ~/Library/LaunchAgents/com.jiujiujin.meituan-daily.plist
```

---

## 三、数据文件

### 输出位置

- **原始数据**：`src/exporters/output/meituan_full_YYYY-MM-DD.json`
- **CSV 文件**：`src/exporters/output/meituan_页面名_YYYY-MM-DD.csv`

### 数据结构

```json
{
  "exportDate": "2026-08-13T09:00:00.000Z",
  "pages": {
    "客流分析": {
      "csvPath": "/path/to/csv",
      "headers": ["日期", "曝光人数", "访问人数", ...],
      "rows": [["2026-08-13", "268", "36", ...]]
    },
    "经营评分": { ... },
    "评价分析": { ... },
    "客资中心": { ... }
  }
}
```

---

## 四、注意事项

### Cookie 过期处理

- Cookie 有效期约 7 天
- 过期后需重新手动登录
- 脚本会提示"需要手动登录"

### 网络问题

- 确保服务器能访问美团经营宝
- 如遇验证码，需手动处理

### 数据更新频率

- 建议每日执行一次（9:00）
- 可在 plist 文件中修改执行时间

---

## 五、故障排查

### 1. 查看日志

```bash
tail -f /app/work/logs/bypass/meituan-daily.log
```

### 2. 检查 Cookie

```bash
ls -la src/exporters/cookies/meituan.json
cat src/exporters/cookies/meituan.json | jq '.[0].expirationDate'
```

### 3. 手动测试

```bash
npx tsx src/exporters/test-meituan.ts
```

---

## 六、后续优化

### 1. 飞书告警

- 导出失败时发送飞书通知
- 参考支付宝告警脚本：`scripts/feishu-alert.js`

### 2. 数据入库

- 将 JSON 数据解析后存入 Supabase
- 前端从数据库读取数据展示

### 3. 多门店支持

- 遍历所有门店，逐个导出数据
- 合并为统一数据格式
