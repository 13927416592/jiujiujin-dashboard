# 久久金数据工具架构设计

## 一、系统概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    久久金数据工具 v1.0                           │
│                  (Jiujiujin Data Toolkit)                       │
├─────────────────────────────────────────────────────────────────
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  数据导出层   │  │  数据处理层   │  │  数据应用层   │         │
│  │   (Export)   │→ │  (Process)   │→ │   (Apply)    │         │
│  └──────────────  └──────────────┘  └──────────────┘         │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ • 抖音 API   │  │ • 字段映射   │  │ • 数据看板   │         │
│  │ • 视频号 RPA │  │ • 数据清洗   │  │ • 预警通知   │         │
│  │ • 快手 CSV   │  │ • 时间聚合   │  │ • 报表导出   │         │
│  │ • 小红书 CSV │  │ • 异常检测   │  │ • 权限管理   │         │
│  └──────────────┘  ──────────────┘  └──────────────┘         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────     │
│  │              基础设施层 (Infrastructure)              │     │
│  │  • 定时任务调度  • 日志系统  • 配置管理  • 用户认证   │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、模块详细设计

### 2.1 数据导出层 (Export Layer)

#### 2.1.1 抖音导出模块

```typescript
// src/exporters/douyin.ts
interface DouyinExporter {
  // 账号总览数据
  exportOverview(): Promise<OverviewData>;
  
  // 作品分析数据
  exportWorksAnalysis(): Promise<WorksData[]>;
  
  // 粉丝分析数据
  exportFansAnalysis(): Promise<FansData>;
  
  // 直播数据
  exportLiveStream(): Promise<LiveData[]>;
}

interface OverviewData {
  accountId: string;
  accountName: string;
  platform: 'douyin';
  timestamp: Date;
  metrics: {
    totalFans: number;
    netFansGrowth: number;
    unfollowCount: number;
    playCount: number;
    likeCount: number;
    shareCount: number;
    pageViews: number;
    completionRate5s: number;
    bounceRate2s: number;
    avgPlayDuration: number;
  };
}
```

**实现方式**：
- Playwright + API 拦截（当前已实现）
- 支持 Cookie 登录态管理
- 自动重试机制（最多 3 次）

#### 2.1.2 视频号导出模块

```typescript
// src/exporters/wechat-channels.ts
interface WechatChannelsExporter {
  // 通过 RPA 方式导出
  exportViaRPA(): Promise<ChannelsData>;
  
  // 手动 CSV 导入
  importFromCSV(filePath: string): Promise<ChannelsData>;
}
```

**实现方式**：
- 优先尝试 API（如果有）
- RPA 自动化（Playwright）
- 手动 CSV 导入（兜底方案）

#### 2.1.3 快手/小红书导出模块

```typescript
// src/exporters/kuaishou-xiaohongshu.ts
interface ManualCSVExporter {
  platform: 'kuaishou' | 'xiaohongshu';
  
  // 下载平台 CSV 模板
  downloadTemplate(): Promise<Buffer>;
  
  // 解析上传的 CSV
  parseCSV(filePath: string): Promise<PlatformData>;
  
  // 字段映射（平台字段→统一字段）
  mapFields(rawData: RawData): UnifiedData;
}
```

#### 2.1.4 导出调度器

```typescript
// src/exporters/scheduler.ts
interface ExportScheduler {
  // 执行所有平台导出
  exportAll(): Promise<ExportResult>;
  
  // 执行指定平台导出
  exportPlatform(platform: Platform): Promise<ExportResult>;
  
  // 导出结果
  interface ExportResult {
    success: boolean;
    platform: Platform;
    data: UnifiedData;
    error?: string;
    timestamp: Date;
  }
}
```

---

### 2.2 数据处理层 (Process Layer)

#### 2.2.1 字段映射器

```typescript
// src/processors/field-mapper.ts
interface FieldMapper {
  // 平台字段 → 统一字段
  map(platform: Platform, rawData: RawData): UnifiedData;
  
  // 统一字段 → 平台字段（用于导出）
  reverseMap(platform: Platform, unifiedData: UnifiedData): RawData;
}

// 字段映射配置
const fieldMappings: Record<Platform, FieldMapping> = {
  douyin: {
    '总粉丝量': 'totalFans',
    '净增粉丝': 'netFansGrowth',
    '播放量': 'playCount',
    '5 秒完播率': 'completionRate5s',
    // ...
  },
  wechat: {
    '粉丝总数': 'totalFans',
    '新增粉丝': 'netFansGrowth',
    // ...
  },
  // ...
};
```

