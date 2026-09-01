# 久久金数据看板 — 完整交接文档

> 本文档供新接手的 AI（Coze Coding 团队版）阅读，目的是让你完整理解项目全貌并能独立维护、迭代。
> 更新日期：2026-09-01

---

## 一、项目概述

久久金运营数据看板，覆盖支付宝、美团、抖音、客户回收订单（SmartBI）等多平台数据，目标是**管理层汇报展示 + 日常运营监控**。

### 架构（关键！）

```
Mac 本地（用户 MacBook Air）           Coze 沙箱（云端，你所在的环境）
┌────────────────────────┐            ┌────────────────────────┐
│ Playwright + Chrome    │──HTTP──→   │ Next.js 16 看板        │
│ 支付宝/美团/抖音抓取    │  上传API   │ 数据展示 + 聚合计算     │
│ launchd 定时任务        │            │                        │
└────────────────────────┘            └───────────┬────────────┘
                                                  │ pg 直连
                                       ┌──────────▼────────────┐
                                       │  Supabase PostgreSQL   │
                                       │  (云端共享数据库)       │
                                       └───────────────────────┘
```

**重要**：数据抓取（Playwright + Chrome）只能在用户 Mac 上运行（需要真实浏览器），不能在 Coze 沙箱运行。你负责的是**云端看板 + 数据库 + 接收上传的 API**。

---

## 二、技术栈

| 维度 | 选择 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 核心 | React 19 + TypeScript 5 |
| UI 组件 | shadcn/ui (Radix UI) |
| 样式 | Tailwind CSS 4 |
| 设计风格 | 深色毛玻璃风 (Dark Glassmorphism) |
| 数据库 | Supabase PostgreSQL（pg 直连，不走 REST） |
| 包管理 | pnpm（严禁 npm/yarn） |

---

## 三、代码仓库

- **GitHub**: `https://github.com/13927416592/jiujiujin-dashboard`
- **分支**: main（单分支）
- **Clone**: `git clone https://github.com/13927416592/jiujiujin-dashboard.git`

---

## 四、数据库（Supabase）

### 连接信息

```
PGHOST=aws-0-ap-northeast-1.pooler.supabase.com
PGPORT=5432
PGUSER=postgres.uyqlaheofskaannpkhkq
PGPASSWORD=Jiujiujin2026!
PGDATABASE=postgres
PGSSLMODE=require
```

> 这是 Supabase Session pooler 地址（IPv4 兼容），沙箱环境只能走这个，不能用直连地址（IPv6）。

### 表结构

1. **platform_snapshots** — 平台每日快照（支付宝/美团/抖音）
   - 唯一键：`(platform, data_date)`
   - 字段：id, platform, data_date, fetched_at, source, summary(jsonb), raw_data(jsonb)

2. **meituan_stores** — 美团门店台账
   - 主键：store_id
   - 字段：name, brand, organization, city, address, business_status 等

3. **bi_orders** — SmartBI 完成订单明细（一单多行）
   - 唯一键：`(order_no, line_no)`
   - 字段：data_date, date_basis, store_name, platform, source_group, amount, gross_weight, net_weight

4. **health_check** — 健康检查表

### 数据库访问规范

- **必须走 pg 直连**：`src/storage/database/pg-client.ts`
- **禁止**使用 `@supabase/supabase-js` 做数据读写（REST 网关间歇性 502）
- 连接信息从环境变量读取，禁止硬编码

### 当前数据量（截至 2026-09-01）

| 表 | 记录数 | 日期范围 |
|---|--------|---------|
| platform_snapshots (alipay) | ~12 条 | 2026-08-17 ~ 2026-08-31 |
| platform_snapshots (meituan) | ~43 条 | 2026-07-20 ~ 2026-08-31 |
| meituan_stores | 2376 条 | - |
| bi_orders | 7538 条 | 2026-08-19 |

---

## 五、核心 API 接口

### 数据上传（Mac 本地 → 云端）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/snapshots/upload` | POST | 支付宝/美团/抖音每日快照上传 |
| `/api/orders/upload` | POST | SmartBI 完成订单 xlsx 上传 |

**鉴权**：请求头 `X-Upload-Token: <DASHBOARD_INGEST_TOKEN>`

当前 Token：`jjd_fe5c49fa365d418956c6f567216d4b8e23d7e9b39c16eaa3`
（环境变量 `DASHBOARD_INGEST_TOKEN`，Mac 和沙箱必须一致）

