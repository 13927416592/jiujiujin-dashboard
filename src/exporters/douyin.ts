/**
 * 抖音数据导出器
 * 
 * 使用 Playwright + API 拦截方式导出抖音创作者中心数据
 * 支持：账号总览、热搜 Billboard、每日明细
 * 
 * API 路径：
 * - /aweme/janus/creator/data/overview/dashboard  (账号总览指标)
 * - /aweme/janus/creator/data/overview/all         (全量数据)
 * - /aweme/janus/creator/data/overview/billboard   (热搜榜)
 * 
 * 支持两种数据格式：
 * 1. 新格式: metrics 数组 [{ english_metric_name, metric_value, trends }]
 * 2. 旧格式: data 对象 { [metric_name]: { current_count, option_list } }
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { PlatformExporter, RawData, UnifiedMetrics, ExportResult } from './types';

/** 抖音创作者中心 API 拦截的原始响应 */
export interface DouyinAPIResponse {
  overview?: any;           // overview/dashboard 响应
  overviewAll?: any;        // overview/all 响应
  billboard?: any;          // overview/billboard 响应
  guide?: any;              // guide API
  [key: string]: any;       // 其他捕获的 API
}

export class DouyinExporter implements PlatformExporter {
  platform = 'douyin' as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  
  /**
   * 初始化浏览器
   */
  async init(headless: boolean = true): Promise<void> {
    this.browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    this.page = await this.context.newPage();
  }
  
  /**
   * 加载 Cookie
   */
  async loadCookies(cookieFile: string): Promise<void> {
    if (!this.context) throw new Error('Browser not initialized');
    
    const cookiePath = path.resolve(cookieFile);
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    
    // 处理 sameSite 字段
    const validCookies = cookies.map((c: any) => {
      const sameSite = c.sameSite;
      let validSameSite: 'Strict' | 'Lax' | 'None' | undefined = undefined;
      
      if (sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None') {
        validSameSite = sameSite;
      } else if (sameSite === 'strict' || sameSite === 'lax') {
        validSameSite = sameSite.charAt(0).toUpperCase() + sameSite.slice(1) as 'Strict' | 'Lax';
      } else if (sameSite === 'none' || sameSite === 'no_restriction') {
        validSameSite = 'None';
      }
      
      return {
        name: c.name,
        value: c.value,
        domain: c.domain || '.douyin.com',
        path: c.path || '/',
        secure: c.secure ?? true,
        httpOnly: c.httpOnly ?? false,
        sameSite: validSameSite,
      };
    });
    
    await this.context.addCookies(validCookies);
    console.log(`[Cookie] 已加载 ${validCookies.length} 个 Cookie`);
  }
  
  /**
   * 设置 API 拦截器，捕获所有创作者数据中心 API 响应
   */
  private setupAPIInterceptor(apiData: DouyinAPIResponse): void {
    if (!this.page) throw new Error('Page not initialized');
    
    this.page.on('response', async (response) => {
      const url = response.url();
      
      // 匹配抖音创作者中心数据 API
      const isCreatorAPI = 
        url.includes('/aweme/janus/creator/data/') ||
        url.includes('/aweme/v1/creator/data/') ||
        url.includes('overview/dashboard') ||
        url.includes('overview/billboard') ||
        url.includes('overview/all');
      
      if (!isCreatorAPI) return;
      
      try {
        const json = await response.json();
        
        // 提取 API 名称用于日志
        const urlObj = new URL(url);
        const pathName = urlObj.pathname;
        const apiName = pathName.split('/').slice(-3).join('/');
        
        if (json.status_code === 0) {
          console.log(`  [API] 捕获: ${apiName}`);
          
          if (url.includes('overview/dashboard')) {
            apiData.overview = json;
          } else if (url.includes('overview/billboard')) {
            apiData.billboard = json;
          } else if (url.includes('overview/all')) {
            apiData.overviewAll = json;
          } else if (url.includes('guide')) {
            apiData.guide = json;
          } else {
            // 其他 API 用路径最后一段作为 key
            const key = pathName.split('/').pop() || 'unknown';
            apiData[key] = json;
          }
        } else {
          console.log(`  [API] 跳过 (status_code=${json.status_code}): ${apiName}`);
        }
      } catch {
        // 忽略非 JSON 响应
      }
    });
  }
  