#### 2.2.2 数据清洗器

```typescript
// src/processors/data-cleaner.ts
interface DataCleaner {
  // 去除重复数据
  deduplicate(data: UnifiedData[]): UnifiedData[];
  
  // 填充缺失值
  fillMissing(data: UnifiedData[]): UnifiedData[];
  
  // 异常值检测
  detectAnomalies(data: UnifiedData[]): AnomalyReport;
  
  // 数据标准化（百分比、单位等）
  normalize(data: UnifiedData[]): UnifiedData[];
}

interface AnomalyReport {
  anomalies: {
    field: string;
    value: any;
    reason: string;
    severity: 'low' | 'medium' | 'high';
  }[];
  totalRecords: number;
  anomalyCount: number;
}
```

#### 2.2.3 时间聚合器

```typescript
// src/processors/time-aggregator.ts
interface TimeAggregator {
  // 日数据 → 周数据
  aggregateToWeekly(dailyData: DailyData[]): WeeklyData[];
  
  // 日数据 → 月数据
  aggregateToMonthly(dailyData: DailyData[]): MonthlyData[];
  
  // 自定义时间范围
  aggregateByRange(data: DailyData[], range: 'week' | 'month' | 'quarter'): AggregatedData[];
}
```

#### 2.2.4 数据验证器

```typescript
// src/processors/data-validator.ts
interface DataValidator {
  // 验证数据完整性
  validateCompleteness(data: UnifiedData): ValidationResult;
  
  // 验证数据合理性
  validateReasonableness(data: UnifiedData): ValidationResult;
  
  // 验证结果
  interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  }
}
```

---

### 2.3 数据应用层 (Apply Layer)

#### 2.3.1 数据看板 API

```typescript
// src/api/dashboard.ts
interface DashboardAPI {
  // 获取总览数据
  getOverview(filters: DashboardFilters): Promise<OverviewResponse>;
  
  // 获取平台数据
  getPlatformData(platform: Platform, filters: DashboardFilters): Promise<PlatformResponse>;
  
  // 获取门店数据
  getStoreData(storeId: string, filters: DashboardFilters): Promise<StoreResponse>;
  
  // 获取趋势数据
  getTrendData(metric: MetricKey, filters: TrendFilters): Promise<TrendResponse>;
}

interface DashboardFilters {
  platform?: Platform;
  storeId?: string;
  dateRange: {
    start: Date;
    end: Date;
  };
  granularity: 'day' | 'week' | 'month';
}
```

#### 2.3.2 数据导入 API

```typescript
// src/api/import.ts
interface ImportAPI {
  // CSV 文件导入
  importCSV(file: File, options: ImportOptions): Promise<ImportResult>;
  
  // 批量导入
  batchImport(files: File[], options: ImportOptions): Promise<BatchImportResult>;
  
  // 导入选项
  interface ImportOptions {
    platform: Platform;
    dataType: 'accounts' | 'metrics' | 'works';
    skipDuplicates: boolean;
    autoMapFields: boolean;
  }
  
  // 导入结果
  interface ImportResult {
    success: boolean;
    importedCount: number;
    skippedCount: number;
    errors: ImportError[];
  }
}
```

#### 2.3.3 预警系统

```typescript
// src/api/alerts.ts
interface AlertSystem {
  // 配置预警规则
  configureRules(rules: AlertRule[]): Promise<void>;
  
  // 检查预警
  checkAlerts(data: UnifiedData[]): Promise<AlertReport>;
  
  // 发送通知
  sendNotification(alert: Alert): Promise<void>;
}

interface AlertRule {
  id: string;
  name: string;
  metric: MetricKey;
  condition: 'lt' | 'gt' | 'eq' | 'between';
  threshold: number | [number, number];
  severity: 'info' | 'warning' | 'critical';
  notifyChannels: ('email' | 'wechat' | 'sms')[];
}

interface AlertReport {
  triggeredAlerts: Alert[];
  checkedAt: Date;
  totalRules: number;
  triggeredCount: number;
}
```

---

### 2.4 基础设施层 (Infrastructure)

#### 2.4.1 定时任务调度

