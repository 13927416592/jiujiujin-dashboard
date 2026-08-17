/**
 * 支付宝商家平台数据导出器
 *
 * 使用 Playwright 抓取 b.alipay.com 商家平台的经营数据。
 * - 首次运行 headless:false，手动扫码/账密登录一次，Cookie 保存约 7 天
 * - 后续运行自动加载 Cookie，无需重复登录
 *
 * 抓取页面（与历史 alipay_full_*.json 结构保持一致）：
 * - overview     经营总览
 * - traffic       流量分析（含多个 Tab）
 * - user          用户分析
 * - trade         交易分析
 * - miniProgram   小程序数据（按小程序逐个抓取多个 Tab）
 * - lifeAccount   生活号+
 * - fanGroup      商家粉丝群
 *
 * 每个页面保存：{ url, title, metrics, tables, bodyText }
 * - metrics: 页面中按区块/卡片提取的文本块数组
 * - tables:  页面中所有 <table> 的二维文本数组
 * - bodyText: document.body.innerText 全文（后端 API 用正则从中提取指标）
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { ExportResult } from './types';

/** 单个页面抓取结果 */
export interface AlipayPageData {
  url: string | null;
  title: string | null;
  metrics: string[];
  tables: string[][][];
  bodyText: string;
}

/** 小程序 Tab 数据（结构同页面） */
export type AlipayProgramTab = AlipayPageData;

/** 小程序数据 */
export interface AlipayProgram {
  id: string;
  name: string;
  tabs: Record<string, AlipayProgramTab>;
}

/** 支付宝全量数据 */
export interface AlipayFullData {
  date: string;
  pages: {
    overview: AlipayPageData;
    traffic: { tabs: Record<string, AlipayPageData> };
    user: AlipayPageData;
    trade: AlipayPageData;
    miniProgram: { programs: AlipayProgram[] };
    lifeAccount: AlipayPageData;
    fanGroup: AlipayPageData;
  };
}

export interface AlipayExportConfig {
  headless?: boolean;
  slowMo?: number;
  outputDir?: string;
  cookiePath?: string;
  /** 经营总览页 URL */
  overviewUrl?: string;
  /** 小程序 appId（生活号/粉丝群页需要） */
  lifeAccountAppId?: string;
}

export const DEFAULT_ALIPAY_CONFIG: Required<
  Pick<AlipayExportConfig, 'headless' | 'slowMo' | 'outputDir' | 'cookiePath' | 'overviewUrl' | 'lifeAccountAppId'>
> &
  AlipayExportConfig = {
  headless: false,
  slowMo: 300,
  outputDir: path.join(process.cwd(), 'src', 'exporters', 'output'),
  cookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'alipay.json'),
  overviewUrl: 'https://b.alipay.com/page/manage-consultant/data-index',
  lifeAccountAppId: '2017122701284248',
};

/** 等待页面数据加载完成的最长时间（毫秒） */
const PAGE_LOAD_TIMEOUT = 45000;
/** 切换 Tab/进入小程序后的额外等待（毫秒） */
const TAB_SETTLE_MS = 3500;

export class AlipayExporter {
  platform = 'alipay' as const;
  private config: Required<AlipayExportConfig>;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(config: AlipayExportConfig = {}) {
    this.config = { ...DEFAULT_ALIPAY_CONFIG, ...config } as Required<AlipayExportConfig>;
  }