  /**
   * 访问数据中心各页面，触发 API 请求
   */
  async captureData(): Promise<DouyinAPIResponse> {
    if (!this.page) throw new Error('Page not initialized');
    
    const apiData: DouyinAPIResponse = {};
    this.setupAPIInterceptor(apiData);
    
    // 1. 访问首页
    console.log('[Page] 访问首页...');
    await this.page.goto('https://creator.douyin.com/creator-micro/home', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 2. 访问账号总览 (operation)
    console.log('[Page] 访问账号总览...');
    await this.page.goto('https://creator.douyin.com/creator-micro/data-center/operation', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 3. 访问作品分析
    console.log('[Page] 访问作品分析...');
    await this.page.goto('https://creator.douyin.com/creator-micro/data-center/work', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 4. 访问粉丝分析
    console.log('[Page] 访问粉丝分析...');
    await this.page.goto('https://creator.douyin.com/creator-micro/data-center/fans', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    return apiData;
  }
  
  /**
   * 导出原始数据
   */
  async export(): Promise<RawData> {
    await this.init();
    await this.loadCookies('./src/exporters/cookies/account1.json');
    
    // 捕获 API 数据
    const apiData = await this.captureData();
    
    const rawData: RawData = {
      platform: 'douyin',
      timestamp: new Date().toISOString(),
      data: apiData as Record<string, any>,
    };
    
    // 保存原始数据
    const outputDir = path.resolve('./src/exporters/output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `douyin_raw_${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(rawData, null, 2));
    console.log(`[Output] 原始数据已保存: ${outputFile}`);
    
    // 打印捕获摘要
    const capturedKeys = Object.keys(apiData).filter(k => apiData[k] !== null && apiData[k] !== undefined);
    console.log(`[Summary] 捕获到 ${capturedKeys.length} 个 API: ${capturedKeys.join(', ')}`);
    
    await this.close();
    
    return rawData;
  }
  
  /**
   * 将原始数据转换为统一格式
   * 支持两种 API 响应格式：
   * 1. 新格式: data.overview.metrics = [{ english_metric_name, metric_value, trends }]
   * 2. 旧格式: data.overview.data = { [metric_name]: { current_count, option_list } }
   */
  async convertToUnified(rawData: RawData): Promise<UnifiedMetrics[]> {
    const { data } = rawData;
    const date = rawData.timestamp.split('T')[0];
    
    // 尝试新格式: metrics 数组
    const overviewMetrics = data.overview?.metrics;
    if (Array.isArray(overviewMetrics) && overviewMetrics.length > 0) {
      return this.convertFromMetricsArray(overviewMetrics, date);
    }
    
    // 尝试旧格式: data 对象
    const overviewData = data.overview?.data;
    if (overviewData && typeof overviewData === 'object') {
      return this.convertFromDataObject(overviewData, date);
    }
    
    console.warn('[Convert] 未识别的数据格式');
    return [];
  }
  
  /**
   * 从 metrics 数组转换（新 API 格式）
   * 结构: [{ english_metric_name, metric_name, metric_value, trends: [{ date_time, value }] }]
   */
  private convertFromMetricsArray(metricsArray: any[], date: string): UnifiedMetrics[] {
    const result: UnifiedMetrics[] = [];
    
    // 构建汇总指标
    const summary: UnifiedMetrics = {
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
    
    for (const item of metricsArray) {
      const key = item.english_metric_name;
      const value = item.metric_value ?? 0;
      
      switch (key) {
        case 'total_fans_cnt':
          summary.totalFans = value;
          break;
        case 'net_fans_cnt':
          summary.netFansGrowth = value;
          break;
        case 'cancel_fans_cnt':
          summary.unfollowFans = Math.abs(value);
          break;
        case 'play_cnt':
          summary.playCount = value;
          break;
        case 'digg_cnt':
          summary.likeCount = value;
          break;
        case 'comment_cnt':
          summary.commentCount = value;
          break;
        case 'share_count':
          summary.shareCount = value;
          break;
        case 'homepage_view_cnt':
          summary.homepageVisits = value;
          break;
        case 'completion_rate_5s':
          (summary.platformSpecific as any).completionRate5s = Math.round(value * 10000) / 100;
          break;
        case 'bounce_rate_2s':
          (summary.platformSpecific as any).bounceRate2s = Math.round(value * 10000) / 100;
          break;
        case 'avg_view_second':
          (summary.platformSpecific as any).avgPlayDuration = Math.round(value * 100) / 100;
          break;
        case 'publish_cnt':
          (summary.platformSpecific as any).publishCount = value;
          break;
        case 'cover_click_ratio':
          (summary.platformSpecific as any).coverClickRatio = Math.round(value * 10000) / 100;
          break;
      }
    }
    
    result.push(summary);
    
    // 从 trends 提取每日明细
    const dailyMetrics = this.extractDailyFromTrends(metricsArray);
    result.push(...dailyMetrics);
    
    return result;
  }
  
  /**
   * 从 trends 数组提取每日明细
   */
  private extractDailyFromTrends(metricsArray: any[]): UnifiedMetrics[] {
    // 收集所有日期
    const dateSet = new Set<string>();
    for (const item of metricsArray) {
      if (Array.isArray(item.trends)) {
        for (const trend of item.trends) {
          if (trend.date_time) dateSet.add(trend.date_time);
        }
      }
    }
    
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) return [];
    
    const dailyMetrics: UnifiedMetrics[] = [];
    
    for (const dateStr of dates) {
      // 格式化日期: 20260805 -> 2026-08-05
      const formattedDate = dateStr.length === 8
        ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
        : dateStr;
      
      const m: UnifiedMetrics = {
        platform: 'douyin',
        accountId: 'default',
        date: formattedDate,
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
      
      for (const item of metricsArray) {
        const trend = item.trends?.find((t: any) => t.date_time === dateStr);
        if (!trend) continue;
        
        const value = trend.value ?? trend.douyin_value ?? 0;
        const key = item.english_metric_name;
        
        switch (key) {
          case 'total_fans_cnt': m.totalFans = value; break;
          case 'net_fans_cnt': m.netFansGrowth = value; break;
          case 'cancel_fans_cnt': m.unfollowFans = Math.abs(value); break;
          case 'play_cnt': m.playCount = value; break;
          case 'digg_cnt': m.likeCount = value; break;
          case 'comment_cnt': m.commentCount = value; break;
          case 'share_count': m.shareCount = value; break;
          case 'homepage_view_cnt': m.homepageVisits = value; break;
          case 'completion_rate_5s':
            (m.platformSpecific as any).completionRate5s = Math.round(value * 10000) / 100;
            break;
          case 'bounce_rate_2s':
            (m.platformSpecific as any).bounceRate2s = Math.round(value * 10000) / 100;
            break;
          case 'avg_view_second':
            (m.platformSpecific as any).avgPlayDuration = Math.round(value * 100) / 100;
            break;
          case 'publish_cnt':
            (m.platformSpecific as any).publishCount = value;
            break;
        }
      }
      
      dailyMetrics.push(m);
    }
    
    return dailyMetrics;
  }
  
  /**
   * 从 data 对象转换（旧 API 格式）
   * 结构: { [metric_name]: { current_count, last_period_incr, option_list } }
   */
  private convertFromDataObject(overviewData: Record<string, any>, date: string): UnifiedMetrics[] {
    const result: UnifiedMetrics[] = [];
    
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
    
    if (overviewData.fans) {
      m.totalFans = parseInt(overviewData.fans.current_count || '0', 10);
      m.netFansGrowth = parseInt(overviewData.fans.last_period_incr || '0', 10);
    }
    if (overviewData.new_fans) {
      (m.platformSpecific as any).newFans = parseInt(overviewData.new_fans.current_count || '0', 10);
    }
    if (overviewData.cancel_fans) {
      m.unfollowFans = Math.abs(parseInt(overviewData.cancel_fans.last_period_incr || '0', 10));
    }
    if (overviewData.play) {
      m.playCount = parseInt(overviewData.play.current_count || '0', 10);
    }
    if (overviewData.digg) {
      m.likeCount = parseInt(overviewData.digg.current_count || '0', 10);
    }
    if (overviewData.comment) {
      m.commentCount = parseInt(overviewData.comment.current_count || '0', 10);
    }
    if (overviewData.share) {
      m.shareCount = parseInt(overviewData.share.current_count || '0', 10);
    }
    if (overviewData.profile) {
      m.homepageVisits = parseInt(overviewData.profile.current_count || '0', 10);
    }
    if (overviewData.account_search) {
      (m.platformSpecific as any).accountSearch = parseInt(overviewData.account_search.current_count || '0', 10);
    }
    if (overviewData.post_search) {
      (m.platformSpecific as any).postSearch = parseInt(overviewData.post_search.current_count || '0', 10);
    }
    if (overviewData.music_create) {
      (m.platformSpecific as any).musicCreate = parseInt(overviewData.music_create.current_count || '0', 10);
    }
    
    // 保留每日明细数据
    const dailyData: Record<string, Array<{ date: string; count: string }>> = {};
    for (const [key, value] of Object.entries(overviewData)) {
      if (value && typeof value === 'object' && Array.isArray((value as any).option_list)) {
        dailyData[key] = (value as any).option_list.map((item: any) => ({
          date: item.date,
          count: item.count,
        }));
      }
    }
    (m.platformSpecific as any).dailyBreakdown = dailyData;
    
    result.push(m);
    return result;
  }
  
  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

// 单例导出（兼容 index.ts）
export const douyinExporter = new DouyinExporter();
