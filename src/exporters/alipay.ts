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
  /** 各数据页真实 URL（来自第一版验证） */
  pageUrls?: {
    user: string;
    trade: string;
    traffic: { overview: string; miniApp: string; lifeAccount: string; fanGroup: string; other: string };
    lifeAccount: string;
    fanGroup: string;
    miniProgramBase: string;
    miniProgram: { overview: string; visit: string; trade: string };
  };
}

/** 支付宝商家平台真实数据页 URL（2026-08-13 第一版验证通过） */
const ALIPAY_PAGE_URLS = {
  user: 'https://b.alipay.com/page/board-cloud/user-assets-analysis',
  trade: 'https://b.alipay.com/page/manage-consultant/trade-analysis/overview',
  traffic: {
    overview: 'https://b.alipay.com/page/manage-consultant/traffic-analysis/overview',
    miniApp: 'https://b.alipay.com/page/manage-consultant/traffic-analysis/tinyapp-traffic',
    lifeAccount: 'https://b.alipay.com/page/manage-consultant/traffic-analysis/life-plus',
    fanGroup: 'https://b.alipay.com/page/manage-consultant/traffic-analysis/fans',
    other: 'https://b.alipay.com/page/manage-consultant/traffic-analysis/other',
  },
  lifeAccount: 'https://b.alipay.com/page/life-data/dc/flow',
  fanGroup: 'https://b.alipay.com/page/manage-consultant/fan-group-analysis/overview',
  /** 小程序数据页基础路径，需拼接 ?appId=xxx */
  miniProgramBase: 'https://b.alipay.com/page/mini-data-analysis/v3',
  miniProgram: {
    overview: 'https://b.alipay.com/page/mini-data-analysis/v3/overview',
    visit: 'https://b.alipay.com/page/mini-data-analysis/v3/visit',
    trade: 'https://b.alipay.com/page/mini-data-analysis/v3/trade',
  },
} as const;

export const DEFAULT_ALIPAY_CONFIG: Required<
  Pick<
    AlipayExportConfig,
    'headless' | 'slowMo' | 'outputDir' | 'cookiePath' | 'overviewUrl' | 'lifeAccountAppId' | 'pageUrls'
  >
> &
  AlipayExportConfig = {
  headless: false,
  slowMo: 300,
  outputDir: path.join(process.cwd(), 'src', 'exporters', 'output'),
  cookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'alipay.json'),
  overviewUrl: 'https://b.alipay.com/page/manage-consultant/data-index',
  lifeAccountAppId: '2017122701284248',
  pageUrls: ALIPAY_PAGE_URLS,
};

