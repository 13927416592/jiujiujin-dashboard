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

1. **会话有效期仅几小时**：支付宝商家后台的**服务端会话有效期只有几小时**（不是 7 天）。本地强制 Cookie 持久化只能让浏览器继续发送 Cookie，无法复活服务端已失效的会话。因此**长期免登依赖每日 9:10 定时抓取续期会话**，而不是一次登录长期保存。
2. **账密半自动登录（降低操作成本，但非全自动）**：配置 `.alipay-env` 后，会话失效时脚本会自动切到账密 Tab、填好账号、把光标聚焦到密码框。**密码必须人工输入**——支付宝 aliedit 安全密码控件（`#password_rsainput`）逐字符做 RSA 加密，且只接受真人物理按键，Playwright/CDP 的模拟按键会被识别并丢弃（圆点显示但内部加密域为空，提交报"请输入登录密码"），无法用脚本自动填。安全控件也无法切换到普通输入模式（页面提示"安全控件强制开启"）。
   - 交互终端跑：等密码框聚焦后手动输密码+点登录即可，之后抓取全自动。
   - 无人值守的 9:10 定时任务：因无法人工输密码，会话失效时会在 90 秒后 exit 1 并飞书告警，需手动跑一次（扫码或账密）续期会话。
3. **网络环境**：确保 Mac 在定时任务执行时联网且处于唤醒状态（可在「系统设置 → 电池 → 定时启动」里安排唤醒）。
4. **二次验证**：即便人工登录，支付宝风控仍可能偶尔要求短信/滑块/APP 确认；手动跑一次扫码/账密即可续期几小时会话。
5. **数据同步**：抓取成功后会自动上传到云端看板。

## 配置账密半自动登录（可选）

在项目根目录创建 `.alipay-env`（**该文件已在 .gitignore 中，不会入库**），并设置权限：

```bash
cat > ~/jiujiujin-dashboard/.alipay-env <<'EOF'
export ALIPAY_USERNAME="你的支付宝账号"
export ALIPAY_PASSWORD="你的登录密码"
EOF
chmod 600 ~/jiujiujin-dashboard/.alipay-env
```

`alipay-daily.sh` 启动时会自动 `source` 该文件注入环境变量（launchd 不会读取 `.zshrc`，必须走这里）。

- 飞书失败告警复用已有的「运营助手」应用（`scripts/feishu-alert.sh` 读取项目根 `.env` 里的 `FEISHU_APP_ID/SECRET/USER_ID`），**无需在 `.alipay-env` 里再配 webhook**。
- 交互终端手动跑时，也可以直接 `export ALIPAY_USERNAME=...` 后运行。
- 账号密码**只从环境变量读取**，代码中不硬编码。

### 推荐：nut.js 硬件级自动输密码（`ALIPAY_USERNAME` + `ALIPAY_PASSWORD`）

aliedit 安全控件能识别 CDP/Playwright 模拟按键（即便 `isTrusted=true`）并丢弃，**但识别不了操作系统层面的硬件事件**。脚本在检测到 `@nut-tree-fork/nut-js` 可用时，会通过 macOS 的 CGEvent 投递与真人完全一致的键鼠事件：置顶 Chrome → 读窗口坐标 → 硬件鼠标点击密码框夺焦 → 硬件键盘逐字符输入密码（60~150ms 随机节奏）→ 点登录。

**一次性准备（仅 macOS 抓取机）：**

1. 安装依赖：`pnpm add -D @nut-tree-fork/nut-js`
2. 授权：**系统设置 → 隐私与安全性 → 辅助功能**，把运行脚本的终端（Terminal/iTerm/VS Code）勾上。授权后**完全退出终端再重开**才生效。
3. `.alipay-env` 里配好账号密码（见上一节）。无需额外开关，检测到 nut.js 就自动启用；如需关闭设 `ALIPAY_NUT=0`。

运行 `npx tsx src/exporters/test-alipay-full.ts`，登录阶段会出现：
```
⌨️  使用 nut.js 硬件级键盘输入密码（请勿触碰鼠标键盘）...
✅ 密码已输入，加密隐藏域长度=...
🚪 点击登录按钮...
✅ 已提交登录并离开登录页
```
- 若弹滑块/图文验证码，脚本会暂停并提示你在浏览器手动完成（日志 `🧩 检测到验证码...`），完成后自动继续。
- 期间**不要动鼠标键盘**，否则 OS 焦点可能被抢走导致串框。
- nut.js 不可用（未装/无图形环境/权限未授）时，自动回退到 Chrome 自动填充或半自动方案。

### 备选：用 Chrome 自动填充尝试全自动登录（`ALIPAY_AUTOFILL=1`）

安全控件不接受 Playwright 模拟按键，但**有可能**接受 Chrome 浏览器原生的"自动填充"（自动填充走的是浏览器内部注入，不是物理按键）。可按下面步骤验证：

1. 在 `.alipay-env` 里加一行 `export ALIPAY_AUTOFILL=1`。开启后脚本**不会**关闭 Chrome 密码管理器。
2. 第一次手动跑一次：`npx tsx src/exporters/test-alipay-full.ts`。脚本会自动填账号、聚焦密码框；你**手动输入密码并登录**，登录成功后 Chrome 若弹出"保存密码？"，点**保存**。
3. 之后再跑：脚本会点击账号框/密码框唤起 Chrome 已保存凭据自动填充，并**检测安全控件的加密隐藏域 `#password` 是否真的被填非空**——只有确认密码已被加密写入才自动点登录；若隐藏域仍为空（控件未识别自动填充），自动回退到半自动（聚焦密码框等人工输入）。

> 这是实验性方案，能否成功取决于支付宝安全控件是否识别 Chrome 自动填充事件，需实测。日志会打印"可见圆点=N 位，加密隐藏域=M 字符"，其中**加密隐藏域非空**才是有效信号。若你保存的账号与 `ALIPAY_USERNAME` 不一致，Chrome 可能弹出多个凭据供选择，脚本会等待 5 秒，必要时可手动点选。

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

# 手动运行测试（有界面，会话失效时会自动账密或手动扫码登录）
cd ~/jiujiujin-dashboard
ALIPAY_USERNAME=xxx ALIPAY_PASSWORD=xxx npx tsx src/exporters/test-alipay-full.ts
```


### Cookie 过期

重新运行抓取脚本，手动登录后更新 Cookie 文件：

```bash
node scripts/test-alipay-full.mjs
```
