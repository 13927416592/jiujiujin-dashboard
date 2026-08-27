# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源（含原型HTML副本）
├── scripts/                # 构建与启动脚本 + 数据导出脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   ├── start.sh            # 生产环境启动脚本
│   └── douyin-export/      # 抖音数据导出脚本（历史/独立运行）
├── docs/                   # 项目文档
│   ├── architecture.md     # 工具架构设计
│   └── handover.md         # 项目交接文档
├── .cozeproj/
│   ├── documents/plan.md   # 实施计划（6个页面详细规格）
│   └── prototype/web/      # 原型HTML文件（6个页面，开发视觉标准）
├── src/
│   ├── app/                # 页面路由与布局
│   │   └── api/export/     # 数据导出API端点
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── exporters/          # 数据导出模块（核心）
│   │   ├── types.ts        # 类型定义（Platform, UnifiedMetrics等）
│   │   ├── douyin.ts       # 抖音导出器（Playwright + API拦截）
│   │   ├── index.ts        # 导出器注册表
│   │   ├── transform.ts    # 数据转换（字段映射、CSV导出）
│   │   └── test-douyin.ts  # 测试脚本
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
├── tsconfig.json           # TypeScript 配置
├── DESIGN.md               # 设计规范（深色毛玻璃风格）
└── .coze                   # 沙箱配置文件
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**
- 设计风格为深色毛玻璃风（Dark Glassmorphism），详见 `DESIGN.md`
- 6个原型HTML页面在 `.cozeproj/prototype/web/` 目录下，是页面开发的视觉标准

## 数据导出模块 (Data Exporters)

- 位置：`src/exporters/`
- 架构：插件化多平台导出器，通过注册表动态管理
- 抖音导出器：Playwright + API拦截，捕获创作者中心13个指标
- 运行测试：`npx tsx src/exporters/test-douyin.ts`
- Cookie管理：`src/exporters/cookies/` 目录（本地持久化 + 会话级 Cookie 强制落盘）。注意：支付宝商家后台**服务端会话有效期仅几小时**，本地强制 Cookie 30 天过期只能让浏览器继续发送，无法让服务端已失效会话复活；隔几小时以上再跑可能需要重新扫码/登录。**长期免登依赖每日定时抓取续期会话**，而非靠一次登录长期保存。
- 导出数据：`src/exporters/output/` 目录
- 详细架构设计：`docs/architecture.md`
- 新增平台步骤：types.ts 添加类型 → 创建导出器 → index.ts 注册 → transform.ts 添加映射

### 日期范围规则（每日明细 + 看板聚合）
- **抓取层只存每日明细**：美团 `MEITUAN_EXPORT_DAYS=1` 与支付宝 `ALIPAY_EXPORT_DAYS=1`（默认）均取"昨天"，
  按天存一条 `platform_snapshots`（唯一键 `(platform, data_date)`）。
- **看板层负责聚合**：前端选择近 1/7/30 日，后端把最近 N 条每日快照求和/取最新/重算比率，
  并产出每日趋势序列。支付宝见 `src/lib/alipay-agg.ts`，美团见 `src/lib/meituan-agg.ts`。
- 历史回填：美团可设 `MEITUAN_EXPORT_DAYS=30`（报表每天一行，自动拆 30 条）。
  支付宝**不做** 30 天逐天抓取（各页是周期汇总且需逐日点选），每天跑一次 `ALIPAY_EXPORT_DAYS=1` 自然累积。
- 支付宝各页日期控件差异（`alipay.ts#applyDateRange` 按文案点"1日"取昨日）：
  - 经营总览/交易分析/流量分析(5 Tab)/粉丝群/小程序分析(概览/流量/交易)：`1日 | 7日 | 30日 | 自然月`
  - 生活号+分析：`1日 | 近7日 | 近30日`
  - 用户分析：只有单日日历，无 1日 切换，取其默认最近一天
- 解析层把"1日交易金额/昨日交易金额"统一归一化为"7日交易金额"字段名（`alipay-parser.ts#normalizeRange`），
  聚合与前端只认一组字段名，不区分抓取口径。

## 支付宝看板与数据聚合

