# 抖音创作者中心数据导出脚本

使用 Playwright 自动从抖音创作者中心导出数据。

## 使用步骤

### 1. 安装依赖

```bash
pnpm install
```

### 2. 获取 Cookie

由于抖音需要登录才能访问数据中心，我们需要先手动登录并导出 Cookie。

#### 方法一：浏览器扩展（推荐）

1. 安装 Chrome 扩展「EditThisCookie」或「Cookie-Editor」
2. 登录抖音创作者中心：https://creator.douyin.com
3. 进入数据中心页面
4. 点击扩展图标，导出所有 Cookie
5. 将导出的 JSON 保存到 `cookies.json` 文件

#### 方法二：开发者工具

1. 登录抖音创作者中心
2. 按 F12 打开开发者工具
3. 进入「Application」→「Cookies」→「https://creator.douyin.com」
4. 复制所有 Cookie
5. 转换为 JSON 格式保存到 `cookies.json`

### 3. 配置 Cookie 格式

`cookies.json` 文件格式如下：

```json
[
  {
    "name": "sessionid",
    "value": "your_session_id_here",
    "domain": ".douyin.com",
    "path": "/",
    "httpOnly": true,
    "secure": true,
    "sameSite": "None"
  },
  {
    "name": "ttwid",
    "value": "your_ttwid_here",
    "domain": ".douyin.com",
    "path": "/",
    "httpOnly": false,
    "secure": true,
    "sameSite": "Lax"
  }
  // ... 其他 Cookie
]
```

### 4. 运行脚本

```bash
# 导出近30天数据（默认）
npx tsx scripts/douyin-export/douyin-export.ts

# 修改时间范围：编辑 douyin-export.ts 中的 CONFIG.timeRange
# 'yesterday' | '7days' | '30days'
```

### 5. 查看结果

导出的 CSV 文件会保存在 `scripts/douyin-export/downloads/` 目录。

## 注意事项

### Cookie 有效期

- 抖音 Cookie 通常有效期为 7-30 天
- 如果导出失败，可能是 Cookie 过期，需要重新获取
- 建议每周更新一次 Cookie

### 风控策略

- 脚本已内置随机延迟（1-4秒），避免触发风控
- 如需批量导出多个账号，建议每个账号间隔 5-10 分钟
- 不要在短时间内频繁登录/登出

### 常见问题

**Q: 提示「登录失败，Cookie 可能已过期」**
A: 重新登录抖音，导出新的 Cookie

**Q: 未找到「导出数据」按钮**
A: 可能是页面结构变化，需要更新选择器。可以临时设置 `headless: false` 查看实际页面

**Q: 下载的文件为空**
A: 可能是网络问题或抖音服务端延迟，增加 `CONFIG.timeout` 值

## 批量导出（多账号）

如需批量导出多个门店账号的数据，可以：

1. 准备多个 Cookie 文件（`cookies_001.json`, `cookies_002.json`...）
2. 修改脚本循环读取并导出
3. 使用 cron 定时任务自动执行

示例 cron 配置（每周日凌晨3点执行）：

```bash
0 3 * * 0 cd /workspace/projects && npx tsx scripts/douyin-export/douyin-export.ts >> /var/log/douyin-export.log 2>&1
```

## 后续优化

- [ ] 支持多账号批量导出
- [ ] 自动刷新 Cookie（通过扫码登录）
- [ ] 接入数据看板 API，自动导入
- [ ] 添加执行结果通知（邮件/企业微信）
