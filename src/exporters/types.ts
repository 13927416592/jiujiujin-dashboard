// 统一数据类型定义

/** 平台类型 */
export type Platform = 
  | 'douyin' 
  | 'wechat' 
  | 'kuaishou' 
  | 'xiaohongshu'
  | 'weibo'
  | 'bilibili'
  | 'alipay'
  | 'amap';

/** 账号类型 */
export type AccountType = 'brand' | 'store' | 'matrix';

/** 账号状态 */
export type AccountStatus = 'active' | 'inactive' | 'pending';

/** 账号基础信息 */
export interface Account {
  id: string;
  platform: Platform;
  accountId: string;        // 平台上的账号 ID
  accountName: string;      // 显示名称
  accountType: AccountType; // 品牌号/门店号/矩阵号
  storeName?: string;       // 所属门店（门店号填写）
  openDate?: string;        // 开通日期
  status: AccountStatus;    // 状态
}

/** 统一指标数据（所有平台通用） */
export interface UnifiedMetrics {
  // 基础信息
  platform: Platform;
  accountId: string;
  date: string; // YYYY-MM-DD
  
  // 粉丝数据
  totalFans: number;          // 总粉丝量
  netFansGrowth: number;      // 净增粉丝
  unfollowFans: number;       // 取关粉丝
  
  // 内容数据
  playCount: number;          // 播放量/曝光量
  likeCount: number;          // 点赞数
  commentCount: number;       // 评论数
  shareCount: number;         // 分享数
  collectCount: number;       // 收藏数
  
  // 互动数据
  homepageVisits: number;     // 主页访问量
  
  // 视频特有（抖音/视频号/快手）
  completionRate5s?: number;  // 5 秒完播率 (%)
  bounceRate2s?: number;      // 2 秒跳出率 (%)
  avgPlayDuration?: number;   // 平均播放时长 (秒)
  
  // 平台特有数据（灵活扩展）
  platformSpecific?: Record<string, any>;
}

/** 原始数据（从平台 API/CSV 获取的原始格式） */
export interface RawData {
  platform: Platform;
  timestamp: string;
  data: Record<string, any>;
}

/** 导出结果 */
export interface ExportResult {
  success: boolean;
  platform: Platform;
  accountId: string;
  timestamp: string;
  data?: UnifiedMetrics[];
  error?: string;
  rawFile?: string;      // 原始数据文件路径
  convertedFile?: string; // 转换后文件路径
}

/** 批量导出报告 */
export interface BatchExportReport {
  startTime: string;
  endTime: string;
  total: number;
  success: number;
  failed: number;
  results: ExportResult[];
}

/** 平台配置 */
export interface PlatformConfig {
  name: string;
  enabled: boolean;
  exportMethod: 'api' | 'rpa' | 'csv';
  fieldMapping: Record<string, string>;
  schedule?: string; // cron 表达式
  retryCount?: number;
}

/** 数据转换配置 */
export interface TransformConfig {
  inputFormat: 'csv' | 'json';
  outputFormat: 'csv' | 'json';
  fieldMapping: Record<string, string>;
  timeAggregation?: 'daily' | 'weekly' | 'monthly';
}

/** 平台导出器接口 */
export interface PlatformExporter {
  platform: Platform;
  init(headless?: boolean): Promise<void>;
  loadCookies(cookieFile: string): Promise<void>;
  export(): Promise<RawData>;
  convertToUnified(rawData: RawData): Promise<UnifiedMetrics[]>;
  close(): Promise<void>;
}
