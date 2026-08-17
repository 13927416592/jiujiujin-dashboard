import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { ExportResult, ExportConfig, RawData, UnifiedMetrics } from './types';

export interface MeituanExportConfig extends ExportConfig {
  reportName?: string;
  reportUrl?: string;
  cookieFile?: string;
}

/** 默认配置（供测试脚本/API 使用） */
export const DEFAULT_MEITUAN_CONFIG: Required<
  Pick<MeituanExportConfig, 'headless' | 'slowMo' | 'outputDir' | 'cookiePath' | 'reportUrl'>
> &
  MeituanExportConfig = {
  headless: true,
  slowMo: 0,
  outputDir: path.join(process.cwd(), 'src', 'exporters', 'output'),
  cookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json'),
  cookieFile: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json'),
  reportUrl: 'https://e.dianping.com/',
};

interface MeituanReportRow {
  [key: string]: string | number;
}

/** 便捷函数：执行一次美团数据导出 */
export async function exportMeituanData(
  config: MeituanExportConfig = {}
): Promise<ExportResult> {
  const exporter = new MeituanExporter({ ...DEFAULT_MEITUAN_CONFIG, ...config });
  return exporter.export();
}

export class MeituanExporter {
  platform = 'meituan' as const;
  config: MeituanExportConfig;
  private browser: Browser | null = null;
  context: BrowserContext | null = null;

  constructor(config: MeituanExportConfig) {
    this.config = {
      headless: true,
      slowMo: 0,
      outputDir: path.join(process.cwd(), 'src', 'exporters', 'output'),
      cookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json'),
      ...config,
    };
  }

  /** 兼容 API 路由：初始化浏览器 */
  async init(headless?: boolean): Promise<void> {
    if (this.browser) return;
    if (typeof headless === 'boolean') this.config.headless = headless;
    this.browser = await chromium.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo,
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
  }

  /** 兼容 API 路由：加载 Cookie */
  async loadCookies(cookieFile?: string): Promise<void> {
    if (!this.context) throw new Error('浏览器未初始化，请先调用 init()');
    const cookiePath = cookieFile || this.config.cookiePath!;
    if (fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
      await this.context.addCookies(cookies);
      console.log('🍪 已加载 Cookie');
    }
  }

  /** 兼容接口：导出原始数据 */
  async exportRaw(): Promise<RawData> {
    const result = await this.export();
    return {
      platform: 'meituan',
      timestamp: result.timestamp,
      accountId: result.accountId,
      data: { result },
      records: result.data,
    };
  }

  /** 兼容接口：转换为统一指标（美团为报表行数据，暂不转换） */
  async convertToUnified(rawData: RawData): Promise<UnifiedMetrics[]> {
    void rawData;
    return [];
  }