### 数据读取（看板前端 → 后端）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/data/alipay/full?days=1d\|7d\|30d` | GET | 支付宝聚合数据 |
| `/api/meituan-data` | GET | 美团聚合数据 |
| `/api/meituan-rows` | GET | 美团分页明细 |
| `/api/orders/full?days=1d\|7d\|30d` | GET | 完成订单聚合 |
| `/api/snapshots/latest` | GET | 最新快照 |
| `/api/data/meituan/export` | GET | 美团导出 |

---

## 六、Mac 本地配置（不入 git）

以下文件存在于用户 Mac 的 `~/jiujiujin-dashboard/` 目录，**不提交到 git**，但你需要知道它们的存在：

### 6.1 `.env`

```bash
PGHOST=aws-0-ap-northeast-1.pooler.supabase.com
PGPORT=5432
PGUSER=postgres.uyqlaheofskaannpkhkq
PGPASSWORD=Jiujiujin2026!
PGDATABASE=postgres
PGSSLMODE=require
DASHBOARD_INGEST_TOKEN=jjd_fe5c49fa365d418956c6f567216d4b8e23d7e9b39c16eaa3
DASHBOARD_UPLOAD_URL=https://<当前沙箱域名>/api/snapshots/upload
```

### 6.2 `.alipay-env`（支付宝账密）

```bash
export ALIPAY_USERNAME="支付宝账号"
export ALIPAY_PASSWORD="支付宝密码"
```

### 6.3 `scripts/smartbi/.smartbi-env`（SmartBI 账密）

```bash
export SMARTBI_USERNAME="账号"
export SMARTBI_PASSWORD='密码'
export DASHBOARD_ORDERS_UPLOAD_URL="https://<看板域名>/api/orders/upload"
export DASHBOARD_INGEST_TOKEN="jjd_fe5c49fa365d418956c6f567216d4b8e23d7e9b39c16eaa3"
```

### 6.4 Cookie 文件

- `src/exporters/cookies/alipay-session-cookies.json` — 支付宝登录态
- `src/exporters/cookies/meituan-session-cookies.json` — 美团登录态
- Cookie 有效期较长（设了持久化），但支付宝服务端会话可能几小时失效，需要重新扫码

### 6.5 定时任务（launchd）

| plist 文件 | 时间 | 脚本 |
|-----------|------|------|
| `com.jiujiujin.alipay-daily.plist` | 每天 9:00 | `scripts/alipay-daily.sh` |
| `com.jiujiujin.meituan-daily.plist` | 每天 9:10 | `scripts/meituan-daily.sh` |
| `com.jiujiujin.douyin-daily.plist` | 每天 9:20 | `scripts/douyin-daily.sh` |

**关键策略**：每次运行前 `rm -rf` 浏览器缓存目录，防止 Chromium 崩溃。登录态由独立 Cookie 文件维持，不受影响。

---

## 七、数据流转全链路

```
1. Mac 定时任务触发（launchd 9:00/9:10/9:20）
   ↓
2. Playwright 打开 Chrome → 登录支付宝/美团后台 → 抓取数据
   ↓
3. 保存 JSON 到 src/exporters/output/
   ↓
4. POST 上传到云端看板 /api/snapshots/upload（带 X-Upload-Token）
   ↓
5. 云端接收 → 写入 Supabase platform_snapshots 表
   ↓
6. 前端请求 /api/data/alipay/full?days=7d → 后端聚合 → 返回看板
```

SmartBI 订单链路：
```
1. Python 脚本登录 bi.9999jt.com:18080
2. 导出 xlsx → 解析 → POST /api/orders/upload
3. 写入 bi_orders 表 → 前端展示
```

---

## 八、目录结构