```typescript
// src/infra/scheduler.ts
interface TaskScheduler {
  // 添加定时任务
  addTask(task: ScheduledTask): Promise<string>;
  
  // 移除定时任务
  removeTask(taskId: string): Promise<void>;
  
  // 手动触发任务
  triggerTask(taskId: string): Promise<TaskResult>;
  
  // 获取任务状态
  getTaskStatus(taskId: string): Promise<TaskStatus>;
}

interface ScheduledTask {
  id: string;
  name: string;
  cron: string; // cron 表达式
  handler: () => Promise<TaskResult>;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

// 预设任务
const defaultTasks: ScheduledTask[] = [
  {
    id: 'daily-export',
    name: '每日数据导出',
    cron: '0 3 * * *', // 每天凌晨 3 点
    handler: exportAllPlatforms,
    enabled: true,
  },
  {
    id: 'weekly-report',
    name: '每周数据报告',
    cron: '0 9 * * 1', // 每周一上午 9 点
    handler: generateWeeklyReport,
    enabled: true,
  },
  {
    id: 'alert-check',
    name: '预警检查',
    cron: '0 */6 * * *', // 每 6 小时检查一次
    handler: checkAlerts,
    enabled: true,
  },
];
```

#### 2.4.2 日志系统

```typescript
// src/infra/logger.ts
interface Logger {
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;
}

// 日志级别
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// 日志存储
interface LogStorage {
  // 写入日志
  write(log: LogEntry): Promise<void>;
  
  // 查询日志
  query(filters: LogFilters): Promise<LogEntry[]>;
  
  // 清理旧日志
  cleanup(daysToKeep: number): Promise<void>;
}
```

#### 2.4.3 配置管理

```typescript
// src/infra/config.ts
interface ConfigManager {
  // 获取配置
  get(key: string): any;
  
  // 设置配置
  set(key: string, value: any): Promise<void>;
  
  // 获取平台配置
  getPlatformConfig(platform: Platform): PlatformConfig;
  
  // 更新 Cookie
  updateCookie(platform: Platform, cookie: Cookie[]): Promise<void>;
}

interface PlatformConfig {
  platform: Platform;
  enabled: boolean;
  exportMethod: 'api' | 'rpa' | 'csv';
  cookie?: Cookie[];
  schedule?: string;
  retryCount?: number;
}
```

#### 2.4.4 用户认证与权限

```typescript
// src/infra/auth.ts
interface AuthSystem {
  // 用户登录
  login(credentials: LoginCredentials): Promise<AuthToken>;
  
  // 验证 Token
  verifyToken(token: string): Promise<UserInfo>;
  
  // 权限检查
  checkPermission(userId: string, permission: Permission): Promise<boolean>;
}

interface UserInfo {
  id: string;
  username: string;
  role: 'admin' | 'manager' | 'operator' | 'viewer';
  permissions: Permission[];
  dataScope: {
    platforms?: Platform[];
    stores?: string[];
  };
}

// 权限定义
enum Permission {
  // 数据查看
  VIEW_DASHBOARD = 'view:dashboard',
  VIEW_PLATFORM = 'view:platform',
  VIEW_STORE = 'view:store',
  
  // 数据导入
  IMPORT_DATA = 'import:data',
  EXPORT_DATA = 'export:data',
  
  // 系统管理
  MANAGE_USERS = 'manage:users',
  MANAGE_CONFIG = 'manage:config',
  MANAGE_ALERTS = 'manage:alerts',
}
```

---

## 三、数据流设计

### 3.1 完整数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据流 (Data Flow)                        │
└─────────────────────────────────────────────────────────────────┘

1. 数据采集
   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
   │  抖音 API    │     │  视频号 RPA  │     │  快手 CSV    │
   ──────┬───────┘     ──────┬───────┘     ──────┬───────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │   原始数据池 (Raw)    │
                    │  /data/raw/{date}/   │
                    └─────────────────────┘
                               │
                               ▼
2. 数据处理
                    ┌─────────────────────
                    │   字段映射 (Mapper)   │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   数据清洗 (Cleaner)  │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   数据验证 (Validator) │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  统一数据池 (Unified) │
                    │ /data/unified/{date}/│
                    └─────────────────────┘
                               │
                               ▼