  /** 兼容接口：关闭浏览器 */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }

  async export(): Promise<ExportResult> {
    // 若未初始化（命令行直接调用），在这里初始化
    if (!this.browser) {
      await this.init();
    }
    if (!this.context || !this.browser) {
      throw new Error('浏览器初始化失败');
    }
    try {
      this.browser = await chromium.launch({
        headless: this.config.headless,
        slowMo: this.config.slowMo,
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1440, height: 900 },
      });

      const cookiePath = this.config.cookiePath!;
      if (fs.existsSync(cookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
        await this.context.addCookies(cookies);
        console.log('🍪 已加载 Cookie');
      }

      const page = await this.context.newPage();

      await this.login(page);

      console.log('📊 导航到经营参谋 -> 报表中心...');
      await this.navigateToReportCenter(page);

      // 等待报表中心页面加载完成
      console.log('⏳ 等待报表中心加载...');
      await this.waitForReportCenter(page);

      console.log(' 点击"使用模板"...');
      const useTemplateBtn = page.locator('text=使用模板').first();
      if (await useTemplateBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
        await useTemplateBtn.click();
        await page.waitForTimeout(3000);
      } else {
        throw new Error('未找到"使用模板"按钮');
      }

      console.log('⏳ 等待下载对话框...');
      const dialog = page.locator('text=久久金美团经营数据下载').first();
      await dialog.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(2000);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];
      console.log(` 设置日期范围：${dateStr}`);

      const dateInput = page.locator('text=请选择时间范围').first();
      if (await dateInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dateInput.click();
        await page.waitForTimeout(1000);

        const dateCell = page.locator(`text=${yesterday.getDate()}`).first();
        if (await dateCell.isVisible({ timeout: 2000 }).catch(() => false)) {
          await dateCell.click();
          await page.waitForTimeout(1000);
        }
      }

      console.log('⬇️  点击下载...');
      const downloadBtn = page.locator('button:has-text("下载")').last();
      if (await downloadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 60000 }),
          downloadBtn.click(),
        ]);

        const fileName = `meituan_report_${dateStr}.xlsx`;
        const filePath = path.join(this.config.outputDir!, fileName);
        await download.saveAs(filePath);
        console.log(` 文件已保存：${filePath}`);

        const data = this.parseExcel(filePath);

        const jsonPath = filePath.replace('.xlsx', '.json');
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
        console.log(`📊 JSON 已保存：${jsonPath}`);

        const cookies = await this.context.cookies();
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));

        return {
          success: true,
          platform: 'meituan',
          accountId: 'jiujiujin',
          data: data as any[],
          filePath,
          timestamp: new Date().toISOString(),
        };
      } else {
        throw new Error('未找到"下载"按钮');
      }
    } catch (error: any) {
      return {
        success: false,
        platform: 'meituan',
        accountId: 'jiujiujin',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  private async login(page: Page): Promise<void> {
    console.log('🔐 检查登录状态...');

    const isLoggedIn = await page.locator('text=久久金管家').isVisible({ timeout: 3000 }).catch(() => false);

    if (isLoggedIn) {
      console.log('✅ 已登录');
      return;
    }

    console.log('📱 需要登录，请在浏览器中完成...');
    await page.goto('https://e.dianping.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  }

  private async navigateToReportCenter(page: Page): Promise<void> {
    await page.goto('https://e.dianping.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log(' 点击"经营参谋"...');
    const advisorMenu = page.locator('text=经营参谋').first();
    if (await advisorMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
      await advisorMenu.click();
      await page.waitForTimeout(2000);
    } else {
      const advisorMenuExpanded = page.locator('[class*="menu"] text=经营参谋，text=经营参谋').first();
      if (await advisorMenuExpanded.isVisible({ timeout: 3000 }).catch(() => false)) {
        await advisorMenuExpanded.click();
        await page.waitForTimeout(2000);
      } else {
        throw new Error('未找到"经营参谋"菜单');
      }
    }

    console.log('   点击"报表中心"...');
    const reportCenter = page.locator('text=报表中心').first();
    if (await reportCenter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await reportCenter.click();
      await page.waitForTimeout(5000);
    } else {
      throw new Error('未找到"报表中心"菜单');
    }
  }

  private async waitForReportCenter(page: Page): Promise<void> {
    // 等待报表卡片出现（"久久金美团经营数据"卡片）
    try {
      await page.locator('text=久久金美团经营数据').waitFor({ state: 'visible', timeout: 15000 });
      console.log('✅ 报表中心已加载');
    } catch {
      // 备用：等待"使用模板"按钮出现
      try {
        await page.locator('text=使用模板').waitFor({ state: 'visible', timeout: 10000 });
        console.log('✅ 报表模板已加载');
      } catch {
        // 再备用：等待页面标题
        const title = await page.title();
        console.log(`⚠️  页面标题：${title}`);
        
        // 截图调试
        const screenshotPath = path.join(this.config.outputDir!, 'debug-report-center.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`📸 截图已保存：${screenshotPath}`);
        
        throw new Error('报表中心页面加载超时');
      }
    }
  }

  private parseExcel(filePath: string): MeituanReportRow[] {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<MeituanReportRow>(worksheet);
    return data;
  }
}
