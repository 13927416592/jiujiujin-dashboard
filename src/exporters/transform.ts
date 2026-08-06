/**
 * 数据转换脚本
 * 
 * 将各平台导出的原始数据转换为统一格式
 * 支持：字段映射、时间聚合、数据清洗
 * 
 * 抖音 overview/dashboard API 实际数据结构：
 * {
 *   "status_code": 0,
 *   "data": {
 *     "fans": { "current_count": "1234", "last_period_incr": "10", "option_list": [...] },
 *     "play": { "current_count": "5678", ... },
 *     ...
 *   }
 * }
 */

import * as fs from 'fs';
import * as path from 'path';
import { UnifiedMetrics, Platform } from './types';

// ============ 抖音指标字段映射 ============

/** 抖音 API 指标名 -> 统一字段名 */
const DOUYIN_METRIC_MAP: Record<string, keyof UnifiedMetrics | string> = {
  fans: 'totalFans',           // 总粉丝量
  new_fans: 'newFans',         // 新增粉丝 (platformSpecific)
  cancel_fans: 'unfollowFans', // 取关粉丝
  play: 'playCount',           // 播放量
  digg: 'likeCount',           // 点赞数
  comment: 'commentCount',     // 评论数
  share: 'shareCount',         // 分享数
  profile: 'homepageVisits',   // 主页访问量
  account_search: 'accountSearch', // 账号搜索 (platformSpecific)
  post_search: 'postSearch',   // 作品搜索 (platformSpecific)
  music_create: 'musicCreate', // 音乐创作 (platformSpecific)
};

/** 抖音每日明细中的指标名 -> 中文标签 */
const DOUYIN_DAILY_METRIC_LABELS: Record<string, string> = {
  fans: '粉丝总数',
  new_fans: '新增粉丝',
  cancel_fans: '取关粉丝',
  play: '播放量',
  digg: '点赞数',
  comment: '评论数',
  share: '分享数',
  profile: '主页访问量',
  account_search: '账号搜索',
  post_search: '作品搜索',
  music_create: '音乐/图文创作',
};

// ============ 核心转换函数 ============

/**
 * 解析抖音 overview/dashboard API 响应
 * 
 * 输入结构：
 * {
 *   status_code: 0,
 *   data: {
 *     [metric_name]: {
 *       current_count: string,
 *       last_period_incr: string,
 *       option_list: [{ count, date, last_day_incr_rate }],
 *       option_type: number,
 *       status_code: 0,
 *       status_msg: string
 *     }
 *   }
 * }
 */
export function parseDouyinOverview(apiResponse: any): UnifiedMetrics[] {
  const metrics: UnifiedMetrics[] = [];
  
  if (!apiResponse || apiResponse.status_code !== 0 || !apiResponse.data) {
    console.warn('[Transform] 无效的 overview API 响应');
    return metrics;
  }
  
  const data = apiResponse.data;
  const today = new Date().toISOString().split('T')[0];
  
  // 构建汇总指标（从各 metric 的 current_count 提取）
  const summary: UnifiedMetrics = {
    platform: 'douyin',
    accountId: 'default',
    date: today,
    totalFans: 0,
    netFansGrowth: 0,
    unfollowFans: 0,
    playCount: 0,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    collectCount: 0,
    homepageVisits: 0,
    platformSpecific: {
      newFans: 0,
      accountSearch: 0,
      postSearch: 0,
      musicCreate: 0,
    },
  };
  
  for (const [metricKey, metricData] of Object.entries(data)) {
    if (!metricData || typeof metricData !== 'object') continue;
    
    const md = metricData as any;
    const currentCount = parseInt(md.current_count || '0', 10);
    const lastPeriodIncr = parseInt(md.last_period_incr || '0', 10);
    
    const targetField = DOUYIN_METRIC_MAP[metricKey];
    if (!targetField) {
      console.log(`[Transform] 未知指标: ${metricKey}, 跳过`);
      continue;
    }
    
    // 映射到统一字段
    switch (targetField) {
      case 'totalFans':
        summary.totalFans = currentCount;
        summary.netFansGrowth = lastPeriodIncr;
        break;
      case 'newFans':
        (summary.platformSpecific as any).newFans = currentCount;
        break;
      case 'unfollowFans':
        summary.unfollowFans = Math.abs(lastPeriodIncr);
        break;
      case 'playCount':
        summary.playCount = currentCount;
        break;
      case 'likeCount':
        summary.likeCount = currentCount;
        break;
      case 'commentCount':
        summary.commentCount = currentCount;
        break;
      case 'shareCount':
        summary.shareCount = currentCount;
        break;
      case 'homepageVisits':
        summary.homepageVisits = currentCount;
        break;
      case 'accountSearch':
        (summary.platformSpecific as any).accountSearch = currentCount;
        break;
      case 'postSearch':
        (summary.platformSpecific as any).postSearch = currentCount;
        break;
      case 'musicCreate':
        (summary.platformSpecific as any).musicCreate = currentCount;
        break;
    }
  }
  
  metrics.push(summary);
  
  // 从 option_list 提取每日明细数据
  const dailyMetrics = extractDailyMetrics(data);
  metrics.push(...dailyMetrics);
  
  return metrics;
}

