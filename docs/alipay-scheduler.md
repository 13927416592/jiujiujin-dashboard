# 支付宝数据定时抓取配置指南

## 文件说明

| 文件 | 说明 |
|------|------|
| `scripts/alipay-daily.sh` | 每日抓取脚本 |
| `scripts/feishu-alert.sh` | 飞书告警脚本 |
| `scripts/com.jiujiujin.alipay-daily.plist` | macOS 定时任务配置 |

## 配置步骤

### 1. 设置脚本权限

```bash
cd ~/jiujiujin-dashboard
chmod +x scripts/alipay-daily.sh
chmod +x scripts/feishu-alert.sh
```

### 2. 配置飞书告警（可选）

1. 在飞书群中创建机器人，获取 Webhook URL
2. 设置环境变量：

```bash
echo 'export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"' >> ~/.zshrc
source ~/.zshrc
```

### 3. 安装定时任务

```bash
# 复制配置文件到 LaunchAgents
cp scripts/com.jiujiujin.alipay-daily.plist ~/Library/LaunchAgents/

# 加载定时任务
launchctl load ~/Library/LaunchAgents/com.jiujiujin.alipay-daily.plist
```

### 4. 验证定时任务

```bash
# 查看任务状态
launchctl list | grep alipay

# 手动触发测试
launchctl start com.jiujiujin.alipay-daily
```

### 5. 查看日志

```bash
# 查看抓取日志
tail -f ~/jiujiujin-dashboard/logs/alipay-$(date +%Y%m%d).log

# 查看 launchd 日志
tail -f ~/jiujiujin-dashboard/logs/launchd-stdout.log
```

## 管理定时任务

```bash
# 停止定时任务
launchctl stop com.jiujiujin.alipay-daily

# 卸载定时任务
launchctl unload ~/Library/LaunchAgents/com.jiujiujin.alipay-daily.plist

# 重新加载
launchctl load ~/Library/LaunchAgents/com.jiujiujin.alipay-daily.plist
```

## 修改执行时间

编辑 `scripts/com.jiujiujin.alipay-daily.plist`：

```xml
<key>StartCalendarInterval</key>
<dict>
    <key>Hour</key>
    <integer>9</integer>  <!-- 小时 (0-23) -->
    <key>Minute</key>
    <integer>0</integer>   <!-- 分钟 (0-59) -->
</dict>
```

修改后重新加载：

```bash
launchctl unload ~/Library/LaunchAgents/com.jiujiujin.alipay-daily.plist
launchctl load ~/Library/LaunchAgents/com.jiujiujin.alipay-daily.plist
```

## 注意事项

1. **Cookie 有效期**：支付宝 Cookie 约 7 天有效，需要定期更新
2. **网络环境**：确保 Mac 在定时任务执行时联网
3. **登录状态**：首次运行需要手动登录，后续使用 Cookie
4. **数据同步**：如需推送到 GitHub，取消 `alipay-daily.sh` 中的注释

## 故障排查

### 任务未执行

```bash
# 检查任务是否加载
launchctl list | grep alipay

# 查看错误日志
cat ~/Library/LaunchAgents/com.jiujiujin.alipay-daily.plist
```

### 抓取失败

```bash
# 查看日志
cat ~/jiujiujin-dashboard/logs/alipay-$(date +%Y%m%d).log

# 手动运行测试
cd ~/jiujiujin-dashboard
node scripts/test-alipay-full.mjs
```

### Cookie 过期

重新运行抓取脚本，手动登录后更新 Cookie 文件：

```bash
node scripts/test-alipay-full.mjs
```