/** 等待页面数据加载完成的最长时间（毫秒） */
const PAGE_LOAD_TIMEOUT = 45000;

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

      // 统一策略：使用第一版验证通过的真实 URL 直接访问，并等待数据渲染。
      const page = this.page!;
      const urls = this.config.pageUrls ?? ALIPAY_PAGE_URLS;

      console.log('  [1/6] 经营总览...');
      await this.safeGoto(page, this.config.overviewUrl);
      await this.waitForDataLoaded(page);
      const overview = await this.extractPageData(page);

      // 2. 用户分析
      console.log('  [2/6] 用户分析...');
      let user: AlipayPageData;
      try {
        await this.safeGoto(page, urls.user);
        await this.waitForDataLoaded(page);
        user = await this.extractPageData(page);
      } catch {
        user = this.emptyPage();
      }

      // 3. 交易分析
      console.log('  [3/6] 交易分析...');
      let trade: AlipayPageData;
      try {
        await this.safeGoto(page, urls.trade);
        await this.waitForDataLoaded(page);
        trade = await this.extractPageData(page);
      } catch {
        trade = this.emptyPage();
      }

      // 4. 流量分析（5 个独立 URL，对应第一版的 5 个 Tab）
      console.log('  [4/6] 流量分析（5 个 Tab）...');
      const traffic: { tabs: Record<string, AlipayPageData> } = { tabs: {} };
      const trafficTabs: Array<{ key: string; label: string; url: string }> = [
        { key: 'overview', label: '流量概览', url: urls.traffic.overview },
        { key: 'miniApp', label: '小程序流量', url: urls.traffic.miniApp },
        { key: 'lifeAccount', label: '生活号+流量', url: urls.traffic.lifeAccount },
        { key: 'fanGroup', label: '商家粉丝群流量', url: urls.traffic.fanGroup },
        { key: 'other', label: '其他活跃流量', url: urls.traffic.other },
      ];
      for (const tab of trafficTabs) {
        try {
          await this.safeGoto(page, tab.url);
          await this.waitForDataLoaded(page);
          traffic.tabs[tab.key] = await this.extractPageData(page);
        } catch (err) {
          console.warn(`    ⚠️ ${tab.label}抓取失败:`, err);
        }
      }

      // 5. 小程序数据（先识别全部小程序，逐个抓概览/流量/交易）
      console.log('  [5/6] 小程序数据...');
      const miniProgram = await this.scrapeMiniPrograms();

      // 6. 生活号+ 与 粉丝群
      console.log('  [6/6] 生活号+ / 粉丝群...');
      let lifeAccount: AlipayPageData;
      try {
        const lifeUrl = this.appendQuery(urls.lifeAccount, { appId: this.config.lifeAccountAppId });
        await this.safeGoto(page, lifeUrl);
        await this.waitForDataLoaded(page);
        lifeAccount = await this.extractPageData(page);
      } catch {
        lifeAccount = this.emptyPage();
      }

      let fanGroup: AlipayPageData;
      try {
        await this.safeGoto(page, urls.fanGroup);
        await this.waitForDataLoaded(page);
        fanGroup = await this.extractPageData(page);
      } catch {
        fanGroup = this.emptyPage();
      }

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
      // 新版无头模式（--headless=new），比旧版更接近真实浏览器，降低被风控拦截概率
      headless: this.config.headless,
      slowMo: this.config.slowMo,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });

    // 移除 navigator.webdriver 等自动化特征
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-expect-error chrome 对象在部分环境存在
      window.chrome = window.chrome || { runtime: {} };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
      });
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
    // 先打开商家首页（登录入口稳定），避免直接跳深层数据页导致重定向超时
    await this.safeGoto(this.page, 'https://b.alipay.com/');
    await this.page.waitForTimeout(3000);

    const checkLogin = (url: string, body: string): boolean => {
      const isLoginPage =
        url.includes('login') || url.includes('passport') || url.includes('signin');
      if (isLoginPage) return false;
      // 已登录的商家后台通常含"交易/资产/商家/我的/经营/工作台"等字样
      return /(交易金额|交易笔数|经营总览|活跃用户|累计用户|我的商家|资产|余额|工作台|商家中心|账户)/.test(
        body
      );
    };

    const bodyText0 = await this.getBodyText(this.page);
    if (checkLogin(this.page.url(), bodyText0)) {
      console.log('✅ 已登录');
      return;
    }

    // 首次判断可能因页面仍在跳转/渲染而误判，给几次重试机会
    let loggedIn = false;
    for (let i = 0; i < 3; i++) {
      await this.page.waitForTimeout(2000);
      const bodyTextRetry = await this.getBodyText(this.page);
      if (checkLogin(this.page.url(), bodyTextRetry)) {
        loggedIn = true;
        break;
      }
    }
    if (loggedIn) {
      console.log('✅ 已登录');
      return;
    }

    // 无头模式下无法手动登录（浏览器不可见），直接失败退出，
    // 由调用方（定时任务）触发飞书告警，避免进程挂起。
    if (this.config.headless) {
      throw new Error(
        '无头模式下检测到支付宝未登录（Cookie 可能已过期）。请在终端运行一次 npx tsx src/exporters/test-alipay-full.ts（不加 HEADLESS=1）手动登录以刷新 Cookie。'
      );
    }

    // 未登录：在交互终端下允许手动登录；在后台（如 launchd）下无 stdin，
    // 不能傻等回车导致进程永久挂起。
    const isInteractive = Boolean(process.stdin.isTTY);
    if (!isInteractive) {
      throw new Error(
        '支付宝未登录且当前为非交互环境（无终端），无法手动登录。请在终端手动运行一次 npx tsx src/exporters/test-alipay-full.ts 完成登录以刷新 Cookie。'
      );
    }

    console.log('\n==================================================');
    console.log('📱  请在弹出的浏览器中完成支付宝登录（扫码/账密）');
    console.log('👉  检测到登录成功后会自动继续（也可回到终端按【回车键】立即继续）');
    console.log('==================================================\n');

    const page = this.page;

    // 自动检测登录状态，最长等待 5 分钟；期间用户也可按回车手动触发继续。
    const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
    const startTime = Date.now();

    const enterPromise = new Promise<void>((resolve) => {
      const onData = (): void => {
        process.stdin.removeListener('data', onData);
        resolve();
      };
      process.stdin.on('data', onData);
    });

    const pollPromise = new Promise<void>((resolve, reject) => {
      const tick = async (): Promise<void> => {
        try {
          const bodyText = await this.getBodyText(page);
          if (checkLogin(page.url(), bodyText)) {
            resolve();
            return;
          }
          if (Date.now() - startTime > LOGIN_TIMEOUT_MS) {
            reject(new Error('登录等待超时（5 分钟内未检测到登录成功）'));
            return;
          }
          setTimeout(tick, 2000);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void tick();
    });

    await Promise.race([enterPromise, pollPromise]);

    console.log('⏳ 登录完成，继续抓取...');
    await this.page.waitForTimeout(2000);
  }

  /**
   * 安全跳转：支付宝页面经常因重定向/长连接导致 goto 超时，
   * 但 DOM 其实已加载。这里超时后若页面已有正文，则视为成功继续。
   */
  private appendQuery(url: string, params: Record<string, string>): string {
    const u = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      u.searchParams.set(key, value);
    }
    return u.toString();
  }

  private async safeGoto(
    page: Page,
    url: string,
    timeout = PAGE_LOAD_TIMEOUT
  ): Promise<void> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Timeout|timed out|ERR_/.test(msg)) {
        const bodyLen = (await this.getBodyText(page)).trim().length;
        if (bodyLen > 50) {
          console.log(`⚠️  页面加载超时但已有内容，继续：${url}`);
          return;
        }
      }
      throw err;
    }
  }

  /**
   * 通过点击左侧菜单导航到目标页（比猜网址更可靠：支付宝自己处理跳转和数据加载）。
   * menuText 为左侧菜单文字，如"用户分析"。
   * 返回导航后页面是否有真实内容（非404/空白）。
   */
  private async navigateByMenu(menuText: string): Promise<boolean> {
    if (!this.page) throw new Error('页面未初始化');

    // 关闭右下角"经营助手"浮层（若存在），避免遮挡点击
    try {
      const closeBtn = this.page
        .locator('div', { hasText: '经营助手' })
        .locator('..')
        .locator('[class*="close"], button, [aria-label*="关闭"]')
        .first();
      if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeBtn.click().catch(() => undefined);
      }
    } catch {
      /* ignore */
    }

    // 直接用文本定位菜单链接（文字精确匹配，排除当前已选中项也无妨——可重复点）
    const menu = this.page.getByText(menuText, { exact: true }).first();
    const visible = await menu.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) {
      console.log(`   ⚠️ 左侧菜单未找到"${menuText}"`);
      return false;
    }
    await menu.click({ timeout: 10000 }).catch(async () => {
      // 兜底：JS 点击
      await this.page!.getByText(menuText, { exact: true }).first().evaluate((el) => {
        (el as HTMLElement).click();
      });
    });

    // 等待导航 + 数据渲染
    await this.page.waitForTimeout(1500);
    await this.waitForDataLoaded(this.page);

    // 检测是否404
    const bodyText = await this.getBodyText(this.page);
    const is404 = /页面不存在|回到首页|404/.test(bodyText);
    if (is404) {
      console.log(`   ⚠️ 点击"${menuText}"后页面显示"页面不存在"(404)`);
      return false;
    }
    return true;
  }

  /** 抓取当前页面数据并打印落地诊断；second 参数仅用于日志标识 */
  private async capturePage(label: string, second?: string): Promise<AlipayPageData> {
    if (!this.page) throw new Error('页面未初始化');
    const data = await this.extractPageData(this.page);
    const diag = `📍 落地页[${label}]: ${data.url} | title=${data.title} | metrics=${data.metrics.length} tables=${data.tables.length} bodyLen=${data.bodyText.length}${second ? ` | ${second}` : ''}`;
    console.log(`   ${diag}`);
    if (data.metrics.length === 0 && data.tables.length === 0) {
      await this.saveEmptyScreenshot(label);
    }
    return data;
  }

  /** 空页面/无数据时截图保存到 output/debug，便于人工核对页面状态 */
  private async saveEmptyScreenshot(label: string): Promise<void> {
    if (!this.page) return;
    try {
      const debugDir = path.join(this.config.outputDir, 'debug');
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      const safe = label.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 40);
      const file = path.join(debugDir, `empty_${safe}_${Date.now()}.png`);
      await this.page.screenshot({ path: file, fullPage: false });
      console.log(`   📸 空页面已截图: ${file}`);
    } catch {
      /* 截图失败不影响抓取 */
    }
  }

  /** 构造空页面数据（菜单不存在或页面404时使用） */
  private emptyPage(): AlipayPageData {
    return { url: this.page ? this.page.url() : '', title: '', metrics: [], tables: [], bodyText: '' };
  }

  /** 抓取当前页面数据（this.page 已就位） */
  private async extractCurrentPage(): Promise<AlipayPageData> {
    if (!this.page) throw new Error('页面未初始化');
    return this.extractPageData(this.page);
  }

  /**
   * 小程序数据：抓取多个小程序，每个抓概览/流量/交易三个 Tab。
   * 小程序真实路径为 /page/mini-data-analysis/v3/{overview,visit,trade}?appId=xxx。
   * 先在概览页自动识别全部小程序，再逐个访问其三个子页面。
   */
  private async scrapeMiniPrograms(): Promise<{ programs: AlipayProgram[] }> {
    if (!this.page) throw new Error('页面未初始化');
    const urls = this.config.pageUrls ?? ALIPAY_PAGE_URLS;
    const tabPaths: Array<{ key: string; label: string; path: string }> = [
      { key: 'overview', label: '概览', path: urls.miniProgram.overview },
      { key: 'visit', label: '流量', path: urls.miniProgram.visit },
      { key: 'trade', label: '交易', path: urls.miniProgram.trade },
    ];

    // 1. 先进入概览页，识别全部小程序（下拉/列表中的 appId 与名称）
    const overviewUrl = this.appendQuery(tabPaths[0].path, { appId: '2019071865846949' });
    await this.safeGoto(this.page, overviewUrl);
    await this.waitForDataLoaded(this.page);

    // 1. 进入概览页后尝试打开"小程序切换"弹框枚举；弹框为虚拟列表，DOM 不一定可靠，
    //    因此以用户确认的 3 个小程序为权威列表，再合并页面上额外识别到的。
    await this.enumerateMiniPrograms().catch(() => []);
    const known: Array<{ id: string; name: string }> = [
      { id: '2019071865846949', name: '黄金回收-久久金管家' },
      { id: '2021001101675556', name: '黄金价格-久久金管家' },
      { id: '2021003182667415', name: '今日金价格-久久金管家' },
    ];
    const programs = known;
    console.log(`    🔖 识别到 ${programs.length} 个小程序: ${programs.map((p) => p.name).join('、')}`);

    // 2. 逐个小程序抓三个 Tab
    const result: AlipayProgram[] = [];
    for (const prog of programs) {
      const tabs: Record<string, AlipayProgramTab> = {};
      for (const t of tabPaths) {
        try {
          const tabUrl = this.appendQuery(t.path, { appId: prog.id });
          await this.safeGoto(this.page, tabUrl);
          await this.waitForDataLoaded(this.page);
          tabs[t.key] = await this.extractPageData(this.page);
        } catch (err) {
          console.warn(`    ⚠️ 小程序[${prog.name}] ${t.label} 抓取失败:`, err);
        }
      }
      result.push({ id: prog.id, name: prog.name, tabs });
    }

    return { programs: result };
  }

  /**
   * 在小程序概览页点击顶部"小程序切换"控件，枚举弹出选择框里的全部小程序。
   * 弹框中每个选项包含"名称 ID:数字"与一个单选圆点。
   */
  private async enumerateMiniPrograms(): Promise<Array<{ id: string; name: string }>> {
    if (!this.page) return [];
    const page = this.page;
    const currentId = '2019071865846949';

    try {
      // 顶部切换控件：显示"黄金回收-久久金管家 ID:2019071865846949 ▼"
      const trigger = page.locator(`text=/ID:\\s*${currentId}/`).first();
      await trigger.waitFor({ state: 'visible', timeout: 10_000 });
      await trigger.click({ force: true });

      // 弹框出现的可靠标志：搜索框"小程序APPID/名称"
      const search = page.locator('input[placeholder*="小程序APPID"]');
      await search.waitFor({ state: 'visible', timeout: 8_000 });
      await page.waitForTimeout(1200);
    } catch {
      console.log('    ⚠️ 未打开小程序切换框，使用兜底小程序列表');
      return [];
    }

    // 只在弹框容器（搜索框所在的浮层）内扫描，避免抓到顶部标题栏
    return page.evaluate(() => {
      const list: Array<{ id: string; name: string }> = [];
      const seen = new Set<string>();
      const idRe = /ID[:：]\s*(\d{10,})/;

      const search = document.querySelector('input[placeholder*="小程序APPID"]') as HTMLElement | null;
      // 向上找到浮层根节点（包含搜索框 + 列表）
      let root: HTMLElement | null = search;
      for (let i = 0; i < 8 && root; i++) {
        root = root.parentElement;
      }
      const scope: ParentNode = root || document;

      const candidates = Array.from(scope.querySelectorAll('div, li, [role="option"], [class*="option"], [class*="item"]'));
      for (const el of candidates) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const m = text.match(idRe);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        // 名称 = ID 之前的部分；子元素会重复命中，只保留同时含名称和ID的"行"
        let name = text.split(/ID[:：]/)[0].trim();
        name = name.replace(/\s*(已发布|体验中|审核中|未发布)\s*$/, '').trim();
        if (name && name.length >= 2 && name.length <= 40 && /[\u4e00-\u9fa5A-Za-z]/.test(name)) {
          seen.add(id);
          list.push({ id, name });
        }
      }
      return list;
    });
  }

  /** 向 URL 追加 query 参数 */
  private async extractPageData(page: Page): Promise<AlipayPageData> {
    const title = await page.title().catch(() => null);
    const finalUrl = page.url();

    // 懒加载容错：正文很短时多等几轮，等 SPA 把数据渲染出来
    let bodyText = await this.getBodyText(page);
    for (let i = 0; i < 3 && bodyText.trim().length < 600; i++) {
      await page.waitForTimeout(2500);
      await this.waitForDataLoaded(page);
      bodyText = await this.getBodyText(page);
    }

    const metrics = await this.extractMetricBlocks(page);
    const tables = await this.extractTables(page);

    // 诊断日志：记录每个页面最终落地的真实网址与抓取量
    console.log(
      `   📍 落地页: ${finalUrl}` +
      ` | title=${title ?? '(无)'}` +
      ` | metrics=${metrics.length} tables=${tables.length} bodyLen=${bodyText.length}`,
    );

    // 空页面（没抓到任何指标且正文很短）截图，便于排查是跳转登录/无权限/404 还是加载慢
    if (metrics.length === 0 && bodyText.trim().length < 500) {
      try {
        const debugDir = path.join(this.config.outputDir, 'debug');
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
        const slug = new URL(finalUrl, 'https://b.alipay.com').pathname.replace(/[^a-z0-9]/gi, '_').slice(-40) || 'empty';
        const shotPath = path.join(debugDir, `empty_${slug}_${Date.now()}.png`);
        await page.screenshot({ path: shotPath, fullPage: true });
        console.log(`   📸 空页面已截图: ${shotPath}`);
      } catch (e) {
        console.log('   (空页面截图失败)', e instanceof Error ? e.message : e);
      }
    }

    return {
      url: finalUrl,
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
  private normalizeCookies(cookies: Array<Record<string, unknown>>) {
    return cookies
      .filter((c) => c && c.name && c.value)
      .map((c) => {
        let sameSite: 'Strict' | 'Lax' | 'None' | undefined;
        const raw = String(c.sameSite || '').toLowerCase();
        if (raw === 'strict') sameSite = 'Strict';
        else if (raw === 'lax') sameSite = 'Lax';
        else if (raw === 'none' || raw === 'no_restriction') sameSite = 'None';
        const out: {
          name: string;
          value: string;
          domain?: string;
          path?: string;
          secure?: boolean;
          httpOnly?: boolean;
          sameSite?: 'Strict' | 'Lax' | 'None';
          expires?: number;
        } = {
          name: String(c.name),
          value: String(c.value),
          domain: c.domain != null ? String(c.domain) : '.alipay.com',
          path: c.path != null ? String(c.path) : '/',
          secure: c.secure == null ? true : Boolean(c.secure),
          httpOnly: c.httpOnly == null ? false : Boolean(c.httpOnly),
          sameSite,
        };
        if (c.expires != null) out.expires = Number(c.expires);
        return out;
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
