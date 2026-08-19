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
- Cookie管理：`src/exporters/cookies/` 目录，有效期约7天
- 导出数据：`src/exporters/output/` 目录
- 详细架构设计：`docs/architecture.md`
- 新增平台步骤：types.ts 添加类型 → 创建导出器 → index.ts 注册 → transform.ts 添加映射

## 美团看板与数据聚合

- 聚合引擎：`src/lib/meituan-agg.ts`（COL 列名、筛选、KPI/漏斗/趋势/ROI/排行/城市/服务质量/门店状态分布，全部服务端算好）
- 纯类型：`src/lib/meituan-agg-types.ts`（可被 'use client' 组件导入）
- 接口：`GET /api/meituan-data`（聚合）、`GET /api/meituan-rows`（分页明细），均支持 from/to/province/city/store/business_status
- 快照缓存：`src/lib/meituan-cache.ts`（TTL 60s + 指纹 + in-flight 去重）；新数据上传后 `invalidateMeituanCache()`
- 门店台账：表 `meituan_stores`（schema 见 `src/storage/database/shared/schema.ts`），按点评门店ID关联经营数据，提供营业状态
  - 台账缓存：`src/lib/meituan-store-cache.ts`（TTL 5min，**必须分页**拉取，Supabase 单次最多 1000 行）
  - 导入脚本：`npx tsx scripts/import-meituan-stores.ts <xlsx路径>`（该 xlsx 的 dimension 标记错误，脚本会扫描单元格地址重算 !ref）
  - 营业状态分布在 `aggregate().storeStatus`；明细行带 `status`；前端可按状态筛选
- 转化漏斗同口径：曝光→访问→下单（核销含跨期核销，不放入漏斗末级）

## 项目交接

- 交接文档：`docs/handover.md`（完整进度、文件说明、使用说明、后续建议）
- 实施计划：`.cozeproj/documents/plan.md`（6个页面详细规格）