3. 数据应用
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │  数据看板     │    │  预警系统     │    │  报表导出     │
   │  Dashboard   │    │   Alerts     │    │   Reports    │
   ──────────────┘    └──────────────┘    └──────────────┘
```

### 3.2 数据格式定义

```typescript
// 统一数据格式
interface UnifiedData {
  // 基础信息
  id: string;
  platform: Platform;
  accountId: string;
  accountName: string;
  accountType: 'brand' | 'store' | 'matrix';
  storeId?: string;
  
  // 时间信息
  date: Date;
  period: 'day' | 'week' | 'month';
  
  // 粉丝数据
  metrics: {
    totalFans: number;
    netFansGrowth: number;
    unfollowCount: number;
    newFollowers: number;
  };
  
  // 内容数据
  content: {
    playCount: number;
    likeCount: number;
    commentCount: number;
    shareCount: number;
    collectCount: number;
    publishCount: number;
  };
  
  // 质量数据
  quality: {
    completionRate5s: number;
    bounceRate2s: number;
    avgPlayDuration: number;
    pageViews: number;
  };
  
  // 元数据
  metadata: {
    source: 'api' | 'rpa' | 'csv';
    exportedAt: Date;
    processedAt?: Date;
    quality: 'high' | 'medium' | 'low';
  };
}
```

---

## 四、目录结构设计

```
/workspace/projects/
├── src/
│   ├── exporters/              # 数据导出层
│   │   ├── douyin.ts          # 抖音导出
│   │   ├── wechat-channels.ts # 视频号导出
│   │   ├── kuaishou.ts        # 快手导出
│   │   ├── xiaohongshu.ts     # 小红书导出
│   │   ├── scheduler.ts       # 导出调度器
│   │   ── types.ts           # 导出类型定义
│   │
│   ├── processors/             # 数据处理层
│   │   ├── field-mapper.ts    # 字段映射
│   │   ├── data-cleaner.ts    # 数据清洗
│   │   ├── time-aggregator.ts # 时间聚合
│   │   ├── data-validator.ts  # 数据验证
│   │   └── types.ts           # 处理类型定义
│   │
│   ├── api/                    # 数据应用层
│   │   ├── dashboard.ts       # 看板 API
│   │   ├── import.ts          # 导入 API
│   │   ├── alerts.ts          # 预警 API
│   │   └── types.ts           # API 类型定义
│   │
│   ├── infra/                  # 基础设施层
│   │   ├── scheduler.ts       # 定时任务
│   │   ├── logger.ts          # 日志系统
│   │   ├── config.ts          # 配置管理
│   │   ├── auth.ts            # 用户认证
│   │   └── storage.ts         # 数据存储
│   │
│   ├── app/                    # Next.js 页面
│   │   ├── api/               # API Routes
│   │   │   ├── export/        # 导出接口
│   │   │   ├── import/        # 导入接口
│   │   │   ├── dashboard/     # 看板接口
│   │   │   └── alerts/        # 预警接口
│   │   └── pages/             # 页面组件
│   │       ├── dashboard/     # 数据看板
│   │       ├── import/        # 数据导入
│   │       ├── alerts/        # 预警管理
│   │       └── settings/      # 系统设置
│   │
│   └── lib/                    # 工具库
│       ├── csv.ts             # CSV 处理
│       ├── date.ts            # 日期处理
│       └── utils.ts           # 通用工具
│
├── scripts/                    # 脚本目录
│   ├── douyin-export/         # 抖音导出脚本（已有）
│   │   ├── douyin-export-api.ts
│   │   ├── cookies/
│   │   └── downloads/
│   │
│   ├── data-toolkit/          # 数据工具脚本
│   │   ├── export-all.ts      # 全平台导出
│   │   ├── transform.ts       # 数据转换
│   │   ├── import.ts          # 数据导入
│   │   └── check-alerts.ts    # 预警检查
│   │
│   └── cron/                  # 定时任务脚本
│       ├── daily-export.sh    # 每日导出
│       └── weekly-report.sh   # 每周报告
│
├── data/                       # 数据目录
│   ├── raw/                   # 原始数据
│   │   └── 2026-08-05/
│   ├── unified/               # 统一数据
│   │   └── 2026-08-05/
│   ── exports/               # 导出报表
│       └── weekly-2026-08-05.pdf
│
── config/                     # 配置文件
│   ├── platforms.json         # 平台配置
│   ├── alerts.json            # 预警规则
│   ── schedule.json          # 任务调度
│
└── docs/                       # 文档
    ├── architecture.md        # 架构文档（本文件）
    ├── api.md                 # API 文档
    ├── deployment.md          # 部署文档
    └── user-guide.md          # 用户指南
