import { chromium, Browser, Page, BrowserContext, Frame } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PlatformExporter, ExportResult, ExportConfig } from './types';

export interface MeituanExportConfig extends ExportConfig {
  reportName?: string;
  reportUrl?: string;
  daysToDownload?: number;
}

interface MeituanReportRow {
  [key: string]: string | number;
}

export class MeituanExporter implements PlatformExporter {
  platform = 'meituan' as const;
  private config: MeituanExportConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(config: MeituanExportConfig) {
    this.config = {
      headless: true,
      slowMo: 0,
      outputDir: path.join(process.cwd(), 'src', 'exporters', 'output'),
      cookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json'),
      daysToDownload: 1,
      ...config,
    };
  }

  async export(): Promise<ExportResult> {
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

      console.log('📊 导航到报表中心...');
      await this.navigateToReportCenter(page);

      const reportFrame = await this.getReportFrame(page);
      console.log('✅ 已获取报表中心 iframe');

      console.log('⏳ 等待页面加载...');
      await reportFrame.waitForTimeout(10000);

      console.log('🖱️  点击"使用模板"...');
      await this.clickUseTemplate(reportFrame);

      console.log(' 等待对话框出现...');
      await reportFrame.waitForTimeout(5000);

      console.log('📅 选择时间范围...');
      await this.selectDateRange(reportFrame);

      console.log('⬇️  点击下载...');
      const downloadBtn = reportFrame.locator('button:has-text("下载")').last();
      await downloadBtn.waitFor({ state: 'visible', timeout: 5000 });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        downloadBtn.click(),
      ]);

      const today = new Date();
      const fileName = `meituan_report_${today.toISOString().split('T')[0]}.xlsx`;
      const filePath = path.join(this.config.outputDir!, fileName);
      await download.saveAs(filePath);
      console.log(`📁 文件已保存：${filePath}`);

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

  private async selectDateRange(frame: Frame): Promise<void> {
    const dateInput = frame.locator('input[placeholder="请选择时间范围"]').first();
    await dateInput.waitFor({ state: 'visible', timeout: 10000 });
    await dateInput.click();
    await frame.waitForTimeout(2000);

    const days = this.config.daysToDownload || 1;
    let quickOption = '昨天';
    if (days === 7) quickOption = '近7天';
    else if (days === 30) quickOption = '近30天';

    console.log(` 选择快捷选项：${quickOption}`);

    const optionBtn = frame.locator(`text=${quickOption}`).first();
    await optionBtn.waitFor({ state: 'visible', timeout: 5000 });
    await optionBtn.click();
    await frame.waitForTimeout(2000);

    console.log(`✅ 已选择时间范围：${quickOption}`);
  }

  private async login(page: Page): Promise<void> {
    console.log(' 检查登录状态...');

    const isLoggedIn = await page.locator('text=久久金管家').isVisible({ timeout: 3000 }).catch(() => false);

    if (isLoggedIn) {
      console.log('✅ 已登录');
      return;
    }

    console.log('📱 需要登录，请在浏览器中完成...');
    await page.goto('https://e.dianping.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  }

  private async navigateToReportCenter(page: Page): Promise<void> {
    await page.goto('https://e.dianping.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);

    await this.forceClosePopups(page);

    await page.locator('.sidebar-container').waitFor({ state: 'visible', timeout: 10000 });
    console.log('✅ 侧边栏已加载');

    console.log('📁 点击"经营参谋"...');
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const menu = elements.find(el => el.textContent?.trim() === '经营参谋');
      if (menu) (menu as HTMLElement).click();
    });
    await page.waitForTimeout(3000);

    console.log('📋 点击"报表中心"...');
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const menu = elements.find(el => el.textContent?.trim() === '报表中心');
      if (menu) (menu as HTMLElement).click();
    });
    await page.waitForTimeout(5000);

    console.log('✅ 已导航到报表中心');
  }

  private async getReportFrame(page: Page): Promise<Frame> {
    await page.waitForTimeout(5000);

    const reportFrame = page.frames().find(frame => 
      frame.url().includes('report-center') || frame.url().includes('h5.dianping.com')
    );

    if (reportFrame) {
      console.log(`✅ 找到报表中心 iframe: ${reportFrame.url().substring(0, 60)}...`);
      return reportFrame;
    }

    throw new Error('未找到报表中心 iframe');
  }

  private async forceClosePopups(page: Page): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('知道了'));
        if (btn) btn.click();
      });

      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('跳过'));
        if (btn) btn.click();
      });

      await page.evaluate(() => {
        const closeBtns = Array.from(document.querySelectorAll('[class*="close"], [class*="Close"], .mtd-modal-close'));
        closeBtns.forEach(btn => (btn as HTMLElement).click());
      });

      await page.waitForTimeout(1000);
    }
    console.log('✅ 已关闭弹窗');
  }

  private async clickUseTemplate(frame: Frame): Promise<void> {
    try {
      const btn = frame.locator('text=使用模板').first();
      if (await btn.isVisible({ timeout: 5000 })) {
        await btn.click();
        console.log('✅ 已点击"使用模板"');
        return;
      }
    } catch (e) {
      console.log('⚠️  locator 点击失败，尝试 JavaScript');
    }

    const clicked = await frame.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      const btn = allElements.find(el => {
        const text = el.textContent?.trim();
        return text === '使用模板' || text?.includes('使用模板');
      });
      if (btn) {
        (btn as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log('✅ 已点击"使用模板"（JavaScript）');
    } else {
      throw new Error('在 iframe 中未找到"使用模板"按钮');
    }
  }

  private parseExcel(filePath: string): MeituanReportRow[] {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // 获取所有行（包括表头）
    const allData = XLSX.utils.sheet_to_json<MeituanReportRow>(worksheet, { header: 1 });
    
    // 第一行是表头，从第二行开始是数据
    const headerRow = allData[0] as string[];
    const dataRows = allData.slice(1) as any[][];
    
    // 转换为对象数组
    const result: MeituanReportRow[] = [];
    for (const row of dataRows) {
      const obj: MeituanReportRow = {};
      for (let i = 0; i < headerRow.length; i++) {
        obj[headerRow[i]] = row[i] || '';
      }
      result.push(obj);
    }
    
    console.log(` 解析完成：${result.length} 条数据，${headerRow.length} 个字段`);
    return result;
  }
}
