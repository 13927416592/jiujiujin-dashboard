# 久久金数据看板 - 项目交接文档

> 交接人：老叶 → 小壹
> 更新日期：2026-08-06

---

## 一、项目概述

久久金运营部整体数据看板，覆盖8大业务模块（美团、高德、图文线、短视频、小红书、GEO、私域、储备渠道）及跨部门协同数据。目标：**管理层汇报展示 + 日常运营监控**双重场景。

### 技术栈

| 维度 | 选择 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 核心 | React 19 + TypeScript 5 |
| UI 组件 | shadcn/ui (Radix UI) |
| 样式 | Tailwind CSS 4 |
| 设计风格 | 深色毛玻璃风 (Dark Glassmorphism) |
| 数据导出 | Playwright + API 拦截 |
| 包管理 | pnpm（严禁 npm/yarn） |

---

## 二、当前进度

### 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| 原型设计 | ✅ 完成 | 6个HTML原型页面，深色毛玻璃风格统一 |
| 风格统一 | ✅ 完成 | 所有页面Design Token、图标、卡片、导航统一 |
| 内容矩阵CSV导入 | ✅ 完成 | 原型中已实现CSV导入交互（账号基础信息+月度运营数据） |
| 抖音数据导出 | ✅ 完成 | Playwright + API拦截，支持13个指标自动捕获 |
| 数据转换逻辑 | ✅ 完成 | 双格式兼容（新metrics数组 + 旧data对象） |
| 工具架构设计 | ✅ 完成 | 四层架构（导出层→处理层→应用层→基础设施层） |
| 导出器注册表 | ✅ 完成 | 插件化多平台扩展机制 |

### 待完成

| 模块 | 优先级 | 说明 |
|------|--------|------|
| Next.js 页面开发 | P0 | 原型已就绪，需将6个HTML原型转为Next.js页面 |
| 数据库设计 | P0 | 用户/角色/权限管理 + 数据存储 |
| 真实数据对接 | P1 | 将导出的抖音数据接入看板页面 |
| 视频号导出器 | P1 | Playwright RPA 方式 |
| 快手/小红书导出器 | P1 | CSV 导入方式 |
| CSV导入功能 | P1 | 上传→解析→预览→入库完整流程 |
| 定时任务 | P2 | 自动执行数据导出（cron调度） |
| 预警通知 | P2 | 指标异常时自动通知 |

---

## 三、项目结构

```
/workspace/projects/
├── .cozeproj/
│   └── documents/
│       └── plan.md                    # 实施计划（6个页面详细规格）
├── .cozeproj/prototype/web/           # 原型HTML文件（6个页面）
│   ├── home.html                      # 总览仪表盘
│   ├── meituan.html                   # 美团运营
│   ├── content.html                   # 内容矩阵（含CSV导入）
│   ├── private-domain.html            # 私域运营
│   ├── collaboration.html             # 跨部门协同
│   └── actions.html                   # 行动计划
├── public/                            # 原型副本（用于预览）
├── docs/
│   └── architecture.md                # 完整工具架构设计
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # 全局布局（待开发）
│   │   ├── page.tsx                   # 首页（待开发）
│   │   └── api/export/route.ts        # 数据导出API端点
│   ├── exporters/                     # 数据导出模块（核心）
│   │   ├── types.ts                   # 类型定义（Platform, UnifiedMetrics等）
│   │   ├── douyin.ts                  # 抖音导出器（Playwright + API拦截）
│   │   ├── index.ts                   # 导出器注册表
│   │   ├── transform.ts              # 数据转换（字段映射、CSV导出）
│   │   ├── test-douyin.ts            # 测试脚本
│   │   ├── cookies/                   # Cookie文件目录
│   │   └── output/                    # 导出数据目录
│   ├── components/ui/                 # shadcn/ui 组件库
│   ├── hooks/                         # 自定义Hooks
│   └── lib/utils.ts                   # 工具函数
├── scripts/
│   └── douyin-export/                 # 原始抖音导出脚本（历史）
│       ├── douyin-export-api.ts       # API拦截方式（可独立运行）
│       ├── batch-export.ts            # 批量导出脚本
│       └── cookies/                   # Cookie文件
├── DESIGN.md                          # 设计规范
├── AGENTS.md                          # 项目工程规范
└── .coze                              # 沙箱配置文件
```

---

## 四、关键文件说明

### 4.1 原型文件（.cozeproj/prototype/web/）

6个HTML原型页面，采用深色毛玻璃风格，是所有页面开发的视觉标准。开发时必须严格参照原型的布局、配色、间距、组件样式。

### 4.2 数据导出模块（src/exporters/）

**核心文件**：

