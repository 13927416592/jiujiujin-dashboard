import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PlatformExporter, ExportResult, ExportConfig } from './types';

export interface MeituanExportConfig extends ExportConfig {
  reportName?: string;
  reportUrl?: string;
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

      // 导航到经营参谋 -> 报表中心
      console.log('📊 导航到经营参谋 -> 报表中心...');
      await this.navigateToReportCenter(page);

      // 点击"使用模板"
      console.log(' 点击"使用模板"...');
      const useTemplateBtn = page.locator('text=使用模板').first();
      if (await useTemplateBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await useTemplateBtn.click();
        await page.waitForTimeout(3000);
      } else {
        throw new Error('未找到"使用模板"按钮');
      }

      // 等待对话框出现
      console.log('⏳ 等待下载对话框...');
      const dialog = page.locator('text=久久金美团经营数据下载').first();
      await dialog.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(2000);

      // 选择日期范围
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];
      console.log(` 设置日期范围：${dateStr}`);

      const dateInput = page.locator('text=请选择时间范围').first();
      if (await dateInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dateInput.click();
        await page.waitForTimeout(1000);

        // 选择日期
        const dateCell = page.locator(`text=${yesterday.getDate()}`).first();
        if (await dateCell.isVisible({ timeout: 2000 }).catch(() => false)) {
          await dateCell.click();
          await page.waitForTimeout(1000);
        }
      }

      // 点击下载按钮
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
        console.log(`📁 文件已保存：${filePath}`);

        const data = this.parseExcel(filePath);

        const jsonPath = filePath.replace('.xlsx', '.json');
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
        console.log(` JSON 已保存：${jsonPath}`);

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

    console.log(' 需要登录，请在浏览器中完成...');
    await page.goto('https://e.dianping.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  }

  private async navigateToReportCenter(page: Page): Promise<void> {
    // 先访问首页
    await page.goto('https://e.dianping.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 点击"经营参谋"一级菜单
    console.log(' 点击"经营参谋"...');
    const advisorMenu = page.locator('text=经营参谋').first();
    if (await advisorMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
      await advisorMenu.click();
      await page.waitForTimeout(2000);
    } else {
      // 尝试点击已展开的菜单
      const advisorMenuExpanded = page.locator('[class*="menu"] text=经营参谋, text=经营参谋').first();
      if (await advisorMenuExpanded.isVisible({ timeout: 3000 }).catch(() => false)) {
        await advisorMenuExpanded.click();
        await page.waitForTimeout(2000);
      } else {
        throw new Error('未找到"经营参谋"菜单');
      }
    }

    // 点击"报表中心"二级菜单
    console.log('  点击"报表中心"...');
    const reportCenter = page.locator('text=报表中心').first();
    if (await reportCenter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await reportCenter.click();
      await page.waitForTimeout(5000);
    } else {
      throw new Error('未找到"报表中心"菜单');
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