- 聚合引擎：`src/lib/alipay-agg.ts`（纯函数，无 IO，可被 'use client' 组件导入）。
- 接口：`GET /api/data/alipay/full?days=1d|7d|30d`，从 `getLatestSnapshots('alipay', N)`（含 raw_data）
  取最近 N 条每日快照，逐条 `parseAlipayRaw` 后聚合。
- 三类指标聚合规则（`OVERVIEW_SPECS` / `TRAFFIC_SPECS`）：
  - **additive（可加）**：交易金额/笔数/访问用户数/活跃用户数等 → N 天求和。
  - **stock（存量/时点）**：累计用户资产/累计访问用户数等 → 取最近一天非空值。
  - **ratio（比率）**：客单价/笔单价/人均交易笔数用 N 天分子÷分母重算（如客单价=Σ交易金额÷Σ交易用户数）；
    转化率/留存率/人均时长等无明确分子分母的按有值日均值。
- 字段名按是否含"率/占比"判定为百分数展示，其余按数值/万展示。
- 前端：`src/app/alipay/page.tsx`，顶部近 1/7/30 日切换，KPI 显示范围汇总值，下方内联 SVG 每日趋势折线图；
  数据不足 7/30 天时按实际天数展示并提示"仅 N 天数据"。

## 客户回收完成订单模块（SmartBI 闭环）

打通"流量→客资→成交"闭环：各平台（支付宝/美团/抖音）来的流量最终转化成的**完成订单**来自久久金 SmartBI 报表系统「yxd-门店每日完成订单统计」。

### 数据来源与口径
- 报表是**订单明细行**：表头在第4行（前3行是筛选条件），列：订单编号/门店名称/小程序名称/回收付款/渠道名称/来源名称/回收毛重/回收净重。
- **一单多行**：一个订单编号可对应多条回收物明细（最多13条），金额/克重是行级。因此**订单数 = count(distinct order_no)**，金额 = sum(amount)。
- 订单编号前6位 = YYMMDD **建单日**（非完成日）。报表"年月日"筛选的是**完成日期**。
  - 日度导出：所有行完成日相同 → `data_date` 用筛选日期，`date_basis='completed'`（精确）。
  - 月度回填：无逐行完成日，用建单日近似，`date_basis='created-seed'`，前端会显示提示。
- 状态筛选固定为"回收：已完成（同意）"，只统计已完成单。

### 表结构（bi_orders）
- 定义：`src/storage/database/shared/schema.ts` 的 `biOrders`；建表 SQL 在 `src/storage/database/ensure-bi-orders.ts`（幂等，上传/导入前自动执行）。
- 唯一键 `(order_no, line_no)`；金额 `amount` 行级；`platform`（成交平台）与 `source_group`（获客来源）是两套归一化维度。
- 走 `pg` 直连（`src/storage/database/pg-client.ts`），与其他模块一致。

### 模块文件
- 解析：`src/exporters/bi-order-parser.ts`（纯函数；`parseBiOrdersWorkbook(path)` 给 CLI，`parseBiOrdersBuffer(buf)` 给上传接口）。含 `normalizePlatform`（小程序→alipay/wechat/meituan/xinsai/other）、`normalizeSourceGroup`（来源→douyin/meituan/dianping/alipay/wechat/xiaohongshu/doubao/map/referral/repeat/walkin/other）。
- 数据访问：`src/storage/database/order-repo.ts`。`replaceDateForImport(date, lines)` 日度整日替换（先删后插，事务，幂等）；`upsertOrderLines(lines)` 月度回填；`getOrderRows(days, filter)` 取近N天明细。
- 聚合：`src/lib/order-agg.ts`（纯函数，可被 'use client' 导入）。输出 KPI（订单数/金额/克重/客单价/线上占比）、byPlatform、bySource、topStores、trend。客单价=Σ金额/Σ唯一订单数。
- API：
  - `GET /api/orders/full?days=1d|7d|30d&platform=&source=&store=`：聚合输出 + 上一周期 KPI（算环比）。
  - `POST /api/orders/upload`：multipart 上传 xlsx，字段 `file` 必填、`date=YYYY-MM-DD` 可选（传=日度整日替换，不传=月度回填）。**从内存 Buffer 解析**，不要落盘（沙箱落盘跨进程不可见）。
    - **鉴权**：同源浏览器请求放行（页面手动补传）；跨域脚本回传必须带请求头 `X-Upload-Token: $DASHBOARD_INGEST_TOKEN`（与 `/api/snapshots/upload` 同一共享密钥）。