  /**
   * 执行全量数据导出
   */
  async export(): Promise<ExportResult> {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    try {
      await this.init();
      await this.ensureLogin();

      console.log('\n📊 开始抓取支付宝经营数据...');

      // 1. 经营总览
      console.log('  [1/6] 经营总览...');
      const overview = await this.scrapePage(this.config.overviewUrl);

      // 2. 用户分析
      console.log('  [2/6] 用户分析...');
      const user = await this.scrapePage(
        'https://b.alipay.com/page/board-cloud/user-assets-analysis'
      );

      // 3. 交易分析
      console.log('  [3/6] 交易分析...');
      const trade = await this.scrapePage(
        'https://b.alipay.com/page/manage-consultant/trade-analysis/overview'
      );

      // 4. 流量分析（多 Tab）
      console.log('  [4/6] 流量分析（多 Tab）...');
      const traffic = await this.scrapeTrafficPage(
        'https://b.alipay.com/page/manage-consultant/traffic-analysis/overview'
      );

      // 5. 小程序数据
      console.log('  [5/6] 小程序数据...');
      const miniProgram = await this.scrapeMiniPrograms(
        'https://b.alipay.com/page/manage-consultant/mini-program-analysis/overview'
      );

      // 6. 生活号+ 与 粉丝群
      console.log('  [6/6] 生活号+ / 粉丝群...');
      const lifeUrl = `https://b.alipay.com/page/life-data/dc/flow?appId=${this.config.lifeAccountAppId}`;
      const lifeAccount = await this.scrapeLifeAccountPage(lifeUrl, 'lifeAccount');
      const fanGroup = await this.scrapeLifeAccountPage(lifeUrl, 'fanGroup');

      const fullData: AlipayFullData = {
        date: dateStr,
        pages: {
          overview,
          traffic,
          user,
          trade,
          miniProgram,
          lifeAccount,
          fanGroup,
        },
      };

      // 保存 JSON
      fs.mkdirSync(this.config.outputDir, { recursive: true });
      const fileName = `alipay_full_${dateStr}.json`;
      const filePath = path.join(this.config.outputDir, fileName);
      fs.writeFileSync(filePath, JSON.stringify(fullData, null, 2), 'utf-8');
      console.log(`\n💾 数据已保存：${filePath}`);

      // 保存最新 Cookie
      await this.saveCookies();

      return {
        success: true,
        platform: 'alipay',
        accountId: 'jiujiujin',
        timestamp: new Date().toISOString(),
        rawFile: filePath,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('\n❌ 支付宝导出失败：', message);

      // 失败时也尝试保存 Cookie（便于下次复用）
      await this.saveCookies().catch(() => undefined);

      return {
        success: false,
        platform: 'alipay',
        accountId: 'jiujiujin',
        timestamp: new Date().toISOString(),
        error: message,
      };
    } finally {
      await this.close();
    }
  }

  /** 初始化浏览器 */
  private async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });

    // 加载已有 Cookie
    if (fs.existsSync(this.config.cookiePath)) {
      try {
        const cookies = JSON.parse(fs.readFileSync(this.config.cookiePath, 'utf-8'));
        const validCookies = this.normalizeCookies(cookies);
        await this.context.addCookies(validCookies);
        console.log(`🍪 已加载 ${validCookies.length} 个 Cookie`);
      } catch (err) {
        console.warn('⚠️  Cookie 加载失败，将重新登录：', err);
      }
    }

    this.page = await this.context.newPage();
  }

  /** 确保已登录，未登录则等待用户手动登录 */
  private async ensureLogin(): Promise<void> {
    if (!this.page || !this.context) throw new Error('浏览器未初始化');

    console.log('🔐 检查支付宝登录状态...');
    await this.page.goto(this.config.overviewUrl, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT,
    });

    // 等待页面跳转 settle
    await this.page.waitForTimeout(4000);

    const currentUrl = this.page.url();
    const isLoginPage =
      currentUrl.includes('login') ||
      currentUrl.includes('passport') ||
      currentUrl.includes('signin');

    if (!isLoginPage) {
      // 再确认页面确实有经营数据（有"交易"/"金额"等字样），而非空白/报错
      const bodyText = await this.getBodyText(this.page);
      const hasData = /(交易金额|交易笔数|经营总览|活跃用户|累计用户)/.test(bodyText);
      if (hasData) {
        console.log('✅ 已登录');
        return;
      }
    }

    console.log('\n==================================================');
    console.log('📱  请在弹出的浏览器中完成支付宝登录（扫码/账密）');
    console.log('👉  登录成功并看到经营数据后，回到终端按【回车键】继续');
    console.log('==================================================\n');

    // 等待用户在终端按回车
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });

    console.log('⏳ 登录完成，继续抓取...');
    await this.page.waitForTimeout(2000);
  }

  /** 抓取单个页面的完整数据 */
  private async scrapePage(url: string): Promise<AlipayPageData> {
    if (!this.page) throw new Error('页面未初始化');

    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    await this.waitForDataLoaded(this.page);

    return this.extractPageData(this.page, url);
  }

  /** 抓取流量分析页（多个 Tab） */
  private async scrapeTrafficPage(url: string): Promise<{ tabs: Record<string, AlipayPageData> }> {
    if (!this.page) throw new Error('页面未初始化');

    const tabs: Record<string, AlipayPageData> = {};
    const tabNames = ['流量概览', '小程序流量', '生活号+流量', '商家粉丝群流量', '其他活跃流量'];

    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    await this.waitForDataLoaded(this.page);

    for (const tabName of tabNames) {
      const clicked = await this.clickTabIfPresent(tabName);
      if (!clicked) {
        // 该 Tab 不存在则跳过
        continue;
      }
      await this.page.waitForTimeout(TAB_SETTLE_MS);
      tabs[tabName] = await this.extractPageData(this.page, this.page.url());
    }

    // 如果一个 Tab 都没点到，至少抓当前页兜底
    if (Object.keys(tabs).length === 0) {
      tabs['流量概览'] = await this.extractPageData(this.page, this.page.url());
    }

    return { tabs };
  }

  /**
   * 抓取小程序数据
   * 策略：进入小程序分析页后，尝试逐个点击左侧小程序列表，
   * 再依次点击「概览/流量/交易」Tab。
   * 若页面结构与预期不符，则降级为抓取当前页整页文本。
   */
  private async scrapeMiniPrograms(url: string): Promise<{ programs: AlipayProgram[] }> {
    if (!this.page) throw new Error('页面未初始化');

    const programs: AlipayProgram[] = [];

    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    await this.waitForDataLoaded(this.page);

    // 先抓取页面上可见的小程序名称/ID 列表（常见为列表项文本）
    let programItems: Array<{ id: string; name: string }> = [];
    try {
      programItems = await this.page.evaluate(() => {
        const results: Array<{ id: string; name: string }> = [];
        const seen = new Set<string>();
        // 兜底：从所有包含"黄金回收/久久金"等关键字的可点击元素中提取
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>('[class*="program"], [class*="app-item"], li, [role="listitem"]')
        );
        for (const el of candidates) {
          const text = (el.innerText || '').trim();
          if (!text || text.length > 50) continue;
          if (!/(黄金|久久金|管家|回收|小程序)/.test(text)) continue;
          if (seen.has(text)) continue;
          seen.add(text);
          results.push({ id: '', name: text });
        }
        return results;
      });
    } catch {
      programItems = [];
    }

    // 如果没有识别到小程序列表，则把整页作为一个"默认小程序"抓取
    if (programItems.length === 0) {
      console.log('    ⚠️ 未识别到小程序列表，整页抓取为默认小程序');
      const tabNames = ['概览', '流量', '交易'];
      const tabs: Record<string, AlipayProgramTab> = {};
      for (const tabName of tabNames) {
        await this.clickTabIfPresent(tabName);
        await this.page.waitForTimeout(TAB_SETTLE_MS);
        tabs[tabName] = await this.extractPageData(this.page, this.page.url());
      }
      programs.push({ id: 'default', name: '久久金管家', tabs });
      return { programs };
    }

    // 逐个点击小程序并抓取
    for (let i = 0; i < programItems.length; i++) {
      const item = programItems[i];
      console.log(`    小程序 ${i + 1}/${programItems.length}: ${item.name}`);

      // 重新定位元素（避免上一步 DOM 变化导致失效）
      const clicked = await this.clickByText(item.name);
      if (!clicked) continue;
      await this.page.waitForTimeout(TAB_SETTLE_MS);

      const tabs: Record<string, AlipayProgramTab> = {};
      for (const tabName of ['概览', '流量', '交易']) {
        await this.clickTabIfPresent(tabName);
        await this.page.waitForTimeout(TAB_SETTLE_MS);
        tabs[tabName] = await this.extractPageData(this.page, this.page.url());
      }

      programs.push({
        id: item.id || `program-${i + 1}`,
        name: item.name,
        tabs,
      });
    }

    return { programs };
  }

  /**
   * 抓取生活号+ / 粉丝群页
   * 两个 Tab 在同一页面，通过点击对应 Tab 切换。
   */
  private async scrapeLifeAccountPage(url: string, type: 'lifeAccount' | 'fanGroup'): Promise<AlipayPageData> {
    if (!this.page) throw new Error('页面未初始化');

    // 仅在第一次进入时跳转（type===lifeAccount 时已在小程序步骤后可能不在该页）
    const currentUrl = this.page.url();
    if (!currentUrl.includes('life-data')) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
      await this.waitForDataLoaded(this.page);
    }

    // 点击对应 Tab：生活号+ / 商家粉丝群
    const tabName = type === 'lifeAccount' ? '生活号' : '粉丝群';
    await this.clickTabIfPresent(tabName);
    await this.page.waitForTimeout(TAB_SETTLE_MS);

    return this.extractPageData(this.page, this.page.url());
  }

  /** 从当前页提取结构化数据 */
  private async extractPageData(page: Page, url: string): Promise<AlipayPageData> {
    const title = await page.title().catch(() => null);
    const bodyText = await this.getBodyText(page);
    const metrics = await this.extractMetricBlocks(page);
    const tables = await this.extractTables(page);

    return {
      url,
      title,
      metrics,
      tables,
      bodyText,
    };
  }

  /** 获取整页 innerText */
  private async getBodyText(page: Page): Promise<string> {
    return page
      .evaluate(() => document.body ? document.body.innerText : '')
      .catch(() => '');
  }

  /**
   * 提取页面指标文本块：遍历常见卡片/区块容器，取其 innerText
   */
  private async extractMetricBlocks(page: Page): Promise<string[]> {
    return page
      .evaluate(() => {
        const blocks: string[] = [];
        const seen = new Set<string>();

        // 卡片/区块常见类名特征
        const selector = [
          '[class*="card"]',
          '[class*="Card"]',
          '[class*="metric"]',
          '[class*="Metric"]',
          '[class*="overview"]',
          '[class*="data-item"]',
          '[class*="block"]',
        ].join(',');

        const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
        for (const el of nodes) {
          // 只取叶子级卡片（不含太多同类子卡片），避免重复大块
          const nestedCount = el.querySelectorAll(selector).length;
          if (nestedCount > 6) continue;
          const text = (el.innerText || '').trim().replace(/\n{3,}/g, '\n\n');
          if (!text || text.length < 4 || text.length > 600) continue;
          if (seen.has(text)) continue;
          seen.add(text);
          blocks.push(text);
        }
        return blocks.slice(0, 120);
      })
      .catch(() => []);
  }

  /** 提取所有 <table> 为二维文本数组 */
  private async extractTables(page: Page): Promise<string[][][]> {
    return page
      .evaluate(() => {
        const result: string[][][] = [];
        const tables = Array.from(document.querySelectorAll('table'));
        for (const table of tables) {
          const rows = Array.from(table.querySelectorAll('tr'));
          const matrix: string[][] = [];
          for (const tr of rows) {
            const cells = Array.from(tr.querySelectorAll('th,td')).map((c) =>
              (c.textContent || '').replace(/\s+/g, ' ').trim()
            );
            if (cells.some((c) => c.length > 0)) {
              matrix.push(cells);
            }
          }
          if (matrix.length > 0) result.push(matrix);
        }
        return result;
      })
      .catch(() => []);
  }

  /** 等待页面数据加载完成（出现指标数字或骨架屏消失） */
  private async waitForDataLoaded(page: Page): Promise<void> {
    // 先等待网络基本空闲
    await page.waitForLoadState('networkidle', { timeout: PAGE_LOAD_TIMEOUT }).catch(() => undefined);
    // 再等待出现至少一个数字/中文字符的正文，最多 15s
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const text = await this.getBodyText(page);
      if (text.trim().length > 200) break;
      await page.waitForTimeout(800);
    }
    // 固定缓冲，等待图表动画/接口二次加载
    await page.waitForTimeout(1500);
  }

  /** 点击包含指定文字的 Tab，返回是否点击成功 */
  private async clickTabIfPresent(tabName: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      const locator = this.page
        .locator(`[role="tab"], .ant-tabs-tab, [class*="tab"], [class*="Tab"]`)
        .filter({ hasText: tabName })
        .first();

      const visible = await locator.isVisible({ timeout: 2500 }).catch(() => false);
      if (visible) {
        await locator.click({ timeout: 3000 }).catch(() => undefined);
        return true;
      }

      // 兜底：任意包含该文字的可点击元素
      return await this.clickByText(tabName);
    } catch {
      return false;
    }
  }

  /** 通过文本点击元素（兜底） */
  private async clickByText(text: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      const locator = this.page
        .locator(`text=${text}`)
        .first();
      const visible = await locator.isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        await locator.click({ timeout: 3000 }).catch(() => undefined);
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  /** 规范化 Cookie 的 sameSite 字段 */
  private normalizeCookies(cookies: any[]): any[] {
    return cookies
      .filter((c) => c && c.name && c.value)
      .map((c) => {
        let sameSite: 'Strict' | 'Lax' | 'None' | undefined;
        const raw = String(c.sameSite || '').toLowerCase();
        if (raw === 'strict') sameSite = 'Strict';
        else if (raw === 'lax') sameSite = 'Lax';
        else if (raw === 'none' || raw === 'no_restriction') sameSite = 'None';
        return {
          name: c.name,
          value: c.value,
          domain: c.domain || '.alipay.com',
          path: c.path || '/',
          secure: c.secure ?? true,
          httpOnly: c.httpOnly ?? false,
          sameSite,
          expires: c.expires,
        };
      });
  }

  /** 保存当前 Cookie */
  private async saveCookies(): Promise<void> {
    if (!this.context) return;
    const cookies = await this.context.cookies();
    fs.mkdirSync(path.dirname(this.config.cookiePath), { recursive: true });
    fs.writeFileSync(this.config.cookiePath, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`🍪 Cookie 已保存（${cookies.length} 个）`);
  }

  /** 关闭浏览器 */
  private async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

/** 便捷函数：执行一次支付宝全量导出 */
export async function exportAlipayData(
  config: AlipayExportConfig = {}
): Promise<ExportResult> {
  const exporter = new AlipayExporter(config);
  return exporter.export();
}