```

---

## 五、技术选型

| 模块 | 技术 | 说明 |
|------|------|------|
| **后端框架** | Next.js 16 App Router | 全栈框架，API Routes + 页面 |
| **数据库** | Supabase (PostgreSQL) | 关系型数据库 + 实时订阅 |
| **ORM** | Prisma | 类型安全的数据库访问 |
| **定时任务** | node-cron | 轻量级任务调度 |
| **日志系统** | Pino | 高性能日志库 |
| **CSV 处理** | csv-parse / csv-stringify | 流式 CSV 处理 |
| **浏览器自动化** | Playwright | 跨浏览器自动化 |
| **前端图表** | ECharts / Recharts | 数据可视化 |
| **UI 组件** | shadcn/ui | 统一设计规范 |
| **认证授权** | Supabase Auth | 用户认证 + 权限管理 |
| **文件存储** | Supabase Storage | CSV 文件存储 |
| **部署** | Vercel / 自建服务器 | 生产环境部署 |

---

## 六、实施路线图

### Phase 1: 基础架构（2 周）

| 任务 | 交付物 | 周期 |
|------|--------|------|
| 1.1 项目结构搭建 | 目录结构 + 配置文件 | 2 天 |
| 1.2 数据库设计 | Supabase 表结构 + Prisma Schema | 2 天 |
| 1.3 用户认证 | 登录/注册 + 权限系统 | 3 天 |
| 1.4 日志系统 | 日志记录 + 查询 | 1 天 |
| 1.5 配置管理 | 平台配置 + Cookie 管理 | 2 天 |

### Phase 2: 数据导出（2 周）

| 任务 | 交付物 | 周期 |
|------|--------|------|
| 2.1 抖音导出完善 | 完整 API 数据捕获 | 3 天 |
| 2.2 视频号 RPA | Playwright 自动化脚本 | 3 天 |
| 2.3 快手/小红书 CSV | 手动导入 + 字段映射 | 2 天 |
| 2.4 导出调度器 | 统一导出接口 | 2 天 |

### Phase 3: 数据处理（1 周）

| 任务 | 交付物 | 周期 |
|------|--------|------|
| 3.1 字段映射器 | 多平台字段统一 | 2 天 |
| 3.2 数据清洗器 | 去重 + 补零 + 异常检测 | 2 天 |
| 3.3 时间聚合器 | 日/周/月聚合 | 1 天 |

### Phase 4: 数据应用（2 周）

| 任务 | 交付物 | 周期 |
|------|--------|------|
| 4.1 数据看板 API | RESTful API | 3 天 |
| 4.2 数据导入功能 | CSV 上传 + 解析 | 2 天 |
| 4.3 预警系统 | 规则配置 + 通知 | 3 天 |
| 4.4 前端页面 | 看板 + 导入 + 预警页面 | 2 天 |

### Phase 5: 自动化与优化（1 周）

| 任务 | 交付物 | 周期 |
|------|--------|------|
| 5.1 定时任务 | 每日/每周自动执行 | 2 天 |
| 5.2 性能优化 | 缓存 + 批量处理 | 2 天 |
| 5.3 测试与文档 | 单元测试 + 用户文档 | 1 天 |

---

## 七、关键接口设计

### 7.1 数据导出接口

```typescript
// POST /api/export/run
// 触发数据导出
Request:
{
  platform: 'douyin' | 'wechat' | 'kuaishou' | 'xiaohongshu' | 'all',
  dateRange?: { start: Date, end: Date }
}

Response:
{
  success: boolean,
  taskId: string,
  estimatedTime: number, // 秒
  message: string
}
```

### 7.2 数据导入接口

```typescript
// POST /api/import/csv
// CSV 文件导入
Request:
{
  file: File,
  platform: Platform,
  dataType: 'accounts' | 'metrics',
  options: {
    skipDuplicates: boolean,
    autoMapFields: boolean
  }
}

