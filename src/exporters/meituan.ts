/**
 * 美团数据导出器
 * 
 * 使用 Playwright 自动化方式导出美团经营宝数据
 * 支持：自动登录、导航到数据页面、下载 CSV、解析数据
 * 
 * 数据获取方式：
 * 1. 自动点击"下载明细表格"按钮
 * 2. 监听下载事件，保存 CSV 文件
 * 3. 解析 CSV 并转换为统一格式
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { PlatformExporter, RawData, UnifiedMetrics } from './types';

/** 美团经营宝页面配置 */
interface MeituanPageConfig {
  name: string;           // 页面名称（如：客流分析、经营评分）
  url: string;            // 页面 URL
  downloadSelector: string; // 下载按钮选择器
  dateRange?: string;     // 日期范围（如：近 7 天、近 30 天）
}

/** 美团数据导出配置 */
export interface MeituanExportConfig {
  baseUrl: string;                    // 美团经营宝基础 URL
  pages: MeituanPageConfig[];         // 需要导出的页面列表
  outputDir: string;                  // CSV 输出目录
  cookieFile?: string;                // Cookie 文件路径
  headless?: boolean;                 // 是否无头模式
  timeout?: number;                   // 页面加载超时时间
}

/** 美团原始数据结构 */
export interface MeituanRawData {
  exportDate: string;                 // 导出日期
  pages: {
    [pageName: string]: {
      csvPath: string;                // CSV 文件路径
      csvData: string[][];            // CSV 解析后的二维数组
      headers: string[];              // 表头
      rows: string[][];               // 数据行
    };
  };
}

export class MeituanExporter implements PlatformExporter {
  platform = 'meituan' as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: MeituanExportConfig;

  constructor(config: MeituanExportConfig) {
    this.config = config;
  }

  /**
   * 初始化浏览器
   */
  async init(headless?: boolean): Promise<void> {
    const isHeadless = headless ?? this.config.headless ?? true;
    
    this.browser = await chromium.launch({
      headless: isHeadless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    
    this.page = await this.context.newPage();
    console.log('[Meituan] 浏览器初始化完成');
  }

  /**
   * 加载 Cookie
   */
  async loadCookies(cookieFile?: string): Promise<void> {
    if (!this.context) throw new Error('Browser not initialized');
    
    const cookiePath = cookieFile || this.config.cookieFile;
    if (!cookiePath) {
      console.log('[Meituan] 未提供 Cookie 文件，需要手动登录');
      return;
    }
    
    const resolvedPath = path.resolve(cookiePath);
    if (!fs.existsSync(resolvedPath)) {
      console.log(`[Meituan] Cookie 文件不存在：${resolvedPath}，需要手动登录`);
      return;
    }
    
    const cookies = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    
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
        domain: c.domain || '.meituan.com',
        path: c.path || '/',
        secure: c.secure ?? true,
        httpOnly: c.httpOnly ?? false,
        sameSite: validSameSite,
      };
    });
    
