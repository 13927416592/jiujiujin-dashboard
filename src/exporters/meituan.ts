import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { PlatformExporter, RawData, UnifiedMetrics } from './types';

/**
 * 美团经营宝导出器配置
 */
export interface MeituanExportConfig {
  baseUrl: string;
  reportUrl: string;  // 报表中心 URL
  outputDir: string;
  cookieFile: string;
  headless?: boolean;
  timeout?: number;
}

/**
 * 美团原始数据结构（基于报表中心 Excel）
 */
export interface MeituanRawData {
  exportDate: string;
  reportName: string;
  metrics: string[];
  rows: string[][];
}

/**
 * 美团经营宝数据导出器
 * 通过报表中心下载 Excel 文件
 */
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
   * 下载报表中心 Excel 文件
   */
  async downloadReport(): Promise<string | null> {
    if (!this.page) throw new Error('Page not initialized');
    
    console.log('[Meituan] 正在访问报表中心...');
    
    try {
      // 导航到报表中心
      await this.page.goto(this.config.reportUrl, { 
        waitUntil: 'networkidle',
        timeout: this.config.timeout || 60000 
      });
      
      await this.page.waitForTimeout(3000);
      
      // 查找"久久金美团经营数据"报表卡片
      const reportCard = this.page.locator('text=久久金美团经营数据').first();
      if (await reportCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('[Meituan] 找到报表：久久金美团经营数据');
        
        // 点击"使用模板"按钮
        const useTemplateBtn = this.page.locator('button:has-text("使用模板")').first();
        if (await useTemplateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await useTemplateBtn.click();
          console.log('[Meituan] 已点击"使用模板"');
          await this.page.waitForTimeout(3000);
        }
      }
      
      // 查找导出按钮（通常在报表页面的右上角）
      const exportSelectors = [
        'text=导出',
        'text=下载',
        'text=导出数据',
        'button:has-text("导出")',
        'button:has-text("下载")',
        'a:has-text("导出")',
        'a:has-text("下载")',
      ];
      
      let exportBtn: any = null;
      for (const selector of exportSelectors) {
        try {
          const el = this.page.locator(selector).first();
          if (await el.isVisible({ timeout: 2000 })) {
            exportBtn = el;
            console.log(`[Meituan] 找到导出按钮：${selector}`);
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (!exportBtn) {
        console.warn('[Meituan] 未找到导出按钮，尝试截图查看当前页面');
        await this.page.screenshot({ 
          path: path.join(this.config.outputDir, 'meituan_report_page.png'),
          fullPage: false 
        });
        return null;
      }
      
      // 监听下载事件
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
      
      // 点击导出按钮
      await exportBtn.click();
      console.log('[Meituan] 已点击导出按钮，等待下载...');
      
      // 等待下载完成
      const download = await downloadPromise;
      
      // 保存文件
      const outputDir = path.resolve(this.config.outputDir);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `meituan_report_${dateStr}.xlsx`;
      const filePath = path.join(outputDir, fileName);
      
      await download.saveAs(filePath);
      console.log(`[Meituan] 报表已下载：${filePath}`);
      
      return filePath;
    } catch (error) {
      console.error('[Meituan] 下载报表失败：', error);
      return null;
    }
  }

  /**
   * 解析 Excel 文件（简化版，返回原始数据）
   */
  private parseExcel(filePath: string): MeituanRawData {
    // 注意：这里需要安装 xlsx 库来解析 Excel
    // 暂时返回空结构，实际使用时需要实现
    console.log(`[Meituan] 解析 Excel 文件：${filePath}`);
    
    return {
      exportDate: new Date().toISOString(),
      reportName: '久久金美团经营数据',
      metrics: [],
      rows: []
    };
  }

  /**
   * 导出数据
   */
  async export(): Promise<RawData> {
    if (!this.page) throw new Error('Browser not initialized');
    
    console.log('[Meituan] 开始导出报表数据...');
    
    // 下载报表
    const excelPath = await this.downloadReport();
    
    if (!excelPath) {
      throw new Error('报表下载失败');
    }
    
    // 解析 Excel
    const rawData = this.parseExcel(excelPath);
    
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
  reportUrl: 'https://e.dianping.com/',  // 报表中心 URL（需要导航到报表中心）
  outputDir: path.join(process.cwd(), 'src/exporters/output'),
  cookieFile: path.join(process.cwd(), 'src/exporters/cookies/meituan.json'),
  headless: false,  // 首次运行需要手动登录
  timeout: 60000,
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