- 前端：`src/app/orders/page.tsx`（毛玻璃看板），图表 `src/app/orders/charts.tsx`（recharts）。首页第3张卡片"客户回收订单"入口。
- 导入脚本：`npx tsx scripts/import-bi-orders.ts <xlsx> [--date=YYYY-MM-DD | --seed]`。建表：`npx tsx scripts/ensure-bi-orders-table.ts`。
- **每日自动导出（SmartBI）**：`scripts/smartbi/smartbi_auto_export.py`（Python+Playwright，headless，登录 bi.9999jt.com:18080 → 搜报表 → 设昨天 → 导 xlsx → 回传看板）+ `scripts/smartbi/smartbi-daily.sh`（cron 包装，失败飞书告警）。凭据走 `scripts/smartbi/.smartbi-env`（不入库）：`SMARTBI_USERNAME/SMARTBI_PASSWORD/DASHBOARD_ORDERS_UPLOAD_URL/DASHBOARD_INGEST_TOKEN`。详见 `docs/handover.md` 5.4。

### 与各平台看板的闭环关系
- `platform`（小程序成交渠道）直接对齐支付宝/美团看板：支付宝小程序成交、美团小程序成交。
- `source_group`（开单手选获客来源）用于跨平台 ROI 归因：抖音/小红书/豆包/地图等内容与投放来源最终成交了多少。
- 门店名含 `NO.xxx` 的解析为 `store_code`（`线上-XX店NO.xxx` 也算线上单 `is_online=1`），可与美团门店台账做跨表关联。

## 美团看板与数据聚合

- 聚合引擎：`src/lib/meituan-agg.ts`（COL 列名、筛选、KPI/漏斗/趋势/ROI/排行/城市/服务质量/门店状态分布，全部服务端算好）
- 纯类型：`src/lib/meituan-agg-types.ts`（可被 'use client' 组件导入）
- 接口：`GET /api/meituan-data`（聚合）、`GET /api/meituan-rows`（分页明细），均支持 from/to/province/city/store/business_status
- 快照缓存：`src/lib/meituan-cache.ts`（TTL 60s + 指纹 + in-flight 去重）；新数据上传后 `invalidateMeituanCache()`
- 门店台账：表 `meituan_stores`（schema 见 `src/storage/database/shared/schema.ts`），按点评门店ID关联经营数据，提供营业状态
  - 台账缓存：`src/lib/meituan-store-cache.ts`（TTL 5min，直连 Postgres 一次性拉全量）

## 数据库访问（Postgres 直连）

- **必须走 `pg` 直连**：服务端数据访问统一使用 `src/storage/database/pg-client.ts` 的 `query/queryRow/queryRows/getPool`，**不要再用 `@supabase/supabase-js` 读写数据**。
- 原因：Supabase 的 PostgREST REST 网关间歇性 502（"invalid response from the upstream server"），但底层 Postgres 引擎稳定；直连原生 TCP 从源头绕开该网关。
- 连接信息由平台在运行时注入（`PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` 或 `PGDATABASE_URL`），`pg-client` 自动读取，**禁止硬编码**。
- 写入用参数化 SQL（`$1,$2...`）+ `ON CONFLICT ... DO UPDATE` 实现 upsert；`platform_snapshots` 唯一键是 `(platform, data_date)`，`meituan_stores` 主键是 `store_id`。
- `snapshot-repo.ts`、`meituan-store-cache.ts`、`scripts/import-meituan-stores.ts` 均已改为直连，可作为写法参考。
- `supabase-client.ts` 仅保留 `loadEnv` 供连接配置复用，不再用于数据读写。
  - 导入脚本：`npx tsx scripts/import-meituan-stores.ts <xlsx路径>`（该 xlsx 的 dimension 标记错误，脚本会扫描单元格地址重算 !ref）
  - 营业状态分布在 `aggregate().storeStatus`；明细行带 `status`；前端可按状态筛选
- 转化漏斗同口径：曝光→访问→下单（核销含跨期核销，不放入漏斗末级）

## 项目交接

- 交接文档：`docs/handover.md`（完整进度、文件说明、使用说明、后续建议）
- 实施计划：`.cozeproj/documents/plan.md`（6个页面详细规格）