```
├── public/                    # 静态资源
├── scripts/
│   ├── alipay-daily.sh        # 支付宝定时脚本
│   ├── meituan-daily.sh       # 美团定时脚本
│   ├── douyin-daily.sh        # 抖音定时脚本
│   ├── import-bi-orders.ts    # SmartBI 订单导入
│   ├── import-meituan-stores.ts # 美团门店台账导入
│   ├── smartbi/               # SmartBI 自动导出
│   │   ├── smartbi_auto_export.py
│   │   └── smartbi-daily.sh
│   └── launchd/               # macOS launchd plist
├── src/
│   ├── app/
│   │   ├── page.tsx           # 首页
│   │   ├── alipay/page.tsx    # 支付宝看板
│   │   ├── meituan/page.tsx   # 美团看板
│   │   ├── orders/page.tsx    # 完成订单看板
│   │   └── api/               # API 路由
│   ├── components/ui/         # shadcn/ui 组件
│   ├── exporters/             # 数据导出模块（Mac 本地运行）
│   │   ├── alipay.ts          # 支付宝导出器
│   │   ├── meituan.ts         # 美团导出器
│   │   ├── douyin.ts          # 抖音导出器
│   │   ├── cookies/           # Cookie 持久化文件
│   │   └── output/            # 导出数据
│   ├── lib/
│   │   ├── alipay-agg.ts      # 支付宝聚合引擎
│   │   ├── meituan-agg.ts     # 美团聚合引擎
│   │   ├── order-agg.ts       # 订单聚合引擎
│   │   └── meituan-cache.ts   # 美团缓存
│   └── storage/database/
│       ├── pg-client.ts       # pg 直连客户端
│       ├── snapshot-repo.ts   # 快照数据访问
│       └── shared/schema.ts   # 表结构定义
├── docs/
│   ├── handover.md            # 原始交接文档
│   └── architecture.md        # 架构设计
├── AGENTS.md                  # 项目工程规范（重要！）
├── DESIGN.md                  # 设计规范
└── .coze                      # 沙箱配置
```

---

## 九、已知问题与注意事项

### 9.1 美团下载崩溃

Chrome 152 + Playwright 在长时间运行的浏览器实例上可能 SIGSEGV 崩溃。解决方案：每次运行前 `rm -rf src/exporters/browser-profile-meituan`。已在定时脚本中自动执行。

### 9.2 支付宝数据缺口

2026-07-19 ~ 2026-08-16 的支付宝数据无法补回（日期选择器不支持跳选历史日期）。

### 9.3 数据库连接

- 沙箱环境只能用 Session pooler 地址（IPv4）：`aws-0-ap-northeast-1.pooler.supabase.com`
- 不能用直连地址 `db.uyqlaheofskaannpkhkq.supabase.co`（IPv6，沙箱不支持）

### 9.4 上传域名变化

沙箱重启后域名可能变化。如果 Mac 上传失败（404 instance_not_found），需要：
1. 获取当前沙箱域名（在 Coze 预览面板查看）
2. 更新 Mac `.env` 的 `DASHBOARD_UPLOAD_URL`

### 9.5 包管理器

只用 pnpm，严禁 npm/yarn。

### 9.6 Hydration 错误

Next.js 中禁止在 JSX 直接使用 `typeof window`、`Date.now()`、`Math.random()`。必须用 `'use client'` + `useEffect` + `useState`。

### 9.7 字体资源

使用 `fonts.googleapis.cn`（CN 域名），不用全球域名。

---

## 十、日常维护任务

### 每天

- 检查支付宝/美团/抖音数据是否上传成功
- 检查 SmartBI 订单是否回传
- 如有失败，查看 Mac 日志：`~/jiujiujin-dashboard/logs/`

### 每周

- 检查 Supabase 数据库容量（免费版 500MB 限制）
- 检查 Cookie 是否过期（支付宝尤其容易失效）

### 数据缺失补录

- 支付宝：只能手动跑 `npx tsx src/exporters/test-alipay-full.ts`，不支持历史补录
- 美团：`MEITUAN_TARGET_DATE=YYYY-MM-DD npx tsx src/exporters/test-meituan-report.ts`
- SmartBI 订单：上传 xlsx 到 `/api/orders/upload?date=YYYY-MM-DD`

---

## 十一、交接操作清单

新 AI 接手后需要确认的事项：

- [ ] 能正常 clone GitHub 仓库
- [ ] 能连接 Supabase 数据库（验证 `SELECT COUNT(*) FROM platform_snapshots`）
- [ ] 看板能正常启动（`pnpm dev`）
- [ ] 上传 API 可用（Mac 能成功上传数据）
- [ ] 确认 `DASHBOARD_INGEST_TOKEN` 在 Mac 和沙箱一致
- [ ] 确认 `DASHBOARD_UPLOAD_URL` 指向当前沙箱域名

---

## 十二、联系人

- 项目负责人：老叶
- 如有问题直接问他，他会协助协调 Mac 端操作