/**
 * 从 option_list 提取每日明细
 * 每个指标的 option_list 包含近7天的每日数据
 */
function extractDailyMetrics(data: Record<string, any>): UnifiedMetrics[] {
  // 收集所有日期
  const dateSet = new Set<string>();
  for (const metricData of Object.values(data)) {
    if (metricData?.option_list && Array.isArray(metricData.option_list)) {
      for (const item of metricData.option_list) {
        if (item.date) dateSet.add(item.date);
      }
    }
  }
  
  const dates = Array.from(dateSet).sort();
  if (dates.length === 0) return [];
  
  const dailyMetrics: UnifiedMetrics[] = [];
  
  for (const date of dates) {
    const m: UnifiedMetrics = {
      platform: 'douyin',
      accountId: 'default',
      date,
      totalFans: 0,
      netFansGrowth: 0,
      unfollowFans: 0,
      playCount: 0,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      collectCount: 0,
      homepageVisits: 0,
      platformSpecific: {},
    };
    
    for (const [metricKey, metricData] of Object.entries(data)) {
      if (!metricData?.option_list) continue;
      
      const dayItem = metricData.option_list.find((item: any) => item.date === date);
      if (!dayItem) continue;
      
      const count = parseInt(dayItem.count || '0', 10);
      const targetField = DOUYIN_METRIC_MAP[metricKey];
      
      switch (targetField) {
        case 'totalFans':
          m.totalFans = count;
          break;
        case 'newFans':
          (m.platformSpecific as any).newFans = count;
          break;
        case 'unfollowFans':
          m.unfollowFans = Math.abs(count);
          break;
        case 'playCount':
          m.playCount = count;
          break;
        case 'likeCount':
          m.likeCount = count;
          break;
        case 'commentCount':
          m.commentCount = count;
          break;
        case 'shareCount':
          m.shareCount = count;
          break;
        case 'homepageVisits':
          m.homepageVisits = count;
          break;
        case 'accountSearch':
          (m.platformSpecific as any).accountSearch = count;
          break;
        case 'postSearch':
          (m.platformSpecific as any).postSearch = count;
          break;
        case 'musicCreate':
          (m.platformSpecific as any).musicCreate = count;
          break;
      }
    }
    
    dailyMetrics.push(m);
  }
  
  return dailyMetrics;
}

// ============ 通用转换入口 ============

/**
 * 从原始 JSON 文件转换数据
 */
export async function transformFromFile(inputFile: string): Promise<UnifiedMetrics[]> {
  const inputPath = path.resolve(inputFile);
  
  if (!fs.existsSync(inputPath)) {
    throw new Error(`文件不存在: ${inputPath}`);
  }
  
  const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  return transformFromRawData(rawData);
}

/**
 * 从原始数据对象转换
 */
export function transformFromRawData(rawData: any): UnifiedMetrics[] {
  const allMetrics: UnifiedMetrics[] = [];
  
  // 处理抖音数据
  if (rawData.platform === 'douyin' && rawData.data) {
    // 新格式: data 中包含 overview, overviewAll, billboard 等 key
    if (rawData.data.overview) {
      const overviewMetrics = parseDouyinOverview(rawData.data.overview);
      allMetrics.push(...overviewMetrics);
    }
    
    // 兼容旧格式: data 直接就是 overview 响应
    if (rawData.data.status_code === 0 && rawData.data.data) {
      const overviewMetrics = parseDouyinOverview(rawData.data);
      allMetrics.push(...overviewMetrics);
    }
  }
  
  return allMetrics;
}

// ============ CSV 导出 ============

/**
 * 将统一指标导出为 CSV
 */