- `types.ts` — 统一类型定义，包含 `Platform`、`UnifiedMetrics`、`RawData`、`PlatformExporter` 接口
- `douyin.ts` — 抖音导出器，使用 Playwright 打开创作者中心页面，拦截 API 响应
- `transform.ts` — 数据转换，将原始API数据转为统一格式，支持CSV导出
- `index.ts` — 导出器注册表，支持动态注册新平台

**抖音API数据结构**（已验证）：

```
GET /aweme/janus/creator/data/overview/dashboard

响应: {
  status_code: 0,
  metrics: [
    { english_metric_name: "total_fans_cnt", metric_name: "总粉丝量", metric_value: 620, trends: [...] },
    { english_metric_name: "play_cnt", metric_name: "播放量", metric_value: 181, trends: [...] },
    ... 共13个指标
  ]
}
```

**13个已对接指标**：总粉丝量、净增粉丝、取关粉丝、播放量、作品点赞、作品评论、作品分享、主页访问、投稿量、5秒完播率、2秒跳出率、平均播放时长、封面点击率

### 4.3 设计规范（DESIGN.md）

```
背景: #080B14
主色: #7C5CFF
强调色: #69E7FF
成功色: #62FAD3
文本: #F7FAFF / #9AA7C7
玻璃层: rgba(255,255,255,.08)
字体: Inter / Manrope / SF Pro
```

---

## 五、数据导出工具使用

### 5.1 抖音数据导出

**前置条件**：
1. 需要有效的抖音创作者中心 Cookie（登录态）
2. Cookie 文件放在 `src/exporters/cookies/account1.json`
3. 已安装 Playwright：`npx playwright install chromium`

**运行方式**：
```bash
# 方式1：通过测试脚本（推荐）
npx tsx src/exporters/test-douyin.ts

# 方式2：通过原始脚本（独立运行）
npx tsx scripts/douyin-export/douyin-export-api.ts

# 方式3：通过API端点（需服务运行中）
curl -X POST -H 'Content-Type: application/json' \
  -d '{"platform":"douyin"}' \
  http://localhost:5000/api/export/run
```

**输出文件**：
- 原始数据：`src/exporters/output/douyin_raw_*.json`
- 统一格式：`src/exporters/output/douyin_unified_*.csv`

### 5.2 Cookie 获取方法

1. Chrome 安装 Cookie-Editor 扩展
2. 登录抖音创作者中心 `https://creator.douyin.com`
3. 点击 Cookie-Editor → Export → 复制 JSON
4. 保存到 `src/exporters/cookies/account1.json`

**注意**：Cookie 有效期约7天，过期后需重新获取。

### 5.3 门店账号范围

门店账号只覆盖4个平台：**抖音、视频号、快手、小红书**（不含微博、B站、支付宝、高德）

---

## 六、后续开发建议

### 6.1 优先级排序

1. **Next.js 页面开发**：将6个HTML原型转为Next.js页面，严格参照原型样式
2. **数据库 + 用户认证**：Supabase 或 PostgreSQL，实现角色权限（超级管理员/运营经理/模块负责人/门店管理员）
3. **真实数据对接**：将导出的抖音数据接入看板，替换Mock数据
4. **其他平台导出器**：视频号（RPA）、快手/小红书（CSV导入）
5. **定时任务**：cron 自动执行数据导出

### 6.2 新增平台导出器的步骤

1. 在 `src/exporters/types.ts` 的 `Platform` 类型中添加新平台
2. 创建 `src/exporters/{platform}.ts`，实现 `PlatformExporter` 接口
3. 在 `src/exporters/index.ts` 中注册新导出器
4. 更新 `transform.ts` 添加字段映射

### 6.3 权限模型（已规划）

| 角色 | 权限 |
|------|------|
| 超级管理员 | 全部数据 + 系统配置 |
| 运营经理 | 全部模块数据 + 导出权限 |
| 模块负责人 | 本模块数据 + 导入权限 |
| 门店管理员 | 本门店数据 + 查看权限 |

---

## 七、注意事项

1. **包管理器**：只用 pnpm，严禁 npm/yarn
2. **端口**：服务必须监听 `${DEPLOY_RUN_PORT}` 环境变量，禁止硬编码
3. **Cookie 安全**：Cookie 文件包含登录凭证，不要提交到 git
4. **Hydration**：Next.js 中禁止在 JSX 直接使用 `typeof window`、`Date.now()` 等，必须用 `'use client'` + `useEffect` + `useState`
5. **字体资源**：使用 `fonts.googleapis.cn`（CN域名），不要使用全球域名
6. **设计风格**：所有新页面必须遵循深色毛玻璃风格，参照 DESIGN.md 和原型HTML

---

## 八、联系人

- 项目负责人：老叶
- 开发交接：小壹
- 数据来源：运营部工作汇报PDF（2份，已在项目初期提供）