Response:
{
  success: boolean,
  importedCount: number,
  skippedCount: number,
  errors: Array<{
    row: number,
    field: string,
    message: string
  }>
}
```

### 7.3 数据看板接口

```typescript
// GET /api/dashboard/overview
// 获取总览数据
Query:
{
  platform?: Platform,
  storeId?: string,
  dateRange: { start: Date, end: Date },
  granularity: 'day' | 'week' | 'month'
}

Response:
{
  data: {
    totalFans: number,
    totalPlayCount: number,
    totalEngagement: number,
    avgCompletionRate: number,
    trend: Array<{ date: Date, value: number }>
  },
  alerts: Array<{
    type: string,
    severity: 'warning' | 'critical',
    message: string
  }>
}
```

### 7.4 预警管理接口

```typescript
// POST /api/alerts/rules
// 创建预警规则
Request:
{
  name: string,
  metric: string,
  condition: 'lt' | 'gt' | 'eq' | 'between',
  threshold: number | [number, number],
  severity: 'info' | 'warning' | 'critical',
  notifyChannels: Array<'email' | 'wechat' | 'sms'>
}

Response:
{
  success: boolean,
  ruleId: string
}
```

---

## 八、数据库设计

### 8.1 账号表 (accounts)

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(20) NOT NULL,
  account_id VARCHAR(100) NOT NULL,
  account_name VARCHAR(200),
  account_type VARCHAR(20), -- brand, store, matrix
  store_id UUID REFERENCES stores(id),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(platform, account_id)
);
```

### 8.2 指标数据表 (metrics)

```sql
CREATE TABLE metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id),
  date DATE NOT NULL,
  period VARCHAR(10) NOT NULL, -- day, week, month
  
  -- 粉丝数据
  total_fans INTEGER,
  net_fans_growth INTEGER,
  unfollow_count INTEGER,
  new_followers INTEGER,
  
  -- 内容数据
  play_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  share_count INTEGER,
  collect_count INTEGER,
  publish_count INTEGER,
  
  -- 质量数据
  completion_rate_5s DECIMAL(5,2),
  bounce_rate_2s DECIMAL(5,2),
  avg_play_duration DECIMAL(8,2),
  page_views INTEGER,
  
  -- 元数据
  source VARCHAR(20), -- api, rpa, csv
  quality VARCHAR(10), -- high, medium, low
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(account_id, date, period)
);
```

### 8.3 预警规则表 (alert_rules)

```sql
CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  metric VARCHAR(50) NOT NULL,
  condition VARCHAR(10) NOT NULL,
  threshold_min DECIMAL(10,2),
  threshold_max DECIMAL(10,2),
  severity VARCHAR(20) DEFAULT 'warning',
  notify_channels JSONB,
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 8.4 预警记录表 (alert_logs)

```sql
CREATE TABLE alert_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES alert_rules(id),
  triggered_at TIMESTAMP DEFAULT NOW(),
  metric_value DECIMAL(10,2),
  threshold_value DECIMAL(10,2),
  message TEXT,
  notified BOOLEAN DEFAULT false,
  notified_at TIMESTAMP
);
```

---

## 九、部署方案

### 9.1 开发环境

```bash
# 本地开发
pnpm install
pnpm dev

# 访问
http://localhost:5000
```

### 9.2 生产环境

```bash
# 构建
pnpm build

# 启动
pnpm start

# 定时任务（systemd）
sudo systemctl enable jiujiujin-data-toolkit
sudo systemctl start jiujiujin-data-toolkit
```

### 9.3 Docker 部署

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install
COPY . .
RUN pnpm build
EXPOSE 5000
CMD ["pnpm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://...
    depends_on:
      - db
      - redis
  
  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=jiujiujin
      - POSTGRES_USER=admin
      - POSTGRES_PASSWORD=xxx
    volumes:
      - pgdata:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

---

## 十、总结

本架构设计了一个完整的数据工具系统，包含：

1. **数据导出层**：支持多平台（抖音 API、视频号 RPA、快手/小红书 CSV）
2. **数据处理层**：字段映射、数据清洗、时间聚合、数据验证
3. **数据应用层**：数据看板、数据导入、预警系统
4. **基础设施层**：定时任务、日志系统、配置管理、用户认证

**核心优势**：
- 模块化设计，易于扩展
- 统一数据格式，便于分析
- 自动化流程，减少人工
- 预警机制，及时发现问题

**下一步**：
按照实施路线图，从 Phase 1 开始逐步开发。