export function metricsToCSV(metrics: UnifiedMetrics[], outputFile: string): string {
  if (metrics.length === 0) {
    console.warn('[Transform] 没有数据可导出');
    return '';
  }
  
  // 表头
  const headers = [
    'platform', 'account_id', 'date',
    'total_fans', 'net_fans_growth', 'unfollow_fans',
    'play_count', 'like_count', 'comment_count', 'share_count', 'collect_count',
    'homepage_visits',
    'new_fans', 'account_search', 'post_search', 'music_create',
  ];
  
  const rows = metrics.map(m => [
    m.platform,
    m.accountId,
    m.date,
    m.totalFans,
    m.netFansGrowth,
    m.unfollowFans,
    m.playCount,
    m.likeCount,
    m.commentCount,
    m.shareCount,
    m.collectCount,
    m.homepageVisits,
    (m.platformSpecific as any)?.newFans || 0,
    (m.platformSpecific as any)?.accountSearch || 0,
    (m.platformSpecific as any)?.postSearch || 0,
    (m.platformSpecific as any)?.musicCreate || 0,
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  const outputPath = path.resolve(outputFile);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  console.log(`[Output] CSV 已导出: ${outputPath} (${metrics.length} 行)`);
  
  return outputPath;
}

// ============ 数据清洗 ============

/**
 * 清洗数据：处理负值、百分比范围等
 */
export function cleanData(metrics: UnifiedMetrics[]): UnifiedMetrics[] {
  return metrics.map(m => {
    if (m.totalFans < 0) m.totalFans = 0;
    if (m.playCount < 0) m.playCount = 0;
    if (m.likeCount < 0) m.likeCount = 0;
    if (m.commentCount < 0) m.commentCount = 0;
    if (m.shareCount < 0) m.shareCount = 0;
    if (m.collectCount < 0) m.collectCount = 0;
    if (m.homepageVisits < 0) m.homepageVisits = 0;
    
    if (m.completionRate5s !== undefined) {
      m.completionRate5s = Math.max(0, Math.min(100, m.completionRate5s));
    }
    if (m.bounceRate2s !== undefined) {
      m.bounceRate2s = Math.max(0, Math.min(100, m.bounceRate2s));
    }
    
    return m;
  });
}

// ============ 时间聚合 ============

/**
 * 按周/月聚合数据
 */
export function aggregateData(
  metrics: UnifiedMetrics[],
  aggregation: 'daily' | 'weekly' | 'monthly'
): UnifiedMetrics[] {
  if (aggregation === 'daily') return metrics;
  
  const grouped: Record<string, UnifiedMetrics[]> = {};
  
  for (const metric of metrics) {
    const date = new Date(metric.date);
    let key: string;
    
    if (aggregation === 'weekly') {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay() + 1);
      key = weekStart.toISOString().split('T')[0];
    } else {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(metric);
  }
  
  const result: UnifiedMetrics[] = [];
  
  for (const [key, group] of Object.entries(grouped)) {
    const aggregated: UnifiedMetrics = {
      ...group[0],
      date: key,
      totalFans: Math.round(group.reduce((sum, m) => sum + m.totalFans, 0) / group.length),
      netFansGrowth: group.reduce((sum, m) => sum + m.netFansGrowth, 0),
      playCount: group.reduce((sum, m) => sum + m.playCount, 0),
      likeCount: group.reduce((sum, m) => sum + m.likeCount, 0),
      commentCount: group.reduce((sum, m) => sum + m.commentCount, 0),
      shareCount: group.reduce((sum, m) => sum + m.shareCount, 0),
      homepageVisits: group.reduce((sum, m) => sum + m.homepageVisits, 0),
    };
    
    result.push(aggregated);
  }
  
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ============ CLI 入口 ============

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const inputFile = args[0] || './src/exporters/output/douyin_raw_latest.json';
    const outputFile = args[1] || './src/exporters/output/douyin_unified_latest.csv';
    
    console.log(`[Transform] 输入: ${inputFile}`);
    console.log(`[Transform] 输出: ${outputFile}`);
    
    try {
      const metrics = await transformFromFile(inputFile);
      console.log(`[Transform] 转换完成: ${metrics.length} 条记录`);
      
      if (metrics.length > 0) {
        console.log('\n数据摘要:');
        const summary = metrics[0];
        console.log(`  总粉丝: ${summary.totalFans}`);
        console.log(`  净增粉丝: ${summary.netFansGrowth}`);
        console.log(`  播放量: ${summary.playCount}`);
        console.log(`  点赞: ${summary.likeCount}`);
        console.log(`  评论: ${summary.commentCount}`);
        console.log(`  分享: ${summary.shareCount}`);
        console.log(`  主页访问: ${summary.homepageVisits}`);
        
        metricsToCSV(metrics, outputFile);
      } else {
        console.warn('[Transform] 未提取到任何数据');
      }
    } catch (err) {
      console.error('[Transform] 转换失败:', err);
      process.exit(1);
    }
  })();
}