    await this.context.addCookies(validCookies);
    console.log(`[Meituan] 已加载 ${validCookies.length} 个 Cookie`);
  }

  /**
   * 保存 Cookie
   */
  async saveCookies(cookieFile?: string): Promise<void> {
    if (!this.context) throw new Error('Browser not initialized');
    
    const cookiePath = cookieFile || this.config.cookieFile;
    if (!cookiePath) return;
    
    const cookies = await this.context.cookies();
    const resolvedPath = path.resolve(cookiePath);
    const dir = path.dirname(resolvedPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(resolvedPath, JSON.stringify(cookies, null, 2));
    console.log(`[Meituan] 已保存 ${cookies.length} 个 Cookie 到 ${resolvedPath}`);
  }

  /**
   * 手动登录（当 Cookie 无效时）
   */
  async manualLogin(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    
    console.log('[Meituan] 请在浏览器中完成登录...');
    await this.page.goto(this.config.baseUrl, { 
      waitUntil: 'networkidle',
      timeout: this.config.timeout || 60000 
    });
    
    // 等待用户手动登录（最多 5 分钟）
    console.log('[Meituan] 等待登录完成（最多 5 分钟）...');
    await this.page.waitForTimeout(300000);
    
    // 保存 Cookie
    await this.saveCookies();
    console.log('[Meituan] 登录完成，Cookie 已保存');
  }

  /**
   * 解析 CSV 内容
   */
  private parseCSV(content: string): { headers: string[]; rows: string[][] } {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      return { headers: [], rows: [] };
    }
    
    // 简单 CSV 解析（处理逗号分隔）
    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      
      result.push(current.trim());
      return result;
    };
    
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);
    
    return { headers, rows };
  }

  /**
   * 下载单个页面的 CSV
   */
  private async downloadPageCSV(pageConfig: MeituanPageConfig): Promise<{ csvPath: string; csvData: string[][]; headers: string[]; rows: string[][] } | null> {
    if (!this.page) throw new Error('Page not initialized');
    
    console.log(`[Meituan] 正在导出：${pageConfig.name}`);
    
    try {
      // 导航到页面
      await this.page.goto(pageConfig.url, { 
        waitUntil: 'networkidle',
        timeout: this.config.timeout || 60000 
      });
      
      // 等待下载按钮出现
      await this.page.waitForSelector(pageConfig.downloadSelector, { 
        timeout: 10000 
      });
      
      // 监听下载事件
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
      
      // 点击下载按钮
      await this.page.click(pageConfig.downloadSelector);
      
      // 等待下载完成
      const download = await downloadPromise;
      
      // 保存文件
      const outputDir = path.resolve(this.config.outputDir);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const fileName = `meituan_${pageConfig.name}_${new Date().toISOString().split('T')[0]}.csv`;
      const filePath = path.join(outputDir, fileName);
      
      await download.saveAs(filePath);
      console.log(`[Meituan] 已保存：${filePath}`);
      
      // 读取并解析 CSV
      const csvContent = fs.readFileSync(filePath, 'utf-8');
      const { headers, rows } = this.parseCSV(csvContent);
      
      return {
        csvPath: filePath,
        csvData: [headers, ...rows],
        headers,
        rows
      };
    } catch (error) {
      console.error(`[Meituan] 导出 ${pageConfig.name} 失败：`, error);
      return null;
    }
  }

  /**
   * 导出所有页面数据
   */
  async export(): Promise<RawData> {
    if (!this.page) throw new Error('Browser not initialized');
    
    console.log('[Meituan] 开始导出数据...');
    
    const rawData: MeituanRawData = {
      exportDate: new Date().toISOString(),
      pages: {}
    };
    
    // 遍历所有页面
    for (const pageConfig of this.config.pages) {
      const result = await this.downloadPageCSV(pageConfig);
      
      if (result) {
        rawData.pages[pageConfig.name] = result;
        console.log(`[Meituan] ${pageConfig.name}: ${result.rows.length} 行数据`);
      } else {
        console.warn(`[Meituan] ${pageConfig.name}: 导出失败`);
      }
    }
    
    // 保存原始数据
    const outputPath = path.join(
      this.config.outputDir,
      `meituan_full_${new Date().toISOString().split('T')[0]}.json`
    );
    
    fs.writeFileSync(outputPath, JSON.stringify(rawData, null, 2));
    console.log(`[Meituan] 原始数据已保存：${outputPath}`);
    
    // 关闭浏览器
    await this.close();
    
    return {
      platform: this.platform,
      timestamp: rawData.exportDate,
      data: rawData as any
    };
  }

  /**
   * 转换为统一格式
   */
  async convertToUnified(rawData: RawData): Promise<UnifiedMetrics[]> {
    // TODO: 实现美团数据到统一格式的转换
    return [];
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
      console.log('[Meituan] 浏览器已关闭');
    }
  }
}

/**
 * 默认配置
 */
export const DEFAULT_MEITUAN_CONFIG: MeituanExportConfig = {
  baseUrl: 'https://e.dianping.com/',
  outputDir: path.join(process.cwd(), 'src/exporters/output'),
  cookieFile: path.join(process.cwd(), 'src/exporters/cookies/meituan.json'),
  headless: false,  // 首次运行需要手动登录
  timeout: 60000,
  pages: [
    {
      name: '客流分析',
      url: 'https://e.dianping.com/merchant/flow-analysis',
      downloadSelector: 'text=下载明细表格'
    },
    {
      name: '经营评分',
      url: 'https://e.dianping.com/merchant/rating',
      downloadSelector: 'text=下载明细表格'
    },
    {
      name: '评价分析',
      url: 'https://e.dianping.com/merchant/review',
      downloadSelector: 'text=下载明细表格'
    },
    {
      name: '客资中心',
      url: 'https://e.dianping.com/merchant/leads',
      downloadSelector: 'text=下载明细表格'
    }
  ]
};

/**
 * 快速导出函数
 */
export async function exportMeituanData(config?: Partial<MeituanExportConfig>): Promise<RawData> {
  const fullConfig = { ...DEFAULT_MEITUAN_CONFIG, ...config };
  const exporter = new MeituanExporter(fullConfig);
  
  try {
    await exporter.init();
    await exporter.loadCookies();
    
    // 检查是否需要手动登录
    const cookiePath = fullConfig.cookieFile || DEFAULT_MEITUAN_CONFIG.cookieFile;
    if (!cookiePath || !fs.existsSync(path.resolve(cookiePath))) {
      await exporter.manualLogin();
    }
    
    const result = await exporter.export();
    return result;
  } catch (error) {
    console.error('[Meituan] 导出失败：', error);
    await exporter.close();
    throw error;
  }
}
