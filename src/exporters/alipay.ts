/**
 * 支付宝商家平台数据导出器
 *
 * 使用 Playwright 抓取 b.alipay.com 商家平台的经营数据。
 * - 首次运行 headless:false，手动扫码/账密登录一次，Cookie 持久化到本地
 * - 注意：支付宝服务端会话有效期仅几小时；本地持久化只能在会话有效期内免登。
 *   长期免登依赖【每日定时抓取】来续期会话，隔几小时以上再跑可能需要重新登录。
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
  /**
   * 登录后需要在"请选择登录账号"页选择的企业名（员工身份）。
   * 自动点击该企业卡片进入对应商家后台。留空则不自动选择。
   */
  enterpriseName?: string;
  /**
   * 持久化浏览器用户目录（user-data-dir）。
   * 支付宝数据页除 Cookie 外还依赖 localStorage/IndexedDB 中的登录态，
   * 仅靠 addCookies 的临时 context 每次都会丢失登录态、被踢回登录页。
   * 使用持久化目录后，整套浏览器状态跨次保留，登录一次可长期免登录。
   * 默认存放在项目 src/exporters/browser-profile/。
   */
  userDataDir?: string;
  /**
   * 会话 Cookie 持久化文件。
   * 支付宝关键登录态常为"会话级 Cookie"（无 expires，浏览器关闭即丢），
   * Playwright 独立 profile 关闭后这类 Cookie 不会落盘，导致重开仍要登录。
   * 我们在每次成功运行后把全部 Cookie 强制设一个未来过期时间保存到此文件，
   * 下次启动补注回持久化目录，实现跨次免登录。
   */
  sessionCookiePath?: string;
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
  /**
   * 导出时间范围（天数）。
   * - 1：每日定时任务，点页面"1日"取昨天（用户分析页只有单日，取其默认最近一天）。
   * - 7：首次回填基线，点"7日/近7日"取近7天汇总。
   * 页面上的"30日/自然月"当前不使用（30天为周期汇总，不是每日明细，无法拆成每日快照）。
   */
  daysToDownload?: number;
  /**
   * 指定抓取某一天的数据（YYYY-MM-DD），用于历史回填，例如 '2026-08-18'。
   * 仅在 daysToDownload=1（每日明细）时生效；设置后快照日期即为该日。
   * - 小程序页：URL 直接带 reportDate=YYYYMMDD&subtract=1，最可靠。
   * - 其余页：在 1日 模式下尝试点开日期选择器选中该日；点不中则回退页面默认（昨天）。
   * 不设置时默认取昨天。
   */
  targetDate?: string;
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
    | 'headless'
    | 'slowMo'
    | 'outputDir'
    | 'cookiePath'
    | 'userDataDir'
    | 'sessionCookiePath'
    | 'overviewUrl'
    | 'lifeAccountAppId'
    | 'pageUrls'
  >
> &
  AlipayExportConfig = {
  headless: false,
  slowMo: 300,
  outputDir: path.join(process.cwd(), 'src', 'exporters', 'output'),
  cookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'alipay.json'),
  userDataDir: path.join(process.cwd(), 'src', 'exporters', 'browser-profile'),
  sessionCookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'alipay-session.json'),
  enterpriseName: '深圳市久久金供应链有限公司',
  overviewUrl: 'https://b.alipay.com/page/manage-consultant/data-index',
  lifeAccountAppId: '2017122701284248',
  daysToDownload: 1,
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
    // 快照日期（按上海时区）：
    // - daysToDownload=1（每日追加）：默认取"昨天"；若显式指定 targetDate 则取该日（历史回填）。
    // - daysToDownload=7（首次基线）：取"今天"，存近7日汇总为一条基线快照。
    const days = this.config.daysToDownload === 7 ? 7 : 1;
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const targetDate = (this.config.targetDate || '').trim();
    const dateStr =
      days === 7
        ? now.toISOString().slice(0, 10)
        : targetDate ||
          new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const isBackfill = days === 1 && !!targetDate;
    const rangeLabel =
      days === 7 ? '近7日（基线）' : isBackfill ? `指定日（${targetDate}）` : '昨日（1日）';

    // 小程序页支持通过 URL 参数精确指定日期（reportDate=YYYYMMDD&subtract=1）
    const miniReportDate = dateStr.replace(/-/g, '');

    try {
      await this.init();
      await this.ensureLogin();

      console.log(`\n📊 开始抓取支付宝经营数据（日期范围：${rangeLabel}，快照日期：${dateStr}）...`);

      // 统一策略：使用第一版验证通过的真实 URL 直接访问，并等待数据渲染。
      const page = this.page!;
      const urls = this.config.pageUrls ?? ALIPAY_PAGE_URLS;

      console.log('  [1/6] 经营总览...');
      // ensureLogin 已深链落地在经营总览页；若不在（例如手动登录后落在首页）则再深链一次。
      // 门户首页与经营顾问是两个微前端子应用，必须跨文档深链进入（静默SSO+自动选企业），
      // 不能用菜单/pushState 同文档切换（会落到空白错误页）。
      const cur0 = page.url().split('?')[0].replace(/\/$/, '');
      if (cur0 !== this.config.overviewUrl.split('?')[0].replace(/\/$/, '')) {
        await this.gotoBusinessPage(page, this.config.overviewUrl);
      }
      await this.applyDateRange(page, days);
      const overview = await this.extractPageData(page);

      // 2. 用户分析
      console.log('  [2/6] 用户分析...');
      let user: AlipayPageData;
      try {
        await this.navigateToPage(page, urls.user, { menuText: '用户分析', label: '用户分析' });
        // 用户分析页只有单日日历、无 7日 切换；两种模式都取其默认最近一天
        await this.applyDateRange(page, days);
        user = await this.extractPageData(page);
      } catch {
        user = this.emptyPage();
      }

      // 3. 交易分析
      console.log('  [3/6] 交易分析...');
      let trade: AlipayPageData;
      try {
        await this.navigateToPage(page, urls.trade, { menuText: '交易分析', label: '交易分析' });
        await this.applyDateRange(page, days);
        trade = await this.extractPageData(page);
      } catch {
        trade = this.emptyPage();
      }

      // 4. 流量分析（5 个 Tab，同属一个子应用，通过顶部 Tab 切换，不再逐 URL 深链）
      console.log('  [4/6] 流量分析（5 个 Tab）...');
      const traffic: { tabs: Record<string, AlipayPageData> } = { tabs: {} };
      const trafficTabs: Array<{ key: string; label: string; tabText: string; url: string; pathSeg: string }> = [
        { key: 'overview', label: '流量概览', tabText: '流量概览', url: urls.traffic.overview, pathSeg: '/traffic-analysis/overview' },
        { key: 'miniApp', label: '小程序流量', tabText: '小程序', url: urls.traffic.miniApp, pathSeg: '/traffic-analysis/tinyapp-traffic' },
        { key: 'lifeAccount', label: '生活号+流量', tabText: '生活号', url: urls.traffic.lifeAccount, pathSeg: '/traffic-analysis/life-plus' },
        { key: 'fanGroup', label: '商家粉丝群流量', tabText: '粉丝群', url: urls.traffic.fanGroup, pathSeg: '/traffic-analysis/fans' },
        { key: 'other', label: '其他活跃流量', tabText: '其他', url: urls.traffic.other, pathSeg: '/traffic-analysis/other' },
      ];
      // 先确保落在流量分析页（菜单进入）
      await this.navigateToPage(page, urls.traffic.overview, { menuText: '流量分析', label: '流量分析' }).catch(() => undefined);
      for (const tab of trafficTabs) {
        try {
          // 同一子应用内点顶部 Tab 切换（SPA，不触发 SSO）；点不到或落到错误路径才深链兜底。
          // 关键：点击"生活号"等 Tab 可能误中左侧同名菜单（生活号+分析）跳到别的子应用，
          // 因此必须用期望路径 pathSeg 严格校验落地 URL，不匹配就深链到精确 URL。
          const clicked = await this.clickTrafficTab(tab.tabText, tab.pathSeg);
          if (!clicked) {
            await this.gotoBusinessPage(page, tab.url).catch(() => undefined);
          } else {
            await page.waitForTimeout(1000);
            await this.waitForDataLoaded(page).catch(() => undefined);
          }
          // 抓数据前再兜底校验一次：若仍不在期望路径（深链被重定向等），强制精确深链
          const cur = page.url().split('?')[0];
          if (!cur.includes(tab.pathSeg)) {
            console.log(`    ↪️ ${tab.label}未落在期望路径，精确深链兜底`);
            await this.gotoBusinessPage(page, tab.url).catch(() => undefined);
          }
          // 流量分析 5 个 Tab 共用同一套顶部日期控件，跨 Tab 通常会保留选中范围；
          // 这里仍显式点一次以保证范围正确
          await this.applyDateRange(page, days);
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
        // 生活号+是独立子应用，先深链落地建立上下文，再点日期
        if (!/life-data/.test(page.url())) {
          await this.gotoBusinessPage(page, lifeUrl);
        }
        await this.applyDateRange(page, days);
        lifeAccount = await this.extractPageData(page);
        if (lifeAccount.bodyText.includes('您还没有创建生活号') || lifeAccount.bodyText.includes('还没有创建生活号')) {
          console.log('    ℹ️  当前企业未开通生活号，生活号+分析无数据（属正常状态）');
        }
      } catch {
        lifeAccount = this.emptyPage();
      }

      let fanGroup: AlipayPageData;
      try {
        // 粉丝群与生活号同属"经营阵地"菜单组，优先菜单切换；失败再深链
        await this.navigateToPage(page, urls.fanGroup, { menuText: '粉丝群', label: '商家粉丝群分析' });
        await this.applyDateRange(page, days);
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

      // 保存最新 Cookie（成功路径下当前必然处于登录态）
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

      // 失败时【仅当仍处于登录态】才刷新 Cookie 存档。
      // 关键修复：若中途被支付宝重定向到登录页，浏览器里的 ALIPAYJSESSIONID/auth_jwt
      // 已被服务端失效，此时若无条件 saveCookies，会用未登录态的坏 Cookie 覆盖之前
      // 有效的会话存档，导致第二天定时任务必然要重新登录（雪球式失效）。
      await this.saveCookiesIfLoggedIn().catch(() => undefined);

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

  /** 初始化浏览器（持久化用户目录，保留 Cookie/localStorage/IndexedDB 登录态） */
  private async init(): Promise<void> {
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ];

    const contextOptions = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai' as const,
      args: launchArgs,
      headless: this.config.headless,
      slowMo: this.config.slowMo,
    };

    // 确保持久化目录存在
    fs.mkdirSync(this.config.userDataDir, { recursive: true });

    // 清理上次异常退出残留的单例锁文件，避免 launchPersistentContext 启动失败
    for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lockPath = path.join(this.config.userDataDir, lockName);
      try {
        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }

    // 使用持久化用户目录：整套浏览器状态（Cookie/localStorage/IndexedDB）跨次保留。
    // 优先用系统真实 Chrome（更难被风控识别），失败回退自带 Chromium。
    try {
      this.context = await chromium.launchPersistentContext(this.config.userDataDir, {
        ...contextOptions,
        channel: 'chrome',
      });
      console.log('🌐 使用系统 Chrome 启动（持久化用户目录）');
    } catch {
      this.context = await chromium.launchPersistentContext(this.config.userDataDir, contextOptions);
      console.log('🌐 系统 Chrome 不可用，使用自带 Chromium（持久化用户目录）');
    }

    // 持久化 context 已经是一个 BrowserContext，但没有外层 browser 句柄；
    // 关闭时直接 close context 即可。这里 browser 保持 null。
    this.browser = null;

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

    // 关键：用上次成功运行保存的 Cookie 全集"覆盖写入"支付宝域 Cookie。
    //
    // 背景：会话运行中支付宝会轮换关键登录态 Cookie（ALIPAYJSESSIONID/ctoken/auth_jwt 等），
    // 持久化目录里可能残留"轮换前的旧值"。Playwright 的 addCookies 对"同名+同域+同路径
    // +同 partitionKey"的 Cookie 会直接覆盖，因此把文件里最新的全集 addCookies 一遍，
    // 就能顶掉旧值。
    //
    // 注意：不要用 clearCookies() 清空全部！那会把支付宝之外的设备连续性/风控指纹 Cookie
    // （_uab_collina、_umdata 等）也清掉，支付宝反而把启动判定为"新设备"而要求重新登录。
    // 只 addCookies 我们保存的集合，其它域 Cookie 原样保留。
    const savedCookies = this.loadSessionCookies();
    if (savedCookies.length > 0) {
      await this.context.addCookies(savedCookies);
      const after = await this.context.cookies();
      const afterAlipay = after.filter((c) => c.domain.includes('alipay.com'));
      console.log(`🍪 已用最近保存的登录态覆盖写入 ${savedCookies.length} 个 Cookie（当前支付宝域共 ${afterAlipay.length} 个）`);
    } else {
      // 兜底：没有会话存档时，若持久化目录本身已保留 Cookie 就沿用；否则迁移旧 cookie 文件
      const existingCookies = await this.context.cookies();
      const alipayCookies = existingCookies.filter((c) => c.domain.includes('alipay.com'));
      if (alipayCookies.length > 0) {
        console.log(`🍪 持久化目录已保留 ${alipayCookies.length} 个支付宝 Cookie（无会话存档，沿用）`);
      } else if (fs.existsSync(this.config.cookiePath)) {
        try {
          const cookies = JSON.parse(fs.readFileSync(this.config.cookiePath, 'utf-8'));
          const validCookies = this.normalizeCookies(cookies);
          await this.context.addCookies(validCookies);
          console.log(`🍪 已从旧 cookie 文件迁移 ${validCookies.length} 个 Cookie 到持久化目录`);
        } catch (err) {
          console.warn('⚠️  旧 Cookie 迁移失败（可忽略，重新登录即可）：', err);
        }
      }
    }

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
  }

  /**
   * 从 sessionCookiePath 读取上次保存的 Cookie 全集，强制设置未来过期时间（30 天），
   * 并保留 partitionKey（CHIPS 分区 Cookie，如 _CHIPS-ALIPAYJSESSIONID）。
   * 返回可直接传给 context.addCookies 的 Cookie 数组。
   */
  private loadSessionCookies(): Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
    expires: number;
    partitionKey?: string;
  }> {
    if (!fs.existsSync(this.config.sessionCookiePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.config.sessionCookiePath, 'utf-8')) as Array<Record<string, unknown>>;
      const futureExpires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const out: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        secure: boolean;
        httpOnly: boolean;
        sameSite: 'Strict' | 'Lax' | 'None';
        expires: number;
        partitionKey?: string;
      }> = [];
      for (const c of raw) {
        if (!c || !c.name || !c.value) continue;
        const cookie: {
          name: string;
          value: string;
          domain: string;
          path: string;
          secure: boolean;
          httpOnly: boolean;
          sameSite: 'Strict' | 'Lax' | 'None';
          expires: number;
          partitionKey?: string;
        } = {
          name: String(c.name),
          value: String(c.value),
          domain: c.domain != null ? String(c.domain) : '.alipay.com',
          path: c.path != null ? String(c.path) : '/',
          secure: c.secure == null ? true : Boolean(c.secure),
          httpOnly: c.httpOnly == null ? false : Boolean(c.httpOnly),
          sameSite: this.mapSameSite(c.sameSite),
          expires: futureExpires,
        };
        // 保留分区键（CHIPS Cookie，如 _CHIPS-ALIPAYJSESSIONID 依赖它才能正确发送）
        const pk = c.partitionKey;
        if (pk && typeof pk === 'string') {
          cookie.partitionKey = pk;
        } else if (pk && typeof pk === 'object' && pk !== null && 'topLevelSite' in pk) {
          const v = (pk as { topLevelSite?: unknown }).topLevelSite;
          if (typeof v === 'string') cookie.partitionKey = v;
        }
        out.push(cookie);

        // 关键兼容：支付宝把部分核心会话 Cookie 以 CHIPS 分区形式下发
        // （_CHIPS-ALIPAYJSESSIONID 等）。分区 Cookie 只有在“顶级站点=b.alipay.com”
        // 的上下文才会发送；但访问数据页时会先以顶级站点跳到 auth.alipay.com 做 SSO，
        // 此时分区 Cookie 不会被带上，导致静默 SSO 失败、被踢回登录页。
        // 这里对每个支付宝域的分区 Cookie 再补一份“无分区”副本，使其在 auth.alipay.com
        // 顶级跳转时也能发送，完成静默登录；原分区副本仍保留，不影响 b.alipay.com 内的请求。
        if (cookie.partitionKey && /alipay\.com$/i.test(cookie.domain.replace(/^\./, ''))) {
          const { partitionKey: _omitted, ...unpartitioned } = cookie;
          void _omitted;
          out.push(unpartitioned);
        }
      }
      return out;
    } catch (err) {
      console.warn('⚠️  会话 Cookie 文件读取失败（可忽略）：', err);
      return [];
    }
  }

  /** 把任意来源的 sameSite 值映射为 Playwright 接受的枚举 */
  private mapSameSite(raw: unknown): 'Strict' | 'Lax' | 'None' {
    const v = String(raw ?? '').toLowerCase();
    if (v === 'strict') return 'Strict';
    if (v === 'none' || v === 'no_restriction') return 'None';
    return 'Lax';
  }

  /** 确保已登录，未登录则等待用户手动登录 */
  private async ensureLogin(): Promise<void> {
    if (!this.page || !this.context) throw new Error('浏览器未初始化');

    console.log('🔐 检查支付宝登录状态...');
    // 先打开商家首页（登录入口稳定），避免直接跳深层数据页导致重定向超时
    await this.safeGoto(this.page, 'https://b.alipay.com/');
    await this.page.waitForTimeout(3000);

    const LOGIN_URL_PATTERN = /(auth\.alipay\.com\/login|\/login\/|\/login\b|passport|sign[-_]?in)/i;
    const isLoginUrl = (url: string): boolean => LOGIN_URL_PATTERN.test(url);

    // 判断是否已登录：
    // 1) 若被重定向到登录域 → 未登录
    // 2) 落地在 b.alipay.com（含 portal/home 商家首页）且非登录页 → 视为已登录
    //    （首页文案未必含"交易金额/工作台"等关键词，不能只靠文案判断，否则会误判）
    // 3) 再用数据页能否访问做二次确认
    const looksLoggedIn = async (): Promise<boolean> => {
      const url = this.page!.url();
      if (isLoginUrl(url)) return false;
      const body = await this.getBodyText(this.page!);
      // "请选择登录账号"页虽然在 b.alipay.com 上，但登录尚未完成，不算已登录
      if (body.includes('请选择登录账号') && body.includes('登录员工身份')) return false;
      if (url.includes('b.alipay.com')) return true;
      return /(交易金额|交易笔数|经营总览|活跃用户|累计用户|我的商家|资产|余额|工作台|商家中心|账户|经营效果)/.test(
        body
      );
    };

    if (await looksLoggedIn()) {
      console.log('✅ 已登录（首页校验通过，URL:', this.page.url(), '）');
    } else {
      // 首次判断可能因页面仍在跳转/渲染而误判，给几次重试机会
      let loggedIn = false;
      for (let i = 0; i < 3; i++) {
        await this.page.waitForTimeout(2000);
        if (await looksLoggedIn()) {
          loggedIn = true;
          break;
        }
      }
      if (!loggedIn) {
        // 无头模式下无法手动登录（浏览器不可见），直接失败退出
        if (this.config.headless) {
          console.error('❌ 未登录判定。落地 URL:', this.page.url());
          throw new Error(
            '无头模式下检测到支付宝未登录（Cookie 可能已过期，或被重定向到登录页）。请在终端运行一次 npx tsx src/exporters/test-alipay-full.ts（不加 HEADLESS=1）手动登录以刷新 Cookie。'
          );
        }
        // 交互终端：提示手动登录
        await this.promptManualLogin();
      }
    }

    // 登录后若弹出"请选择登录账号"页，自动选择目标企业账号
    await this.selectEnterpriseIfNeeded();

    // 二次确认：访问一个数据子应用页确认登录态真正可用，并建立经营顾问子应用会话。
    //
    // 关键：预热页【必须用交易分析(trade)】，不要用经营总览(data-index)。
    // 这是 8-18 免登成功时的原始配置：
    //  - 交易分析的静默 SSO 链路最稳，选企业后能干净落地；
    //  - 交易分析与经营总览同属 manage-consultant 经营顾问子应用，预热 trade 后
    //    主流程再深链 data-index 属于同子应用导航，不会再触发硬 SSO。
    // 之前误把预热页换成 data-index，结果其选企业回跳带 ?appScene 命中选择页误判，
    // 后续又错误地用菜单/pushState 绕开深链（门户与经营顾问是独立微前端，
    // pushState 只改地址栏、子应用不加载，会落到开放平台空白错误页）。均已回退。
    //
    // 进入子应用必须跨文档深链，由 auth.alipay.com 做一次静默 SSO；Cookie 有效时
    // 会自动完成并自动选企业、302 回数据页，无需人工登录（8-18 已验证全程不扫码）。
    console.log('🔎 二次确认数据页访问...');
    const warmupUrl = this.config.pageUrls.trade;
    await this.safeGoto(this.page, warmupUrl).catch(() => undefined);
    let dataPageOk = await this.waitForBusinessSettled(this.page, 30_000);

    // 只有当"未明确判定为会话失效"时才回首页预热重试一次（例如子应用冷启动导致的临时跳转）。
    // 若已停在真实登录表单（服务端会话失效），回首页再深链同样会被踢，重试纯属浪费，直接进登录。
    if (!dataPageOk && isLoginUrl(this.page.url())) {
      const interactive = await this.isInteractiveLoginPage(this.page).catch(() => false);
      if (!interactive) {
        console.log('   🔄 数据页未落地（非登录表单），回首页预热会话后重试一次...');
        await this.safeGoto(this.page, 'https://b.alipay.com/').catch(() => undefined);
        await this.page.waitForTimeout(4000);
        await this.selectEnterpriseIfNeeded();
        await this.safeGoto(this.page, warmupUrl).catch(() => undefined);
        dataPageOk = await this.waitForBusinessSettled(this.page, 30_000);
      } else {
        console.log('   ℹ️  已确认为服务端会话失效（登录表单停留），跳过预热重试，直接进入登录');
      }
    }

    if (!dataPageOk) {
      if (this.config.headless) {
        console.error('❌ 数据页最终被重定向到登录页:', this.page.url());
        throw new Error(
          '无头模式下访问数据页被重定向到登录页（Cookie 已失效）。请运行 npx tsx src/exporters/test-alipay-full.ts（不加 HEADLESS=1）重新登录。'
        );
      }
      console.log('⚠️ 数据页需要登录，进入手动登录流程。落地 URL:', this.page.url());
      await this.promptManualLogin();
      // 手动登录成功后等待业务页静默落地（登录后通常还需走一次选企业 + goto 回跳）
      dataPageOk = await this.waitForBusinessSettled(this.page, 25_000);
      if (!dataPageOk) {
        // 手动登录后可能落在首页，再主动跳一次数据页
        await this.safeGoto(this.page, warmupUrl).catch(() => undefined);
        dataPageOk = await this.waitForBusinessSettled(this.page, 20_000);
      }
    }

    if (dataPageOk) {
      console.log('✅ 数据页可访问，登录有效');
    }
  }

  /**
   * 访问数据页后，等待页面"落地"到真正的业务页（而非停在登录/选身份页）。
   *
   * 关键：当落地在 auth.alipay.com/login?goto=... 时，支付宝正在做静默 SSO，
   * 会自动 302 回 goto 指向的数据页。此过程不要重新导航打断它，只轮询等待。
   * 返回 true 表示已稳定落在 b.alipay.com 业务页。
   */
  private async waitForBusinessSettled(page: Page, timeoutMs: number): Promise<boolean> {
    const LOGIN_RE = /(auth\.alipay\.com\/login|\/login\/|\/login\b|passport|sign[-_]?in)/i;
    // 关键修复：选企业回跳到业务页后，URL 上常残留 ?appScene=MRCH 查询参数，
    // 不能仅凭 appScene= 就判定仍在选择页（否则已落到 b.alipay.com 业务页也会被误判、
    // 反复空转直到超时，进而错误地进入手动登录流程）。必须命中"选择/鉴权页路径"才算。
    const SELECT_RE = /(select-identity|select-account|staffmng\/account\/select)/i;
    const isSelectUrl = (url: string): boolean => SELECT_RE.test(url);
    const deadline = Date.now() + timeoutMs;
    let warnedLogin = false;
    // 记录首次落到登录页的时间，用于区分"静默SSO进行中"与"真实登录表单(会话失效)"
    let loginPageSince = 0;
    // 静默 SSO 宽限期：落在登录域后先给这么多毫秒看是否自动跳转；
    // 超过该时间仍停在登录域且登录表单可见，则判定会话失效、快速失败，不再空等。
    const SILENT_SSO_GRACE_MS = 8000;

    while (Date.now() < deadline) {
      const url = page.url();
      const onLogin = LOGIN_RE.test(url);
      const onSelect = isSelectUrl(url);

      if (onLogin) {
        if (!warnedLogin) {
          console.log('   ⏳ 检测到登录页，等待支付宝静默 SSO 自动跳转回数据页（不要打断）...');
          warnedLogin = true;
          loginPageSince = Date.now();
        }
        // 宽限期后仍在登录域、且登录表单已真实可见 → 会话已失效，继续等是徒劳，快速失败
        if (Date.now() - loginPageSince >= SILENT_SSO_GRACE_MS) {
          const interactive = await this.isInteractiveLoginPage(page).catch(() => false);
          if (interactive) {
            console.log('   ℹ️  登录表单已停留超过 8 秒未自动跳转，判定服务端会话已失效，直接进入登录流程');
            return false;
          }
        }
        // 登录页上的静默跳转进行中，只等待，绝不 goto
        await page.waitForTimeout(1500);
        continue;
      } else {
        // 离开登录域（跳去选企业或业务页），重置计时
        loginPageSince = 0;
      }

      if (onSelect) {
        // 选企业/身份页：自动点击目标企业，点击后会跳回业务页
        await this.selectEnterpriseIfNeeded();
        await page.waitForTimeout(2000);
        continue;
      }

      if (url.includes('b.alipay.com')) {
        // 已到业务域，给 SPA 一点渲染/二次鉴权时间后确认
        await page.waitForTimeout(1500);
        const finalUrl = page.url();
        if (!LOGIN_RE.test(finalUrl) && !isSelectUrl(finalUrl)) {
          return true;
        }
      }

      await page.waitForTimeout(1000);
    }
    return false;
  }

  /**
   * 判断当前页是否为"真实可交互的登录表单"（扫码/账密/验证码登录入口已渲染）。
   * 用于区分：会话有效时的静默 SSO（URL 短暂经过登录域但会自动跳走）
   * 与会话失效时停住的登录页（表单可见、不会自动跳，需重新登录）。
   */
  private async isInteractiveLoginPage(page: Page): Promise<boolean> {
    // 任一登录入口可见即认为是真实登录页
    const checks: Array<() => Promise<boolean>> = [
      () => page.locator('input[type="password"]').first().isVisible({ timeout: 300 }).catch(() => false),
      () => page.locator('input[placeholder*="密码"]').first().isVisible({ timeout: 300 }).catch(() => false),
      () => page.locator('input[placeholder*="账户"]').first().isVisible({ timeout: 300 }).catch(() => false),
      () => page.locator('input[placeholder*="账号"]').first().isVisible({ timeout: 300 }).catch(() => false),
      // 登录页 Tab 文案
      () => page.locator('text=扫码登录').first().isVisible({ timeout: 300 }).catch(() => false),
      () => page.locator('text=账密登录').first().isVisible({ timeout: 300 }).catch(() => false),
      () => page.locator('text=验证码登录').first().isVisible({ timeout: 300 }).catch(() => false),
      // 二维码容器常见 class
      () => page.locator('[class*="qrcode"], [class*="qr-code"], iframe[src*="qrcode"]').first().isVisible({ timeout: 300 }).catch(() => false),
    ];
    for (const check of checks) {
      if (await check()) return true;
    }
    return false;
  }

  /**
   * 检测到"选择登录账号/选择身份"页面时，自动点击配置的企业账号卡片。
   * 一个支付宝账号可关联多家企业，登录后或访问特定业务页时会要求选择其中一家。
   * 存在两种选择页：
   *  1) 登录后"请选择登录账号 / 登录员工身份"页；
   *  2) 访问部分业务页被重定向到 staffmng/account/select-identity?appScene=MRCH 页。
   */
  private async selectEnterpriseIfNeeded(): Promise<void> {
    if (!this.page) return;

    const target = this.config.enterpriseName;
    const isSelectPage = (url: string, body: string): boolean => {
      if (url.includes('/staffmng/account/select-identity') || url.includes('select-identity')) return true;
      if (url.includes('/account/select')) {
        // 含企业名选择列表特征才认定，避免误判普通业务页
        if (body.includes('选择') && (body.includes('企业') || body.includes('身份') || body.includes('账号'))) return true;
      }
      // 注意：不能仅凭 URL 带 appScene= 判定选择页——选完企业回跳业务页后该参数会残留，
      // 会导致已落地业务页仍被误判为选择页。
      return body.includes('请选择登录账号') && body.includes('登录员工身份');
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      const url = this.page.url();
      const body = await this.getBodyText(this.page);
      if (!isSelectPage(url, body)) return;

      if (!target) {
        console.warn('⚠️ 当前在账号选择页，但未配置 enterpriseName，无法自动选择');
        return;
      }

      console.log(`🏢 检测到账号/身份选择页，自动选择企业：${target}`);

      // 用文本定位企业卡片（整行可点，事件会冒泡到卡片容器）
      const locator = this.page.locator(`text="${target}"`).first();

      try {
        await locator.waitFor({ timeout: 5000, state: 'visible' });
        await locator.click({ timeout: 5000 });
        console.log('✅ 已点击企业账号，等待跳转...');
        // 点击后会经历 redirectUrl 跳转，等待业务页渲染
        await this.page.waitForTimeout(5000);
        await this.waitForDataLoaded(this.page).catch(() => undefined);
        // 跳转后可能再次落到选择页，循环里会继续处理
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ 点击企业"${target}"失败：${msg}，将重试`);
        await this.page.waitForTimeout(1500);
      }
    }
  }

  /** 交互终端下提示用户手动登录，并自动检测登录成功（最长 5 分钟） */
  /**
   * 账密自动填充兜底：当 session 过期落到登录页时，若配置了环境变量
   * ALIPAY_USERNAME / ALIPAY_PASSWORD，则自动切到「账密登录」Tab 并填写、提交。
   *
   * 重要：支付宝商家后台在自动化/新会话下，账密登录后大概率还要求短信验证码 / 滑块 /
   * APP 确认等二次验证，这一步无法自动完成，需要人工过一下。本方法只负责把
   * "找输入框、输账号密码、点登录"这几步自动化，省去手输；提交后若进入二次验证，
   * 交给 promptManualLogin 等待人工完成。
   *
   * 账号密码只从进程环境变量读取，绝不硬编码、不写文件、不进 git。
   *
   * @returns 'submitted' 已点登录（可能进入二次验证，需继续等待）；
   *          'skipped' 未配置账密或不在账密登录页（调用方走原手动流程）；
   *          'already-in' 当前已经是登录后业务页。
   */
  private async attemptPasswordLogin(): Promise<'submitted' | 'skipped' | 'already-in'> {
    if (!this.page) return 'skipped';
    const username = (process.env.ALIPAY_USERNAME || '').trim();
    const password = process.env.ALIPAY_PASSWORD || '';
    if (!username || !password) return 'skipped';

    const page = this.page;
    const url = page.url();
    // 已经在业务页，无需登录
    if (!/(login|passport|sign[-_]?in)/i.test(url) && url.includes('b.alipay.com')) {
      return 'already-in';
    }

    try {
      console.log('🔑 检测到账密环境变量，尝试自动填写账号密码登录...');

      // 0) 先按 Esc 关闭可能遮挡输入框的 Chrome 原生"保存密码/屏幕锁定"气泡，
      //    这类气泡会导致 input.fill() 因元素被遮挡而抛错、定位不到输入框。
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(120);
      }

      // 1) 切到「账密登录」Tab（登录页默认常停在扫码登录）
      //    支付宝登录页三个 Tab：扫码登录 / 账密登录 / 验证码登录。用文本与常见 class 多策略定位。
      const pwdTabSelectors = [
        'text=账密登录',
        'a:has-text("账密登录")',
        'li:has-text("账密登录")',
        'div:has-text("账密登录")',
        '[class*="password"] [class*="tab"]',
        '[class*="login"] [class*="tab"]:has-text("账密")',
      ];
      for (const sel of pwdTabSelectors) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
          // 避免点到包含该文字的大容器：文本长度限制
          const txt = ((await loc.textContent().catch(() => '')) || '').trim();
          if (txt.length <= 8) {
            await loc.click({ timeout: 3000 }).catch(() => undefined);
            await page.waitForTimeout(800);
            break;
          }
        }
      }
      // 切 Tab 后气泡可能再次弹出，再关一次
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(200);

      // 2) 填账号：明确排除密码框，优先 name/id/placeholder 精确匹配，最后才兜底 type=text
      //    （账号框绝不能匹配到 input[type=password]，否则可能把账号/密码填反）
      const accountInput = page
        .locator(
          [
            'input[name="logonId"]:not([type="password"])',
            'input#login-account:not([type="password"])',
            'input[placeholder*="账户"]:not([type="password"])',
            'input[placeholder*="账号"]:not([type="password"])',
            'input[placeholder*="手机"]:not([type="password"])',
            'input[placeholder*="邮箱"]:not([type="password"])',
            'input[type="text"]:not([type="password"]):visible',
          ].join(', ')
        )
        .first();
      // 填充前先用原生方式清空账号框，避免历史/自动填充内容残留被追加
      await this.clearInputValue(accountInput).catch(() => undefined);
      const accountFilled = await this.typeIntoInput(accountInput, username, 3);
      const accountActual = (await accountInput.inputValue().catch(() => '')).trim();

      // 3) 填密码
      const pwdInput = page
        .locator('input[type="password"], input[name="password"], input[placeholder*="密码"]')
        .first();
      await this.clearInputValue(pwdInput).catch(() => undefined);
      const pwdFilled = await this.typeIntoInput(pwdInput, password, 3);
      // 填完密码后重新读一次账号框，确认没被串入密码
      const accountAfterPwd = (await accountInput.inputValue().catch(() => '')).trim();

      if (!accountFilled || !pwdFilled) {
        console.warn('⚠️  未能定位账密输入框，跳过自动填充（请手动登录）');
        return 'skipped';
      }
      // 关键防串框：账号框内容必须严格等于账号，且不能包含密码（密码被追加/串入会导致登录失败）
      if (accountAfterPwd !== username.trim() || accountAfterPwd.includes(password)) {
        console.warn(
          `⚠️  账号框内容异常（期望手机号，实际长度 ${accountAfterPwd.length}，疑似密码被串入），已清空两框，请手动登录`
        );
        await this.clearInputValue(accountInput).catch(() => undefined);
        await this.clearInputValue(pwdInput).catch(() => undefined);
        return 'skipped';
      }
      console.log('   ✓ 账号密码已填入');
      await page.waitForTimeout(300);

      // 4) 勾选"同意协议"复选框（若存在且未勾选）
      const agree = page
        .locator(
          [
            'input[type="checkbox"]',
            '[class*="checkbox"]:not([class*="checked"])',
            '[class*="agree"] [class*="check"]',
          ].join(', ')
        )
        .first();
      if (await agree.isVisible({ timeout: 600 }).catch(() => false)) {
        await agree.click({ timeout: 2000 }).catch(() => undefined);
      }

      // 5) 提交登录。
      //    支付宝登录按钮可能是 button/div/a/span，且 Chrome 原生"保存密码/屏幕锁定"气泡
      //    会抢走焦点导致按回车无效。因此：先按 Esc 关掉气泡 → 聚焦密码框按回车 →
      //    仍不行则在 DOM 里精确找到蓝色「登录」按钮，用坐标点击。
      let submitted = false;

      // 5.0 关闭可能遮挡/抢焦点的 Chrome 原生气泡（非页面元素，只能用键盘 Esc）
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(150);
      }

      // 5.1 聚焦密码框后按回车（表单原生提交）
      try {
        const pwdInput = page
          .locator('input[type="password"], input[name="password"], input[placeholder*="密码"]')
          .first();
        await pwdInput.click({ timeout: 2000 });
        await page.waitForTimeout(200);
        await pwdInput.press('Enter', { timeout: 2000 });
        submitted = await this.waitLoginSubmitResult(page, 1500);
      } catch {
        /* ignore, fall through */
      }

      // 5.2 直接在 DOM 中找蓝色「登录」按钮并点击（用坐标点中心，绕开元素标签类型问题）
      if (!submitted) {
        submitted = await this.clickLoginButtonByCoordinates(page);
      }

      if (!submitted) {
        console.warn(
          '⚠️  自动提交后仍停留在登录页（可能需要滑块/验证码，或按钮结构变化），请在浏览器手动点登录'
        );
      } else {
        console.log('   ✓ 已提交登录');
      }

      await page.waitForTimeout(2500);
      // 提交后可能进入短信/滑块/APP 确认等二次验证，或直接跳回业务页。
      if (/(验证|短信|滑块|验证码|安全|confirm|sms)/i.test(page.url())) {
        console.log('   🔔 登录后可能需要二次验证（短信/滑块/APP确认），请在浏览器中完成...');
      }
      return submitted ? 'submitted' : 'skipped';
    } catch (err) {
      console.warn('⚠️  账密自动填充过程出错（将回退手动登录）：', err);
      return 'skipped';
    }
  }

  /**
   * 提交后短轮询，判断是否离开了登录表单页（URL 变化或出现二次验证）。
   * 与 hasLeftLoginPage 不同，这里等待一小段时间以捕获跳转过程。
   */
  private async waitLoginSubmitResult(page: Page, waitMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      if (await this.hasLeftLoginPage(page)) return true;
      await page.waitForTimeout(200);
    }
    return this.hasLeftLoginPage(page);
  }

  /**
   * 在登录表单 DOM 中找到蓝色「登录」按钮，用其中心坐标点击。
   * 用 elementFromPoint + boundingBox 直接派发鼠标事件，不依赖标签名和 class。
   */
  private async clickLoginButtonByCoordinates(page: Page): Promise<boolean> {
    // 在页面上下文里找一个文案恰好是「登录」、尺寸像按钮、可见的元素。
    // 注意：evaluate 内不要声明具名函数——esbuild/tsx 会给具名函数加 __name 包装，
    // 序列化到浏览器执行时浏览器没有 __name 会报 ReferenceError。这里全部内联。
    const box = await page.evaluate(() => {
      const all = Array.from(
        document.querySelectorAll('button, a, div, span, input[type="submit"]')
      );
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const txt = (el.textContent || '').replace(/\s+/g, '');
        if (txt !== '登录') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 24) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
          continue;
        }
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      }
      return null;
    });

    if (!box) return false;
    try {
      // 先移动到按钮再按下/抬起，模拟真实点击
      await page.mouse.move(box.x, box.y, { steps: 5 });
      await page.waitForTimeout(120);
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.up();
      return this.waitLoginSubmitResult(page, 2000);
    } catch {
      return false;
    }
  }

  /** 判断是否已离开登录域、开始跳转（用于判定登录提交是否生效） */
  private async hasLeftLoginPage(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (!/(login|passport|sign[-_]?in)/i.test(url)) return true;
      // 部分二次验证页仍在 auth 域但 URL 路径含 validate/confirm，也算已进入登录后流程
      if (/(validate|confirm|check|sms|security)/i.test(url)) return true;
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 用原生 setter 清空输入框 value（不依赖焦点，避免清空错框）。
   */
  private async clearInputValue(locator: ReturnType<Page['locator']>): Promise<void> {
    await locator
      .evaluate((el) => {
        const input = el as HTMLInputElement;
        const proto =
          window.HTMLInputElement.prototype ||
          (Object.getPrototypeOf(input) as typeof HTMLInputElement.prototype);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') {
          desc.set.call(input, '');
        } else {
          input.value = '';
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })
      .catch(() => undefined);
  }

  /**
   * 向输入框填值。【关键】完全绕过焦点和物理键盘，直接在 DOM 上用原生 setter
   * 设置 value 并派发 input/change 事件。这样无论页面焦点被哪个气泡/控件抢走，
   * 值都只会写进「这个 locator 对应的输入框」，绝不会串到账号框或追加内容。
   *
   * 这是应对 React 受控组件 + 抢焦气泡最可靠的方式；填完用 inputValue 严格校验。
   */
  private async typeIntoInput(
    locator: ReturnType<Page['locator']>,
    value: string,
    retries = 3
  ): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 5000 });
        await locator.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);

        // 先尝试 Playwright 原生 fill（它内部会聚焦并覆盖，多数情况可用）
        await locator.fill(value, { timeout: 3000 });
        let actual = await locator.inputValue().catch(() => '');
        if (actual === value) return true;
      } catch {
        /* fall through to native setter */
      }

      // 兜底：用原生 value setter 直接写值，派发 React 需要的 input/change 事件。
      // 不依赖焦点，不会串框、不会追加。
      try {
        await locator.evaluate((el, val) => {
          const input = el as HTMLInputElement;
          const proto =
            window.HTMLInputElement.prototype ||
            (Object.getPrototypeOf(input) as typeof HTMLInputElement.prototype);
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && typeof desc.set === 'function') {
            desc.set.call(input, val);
          } else {
            input.value = val;
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        }, value);
        const actual = await locator.inputValue().catch(() => '');
        if (actual === value) return true;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  private async promptManualLogin(): Promise<void> {
    if (!this.page) throw new Error('页面未初始化');

    // 后台（如 launchd）下无 stdin，不能傻等回车导致进程永久挂起
    const isInteractive = Boolean(process.stdin.isTTY);

    // 优先尝试账密自动填充（仅当配置了 ALIPAY_USERNAME/ALIPAY_PASSWORD 环境变量）
    await this.attemptPasswordLogin();

    if (!isInteractive) {
      // 无人值守（定时任务）：给账密登录 + 可能的二次验证一个有限等待窗口，
      // 成功自动继续；窗口内未成功则抛错退出（exit 1），由脚本触发飞书告警，不挂起进程。
      const ok = await this.waitForLoginCompletion(90_000, false);
      if (!ok) {
        throw new Error(
          '支付宝定时抓取未登录：账密自动登录后在 90 秒内未完成（可能需要短信/滑块二次验证，或账密有误）。请在终端手动运行一次 npx tsx src/exporters/test-alipay-full.ts 完成登录以刷新会话。'
        );
      }
      console.log('✅ 定时任务：登录成功，继续抓取');
      await this.page.waitForTimeout(2000);
      await this.selectEnterpriseIfNeeded();
      return;
    }

    console.log('\n==================================================');
    console.log('📱  请在弹出的浏览器中完成支付宝登录（扫码/账密/验证码）');
    console.log('👉  检测到登录成功后会自动继续（请勿在未登录时按回车跳过）');
    console.log('==================================================\n');

    // 交互终端：自动检测登录（最长 5 分钟）。按回车不会跳过校验，仅提示。
    const ok = await this.waitForLoginCompletion(5 * 60_000, true);
    if (!ok) {
      throw new Error('登录等待超时（5 分钟内未检测到登录成功），已终止本次抓取以避免存入空数据。');
    }

    console.log('⏳ 登录完成，继续抓取...');
    await this.page.waitForTimeout(2000);
    // 手动登录成功后同样可能需要选择企业账号
    await this.selectEnterpriseIfNeeded();
  }

  /**
   * 轮询等待登录完成（离开登录域并落到 b.alipay.com 业务页）。
   * @param timeoutMs 最长等待时间
   * @param listenEnter 是否同时监听终端回车键（交互模式下可手动提前结束等待）
   * @returns 是否在超时前检测到登录成功
   */
  private async waitForLoginCompletion(timeoutMs: number, listenEnter: boolean): Promise<boolean> {
    const page = this.page!;
    const startTime = Date.now();

    // 回车键只作为"提醒/手动检查"，不能用来跳过登录校验：
    // 若仍在登录页，按回车只会打印提示并继续等待，避免未登录就往下抓空数据。
    let onData: ((chunk: Buffer) => void) | null = null;
    if (listenEnter) {
      onData = (): void => {
        // 不 resolve、不移除监听；仅提示一次后继续轮询
        const url = page.url();
        if (/(login|passport|sign[-_]?in)/i.test(url)) {
          console.log('   ⌨️  检测到回车，但仍在登录页，请在浏览器完成登录（自动继续等待，不要重复按回车）...');
        }
      };
      process.stdin.on('data', onData);
      process.stdin.resume();
    }

    const isLoggedIn = async (): Promise<boolean> => {
      try {
        const url = page.url();
        if (/(login|passport|sign[-_]?in)/i.test(url)) return false;
        if (url.includes('b.alipay.com')) return true;
        return /(交易金额|经营总览|工作台|商家中心|经营效果)/.test(await this.getBodyText(page));
      } catch {
        return false;
      }
    };

    try {
      while (Date.now() - startTime < timeoutMs) {
        if (await isLoggedIn()) return true;
        await page.waitForTimeout(1500).catch(() => new Promise((r) => setTimeout(r, 1500)));
      }
      return await isLoggedIn();
    } finally {
      if (onData) {
        process.stdin.removeListener('data', onData);
        onData = null;
      }
    }
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
   * 跳转到业务数据页并等待加载，同时处理可能出现的"选择身份/选择企业"重定向。
   * 部分业务页（如经营总览 data-index）即使已登录，也可能被重定向到
   * staffmng/account/select-identity 要求重新选择企业身份。
   */
  private async gotoBusinessPage(page: Page, url: string): Promise<void> {
    await this.safeGoto(page, url);
    await this.waitForDataLoaded(page);
    // 若被重定向到选择身份页，自动点击目标企业后会跳回 redirectUrl 指向的业务页
    const before = page.url();
    await this.selectEnterpriseIfNeeded();
    const after = page.url();
    if (after !== before) {
      await this.waitForDataLoaded(page).catch(() => undefined);
    }
  }

  /**
   * 会话内导航到某个业务页（避免反复深链触发 auth.alipay.com 严格鉴权）。
   *
   * 背景：脚本若对每个数据页都 page.goto(深链)，每次都是跨文档跳转，都会过一遍
   * auth.alipay.com 的 SSO 鉴权，其冷却只有几小时，导致"离上次登录才几小时又要重登"。
   * 真实用户在已登录后是通过左侧菜单在 SPA 内切换，不会重新走鉴权。
   *
   * 策略：先尝试点击包含 menuText 的左侧菜单项（同域 SPA 路由，不触发 SSO）；
   * 菜单点不到时才回退到深链 goto（兜底，尽量少用）。
   */
  private async navigateToPage(
    page: Page,
    url: string,
    options: { menuText?: string; label: string }
  ): Promise<void> {
    // 已经在目标页就不重复导航
    const cur = page.url();
    const samePath =
      cur.split('?')[0].replace(/\/$/, '') === url.split('?')[0].replace(/\/$/, '');

    if (!samePath && options.menuText) {
      const viaMenu = await this.clickMenuContaining(options.menuText).catch(() => false);
      if (viaMenu) {
        await page.waitForTimeout(1200);
        await this.waitForDataLoaded(page).catch(() => undefined);
        const stillLogin = /auth\.alipay\.com\/login/.test(page.url());
        if (!stillLogin) {
          console.log(`    🧭 通过菜单进入「${options.label}」`);
          return;
        }
        // 菜单点击后反而被踢登录，回退深链（后续 ensureLogin/调用方处理）
        console.log(`    ⚠️ 菜单进入「${options.label}」被踢登录，回退深链`);
      }
    }

    if (!samePath) {
      await this.gotoBusinessPage(page, url);
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

  /** 判断当前是否被重定向到了"创建小程序"引导页（说明子应用上下文未建立） */
  private async isOnCreateMiniProgramPage(): Promise<boolean> {
    if (!this.page) return false;
    const url = this.page.url();
    if (url.includes('/mini-portal/')) return true;
    const body = await this.getBodyText(this.page);
    return body.includes('创建小程序') && body.includes('营业额增长') && body.includes('引流到店');
  }

  /**
   * 通过左侧菜单进入"小程序分析"，建立小程序子应用上下文。
   * 直接 goto mini-data-analysis/v3/* 会被重定向到"创建小程序"引导页，
   * 必须先像真实用户那样从左侧菜单点进来，子应用读取到会话/权限后才会展示数据页。
   *
   * "小程序分析"菜单项位于"经营阵地"分组，与"生活号+分析/商家粉丝群分析"同组，
   * 该套左侧菜单出现在 life-data / 经营阵地 类页面上（不同业务模块菜单不同）。
   * 因此依次在几个已知会渲染该菜单的页面上尝试点击，谁有就从谁进。
   */
  private async enterMiniProgramAnalysis(): Promise<boolean> {
    if (!this.page) return false;
    const urls = this.config.pageUrls ?? ALIPAY_PAGE_URLS;

    // 候选承载页（按"菜单最可能含小程序分析"排序）：
    // 1) 生活号+分析页（已确认正文含"经营阵地 / 小程序分析"菜单）
    // 2) 商家粉丝群分析页
    // 3) 用户分析页（棋盘密云，兜底）
    const carriers: Array<{ name: string; url: string }> = [
      { name: '生活号+分析', url: this.appendQuery(urls.lifeAccount, { appId: this.config.lifeAccountAppId }) },
      { name: '粉丝群分析', url: urls.fanGroup },
      { name: '用户分析', url: urls.user },
    ];

    for (const carrier of carriers) {
      await this.gotoBusinessPage(this.page, carrier.url).catch(() => undefined);
      await this.page.waitForTimeout(2000);
      await this.selectEnterpriseIfNeeded();

      if (await this.clickMenuContaining('小程序分析')) {
        await this.page.waitForTimeout(2500);
        await this.waitForDataLoaded(this.page).catch(() => undefined);
        if (await this.isOnCreateMiniProgramPage()) {
          console.warn('    ⚠️ 从菜单进入后仍落在"创建小程序"引导页，可能该企业无小程序或需初始化看板');
          return false;
        }
        return true;
      }
    }

    // 所有承载页都没找到菜单：打印当前页可见的导航项，便于定位真实文案
    console.warn('    ⚠️ 未能在任何承载页找到"小程序分析"入口');
    await this.dumpVisibleMenuItems();
    return false;
  }

  /**
   * 点击流量分析页顶部的子 Tab（流量概览/小程序/生活号/粉丝群/其他），同子应用 SPA 切换。
   * 返回是否点击成功。
   */
  /**
   * 点击流量分析页顶部的子 Tab。
   * @param tabText 目标 Tab 的显示文字（如"生活号"）
   * @param expectedPathSeg 点击后 URL 必须包含的路径片段（如 "/traffic-analysis/life-plus"），
   *        用于校验确实切到了目标子 Tab，而非误点左侧菜单跳到别的子应用（如生活号+分析→life-data）。
   * @returns true 表示已稳定落在期望路径；false 表示未命中/跳到了错误页面，调用方应深链兜底。
   */
  private async clickTrafficTab(tabText: string, expectedPathSeg: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      // 流量5个子Tab都在 /manage-consultant/traffic-analysis/* 下
      const inTraffic = (u: string): boolean => /\/manage-consultant\/traffic-analysis\//.test(u);
      if (!inTraffic(this.page.url())) return false;

      // 顶部子 Tab 条：它同时包含"流量概览/小程序流量/生活号+流量/商家粉丝群流量/其他活跃流量"。
      // 关键：不能只按 top 区域 + 文字匹配，否则会点到左侧导航菜单里同名/近名的项
      //（左侧"小程序分析/生活号+分析/商家粉丝群分析"），导致 Tab 根本没切、抓成别的页。
      // 这里先定位"同时含流量概览和目标文字"的最小容器（即 Tab 条本身），再在该容器内点目标。
      const clicked = await this.page.evaluate((text) => {
        const all = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="tab"], .ant-tabs-tab, [class*="tabs"] [class*="tab"], div, span, a, li'
          )
        );
        // 找到 Tab 条：一个可见容器，其文本同时包含"流量概览"和至少另一个子 Tab 名
        const tabBar = all.find((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || r.top > 260) return false;
          const t = (el.textContent || '').replace(/\s+/g, '');
          return t.includes('流量概览') && (t.includes('小程序流量') || t.includes('生活号'));
        });
        if (!tabBar) return false;

        // 在 Tab 条内找文本最贴近目标的可点击项
        const items = Array.from(
          tabBar.querySelectorAll<HTMLElement>('[role="tab"], .ant-tabs-tab, a, li, span, div')
        );
        const exact = items.filter((el) => {
          const t = (el.textContent || '').replace(/\s+/g, '').trim();
          return t && t.includes(text) && t.length <= 12;
        });
        // 取最小的（最内层）元素，避免点到整条 Tab 容器
        exact.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
        const target = exact[0];
        if (!target) return false;
        target.scrollIntoView({ block: 'center' });
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }, tabText);

      if (!clicked) return false;

      // 等待 URL 稳定并校验：点击 Tab 后若误中左侧菜单，可能需要 >1.2s 才跳到别的子应用。
      // 因此轮询最多 ~4s，只要 URL 落到期望路径就算成功；若跳到非 traffic-analysis 或
      // 流量分析下但路径不匹配，都判失败让调用方深链兜底。
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        await this.page.waitForTimeout(400);
        const cur = this.page.url();
        if (cur.includes(expectedPathSeg)) {
          await this.waitForDataLoaded(this.page).catch(() => undefined);
          return true;
        }
        // 已跳到其它子应用（如 life-data）——误点左侧菜单，立刻失败
        if (!inTraffic(cur)) {
          console.warn(`    ⚠️ 点「${tabText}」后跳到了非流量页（${cur}），疑似误点左侧菜单，将深链兜底`);
          return false;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 点击左侧菜单中"包含"指定文字的可见项（比 exact 更宽容，避免菜单文案带图标/角标导致定位失败）。
   * 优先点击 <a>/[role="menuitem"]/nav 内的元素。
   */
  private async clickMenuContaining(text: string): Promise<boolean> {
    if (!this.page) return false;

    // 先找可见的菜单链接/菜单项
    const candidates = [
      this.page.locator(`a:has-text("${text}")`),
      this.page.locator(`[role="menuitem"]:has-text("${text}")`),
      this.page.locator(`nav :text("${text}")`),
      this.page.locator(`[class*="menu"] :text("${text}")`),
      this.page.locator(`[class*="sider"] :text("${text}")`),
      this.page.getByText(text, { exact: false }),
    ];

    for (const loc of candidates) {
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = loc.nth(i);
        const visible = await item.isVisible({ timeout: 1500 }).catch(() => false);
        if (!visible) continue;
        // 避免点到只是正文里偶然包含这几个字的大块区域：要求元素本身文本不长
        const ownText = (await item.textContent().catch(() => '')) || '';
        if (ownText.trim().length > 30) continue;
        try {
          await item.scrollIntoViewIfNeeded().catch(() => undefined);
          await item.click({ timeout: 5000 });
          return true;
        } catch {
          // 该元素点不动，试下一个候选
        }
      }
    }
    return false;
  }

  /** 诊断用：打印当前页左侧/导航区域可见的短文本项，帮助定位真实菜单文案 */
  private async dumpVisibleMenuItems(): Promise<void> {
    if (!this.page) return;
    try {
      const items = await this.page.evaluate(() => {
        const out: string[] = [];
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('a, [role="menuitem"], nav *, [class*="menu"] *, [class*="sider"] *')
        );
        for (const el of nodes) {
          const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
          if (t && t.length <= 12 && /[\u4e00-\u9fa5]/.test(t)) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              out.push(t);
            }
          }
        }
        return Array.from(new Set(out)).slice(0, 40);
      });
      console.log('    🔍 当前页可见菜单项:', items.join(' | '));
    } catch {
      /* ignore */
    }
  }

  /**
   * 在小程序分析子应用内导航到指定小程序的指定 Tab。
   * 必须在已进入小程序分析上下文后调用；通过修改 URL 触发子应用内路由切换。
   * 若被重定向到创建页，则返回 false（调用方可重新建立上下文）。
   */
  private async gotoMiniTab(path: string, appId: string, label: string, progName: string): Promise<boolean> {
    if (!this.page) return false;
    // 小程序页支持 URL 精确指定日期：reportDate=YYYYMMDD，subtract=1 表示单日
    const query: Record<string, string> = { appId };
    const miniReportDate = (this.config.targetDate || '').trim().replace(/-/g, '');
    if (miniReportDate) {
      query.reportDate = miniReportDate;
      query.subtract = '1';
    }
    const target = this.appendQuery(path, query);
    await this.safeGoto(this.page, target);
    await this.waitForDataLoaded(this.page);

    if (await this.isOnCreateMiniProgramPage()) {
      console.warn(`    ⚠️ [${progName}] ${label} 被重定向到"创建小程序"页，尝试重建上下文...`);
      // 重建一次上下文后再试
      const ok = await this.enterMiniProgramAnalysis();
      if (!ok) return false;
      await this.safeGoto(this.page, target);
      await this.waitForDataLoaded(this.page);
      if (await this.isOnCreateMiniProgramPage()) return false;
    }
    return true;
  }

  /**
   * 小程序数据：抓取多个小程序，每个抓概览/流量/交易三个 Tab。
   * 小程序真实路径为 /page/mini-data-analysis/v3/{overview,visit,trade}?appId=xxx。
   * 直接 goto 深层 URL 会被重定向到"创建小程序"引导页，因此必须先从左侧菜单
   * 点进"小程序分析"建立子应用上下文，再在子应用内切换小程序与 Tab。
   */
  private async scrapeMiniPrograms(): Promise<{ programs: AlipayProgram[] }> {
    if (!this.page) throw new Error('页面未初始化');
    const urls = this.config.pageUrls ?? ALIPAY_PAGE_URLS;
    const tabPaths: Array<{ key: string; label: string; path: string }> = [
      { key: 'overview', label: '概览', path: urls.miniProgram.overview },
      { key: 'visit', label: '流量', path: urls.miniProgram.visit },
      { key: 'trade', label: '交易', path: urls.miniProgram.trade },
    ];

    // 用户确认的 3 个小程序为权威列表（弹框枚举在重定向场景下不可靠）
    const known: Array<{ id: string; name: string }> = [
      { id: '2019071865846949', name: '黄金回收-久久金管家' },
      { id: '2021001101675556', name: '黄金价格-久久金管家' },
      { id: '2021003182667415', name: '今日金价格-久久金管家' },
    ];
    console.log(`    🔖 待抓取 ${known.length} 个小程序: ${known.map((p) => p.name).join('、')}`);

    // 先从菜单进入小程序分析，建立子应用上下文
    const entered = await this.enterMiniProgramAnalysis();

    // 逐个小程序抓三个 Tab
    const result: AlipayProgram[] = [];
    for (const prog of known) {
      const tabs: Record<string, AlipayProgramTab> = {};
      for (const t of tabPaths) {
        try {
          let data: AlipayPageData | null = null;
          if (entered) {
            const ok = await this.gotoMiniTab(t.path, prog.id, t.label, prog.name);
            if (ok) {
              // 小程序分析各 Tab（概览/流量/交易）顶部都有 1日|7日|30日 控件，
              // 切 Tab/小程序后显式点一次以保证日期范围正确
              await this.applyDateRange(this.page, this.config.daysToDownload === 7 ? 7 : 1);
              data = await this.extractPageData(this.page);
            }
          }
          if (!data) {
            // 上下文建立失败（无小程序/需初始化），记录空数据而非整体中断
            console.warn(`    ⚠️ 小程序[${prog.name}] ${t.label} 未取到数据（可能需要在后台先打开一次该小程序看板）`);
            data = this.emptyPage();
          }
          tabs[t.key] = data;
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
    // 支付宝数据页有常驻轮询/埋点/经营助手长连接，networkidle 永远不会触发，
    // 旧实现会死等 45s 超时（经营总览最重，体感最久）。改为等"数据真正渲染出来"：
    // 正文中出现指标关键词 + 数值/对比，或正文长度达标，即立即继续。
    const start = Date.now();
    const hardDeadline = start + 20000; // 硬性上限 20s，避免极端情况下无限等
    let settled = false;
    while (Date.now() < hardDeadline) {
      const text = (await this.getBodyText(page)).replace(/\s+/g, ' ');
      // 数据就绪信号：出现"较前"（环比对比，所有 KPI 卡片加载完必有）或明确的指标名+数字组合
      const hasCompare = /较前(日|[0-9]+日)/.test(text);
      const hasMetricWithNumber = /(交易金额|访问用户数|访问人数|活跃用户数|交易笔数|总访问用户数)[^0-9]{0,12}[0-9]/.test(
        text
      );
      const bodyLongEnough = text.trim().length > 400;
      if ((hasCompare || hasMetricWithNumber) && bodyLongEnough) {
        settled = true;
        break;
      }
      await page.waitForTimeout(700);
    }
    if (!settled) {
      // 即便没等到理想信号，只要已有实质正文也继续（与旧实现的容错一致）
      const len = (await this.getBodyText(page)).trim().length;
      if (len < 50) {
        // 内容太少，可能还在加载，补一个短缓冲
        await page.waitForTimeout(2000).catch(() => undefined);
      }
    }
    // 短缓冲：等待图表动画/懒加载的二次数据
    await page.waitForTimeout(1200);
  }

  /**
   * 在数据页顶部切换日期范围。
   *
   * 支付宝各页的日期控件有两套文案：
   *  - 经营总览/交易分析/流量分析/粉丝群：`1日 | 7日 | 30日 | 自然月`
   *  - 生活号+分析：`1日 | 近7日 | 近30日`
   *  - 用户分析：只有单日日历，无 7日 切换，两种模式都取其默认单日
   *
   * 本方法只点"1日"或"7日/近7日"两种；找不到对应选项时静默跳过（不报错），
   * 因为用户分析等页没有该控件。点击后等待数据重新加载。
   */
  private async applyDateRange(page: Page, days: 1 | 7): Promise<void> {
    const targets = days === 7 ? ['7日', '近7日'] : ['1日'];

    try {
      // 判断当前正文的对比口径：每日是"较前日"，7日是"较前7日"。
      // 用于点击后校验是否真的切到了目标范围（粉丝群等页默认是7日高亮，不校验可能存错）。
      const detectMode = async (): Promise<'1d' | '7d' | 'unknown'> => {
        const text = (await this.getBodyText(page)).replace(/\s+/g, '');
        // 1日口径文案：粉丝群/经营页是"较前日"，小程序页是"较前1日"
        if (/较前(日|1日)/.test(text)) return '1d';
        // 7日/30日口径："较前7日"、"较前30日"等
        if (/较前[0-9]+日/.test(text)) return '7d';
        return 'unknown';
      };

      const clickRangeTab = async (): Promise<boolean> => {
        return page.evaluate((labels) => {
          // 仅在页面顶部 360px 范围内找候选，避免点到正文/图表里碰巧包含同样文字的元素
          const candidates = Array.from(
            document.querySelectorAll<HTMLElement>('div, span, a, button, li, [role="tab"], [role="button"]')
          ).filter((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.top < 0 || rect.top > 360) return false;
            const text = (el.textContent || '').replace(/\s+/, '').trim();
            if (!labels.includes(text)) return false;
            // 排除过大的容器（日期切换是小标签）
            if (rect.width > 160 || rect.height > 56) return false;
            return rect.width > 0 && rect.height > 0;
          });
          const exact = candidates.find((el) =>
            labels.includes((el.textContent || '').replace(/\s+/, '').trim())
          );
          const el = exact ?? candidates[0];
          if (!el) return false;
          el.scrollIntoView({ block: 'center' });
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return true;
        }, targets);
      };

      const clicked = await clickRangeTab();
      if (clicked) {
        await this.waitForDataLoaded(page);

        // 校验：若口径不对，重试一次（部分页面首次点击未生效/被浮层拦截）
        if (days === 1) {
          let mode = await detectMode();
          if (mode === '7d') {
            console.log('    🔁 检测到仍是7日口径，重试点一次"1日"...');
            await page.waitForTimeout(500);
            if (await clickRangeTab()) {
              await this.waitForDataLoaded(page);
              mode = await detectMode();
            }
          }
          if (mode === '7d') {
            console.warn('    ⚠️ "1日"切换后仍为7日口径，本页可能存入的是7天汇总数据，请人工核对');
          } else {
            console.log('    📅 已切换日期范围：1日（昨日）');
          }
        } else {
          console.log('    📅 已切换日期范围：近7日');
        }
      } else {
        console.log(`    ℹ️  本页未找到「${targets.join('/')}」日期切换（可能为单日页，使用默认日期）`);
      }

      // 历史回填：点完"1日"后，日历默认仍是"昨天"。需要打开日期选择器选中目标日期。
      if (days === 1 && (this.config.targetDate || '').trim()) {
        await this.pickTargetDate(page, this.config.targetDate!.trim());
      }
    } catch (err) {
      console.warn(`    ⚠️  日期范围切换失败（继续使用页面默认日期）：`, err);
    }
  }

  /**
   * 历史回填：在已切到"1日"的页面上，打开日期选择器并选中 targetDate（YYYY-MM-DD）。
   * 支付宝各页日期控件形态不一（Ant Design 日历 / 原生输入），这里用多策略尝试，
   * 任一成功即返回；全部失败则静默回退到页面默认日期（昨天）。
   */
  private async pickTargetDate(page: Page, targetDate: string): Promise<void> {
    if (!page) return;
    const [y, m, d] = targetDate.split('-');
    if (!y || !m || !d) return;
    const dayNum = Number(d).toString(); // 去掉前导 0，匹配日历单元格里的"18"
    const monthLabel = `${y}-${m}`; // AntD 日历标题形如 "2026-08"
    const ymNum = `${y}${m}`;

    try {
      // 1) 点开日期输入框：顶部区域里看起来像日期/日历的可点击元素
      const opened = await page.evaluate(() => {
        const top = Array.from(
          document.querySelectorAll<HTMLElement>('div, span, button, input, [class*="picker"], [class*="date"], [class*="calendar"]')
        ).filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.top > 360 || r.width === 0 || r.height === 0) return false;
          // 命中含日期格式文本 或日历图标的元素
          const t = (el.textContent || '').trim();
          const cls = (el.className && typeof el.className === 'string') ? el.className : '';
          return /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(t) || /picker|date|calendar/i.test(cls);
        });
        // 取最小的可点击元素（避免点到整行容器）
        top.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
        const el = top[0];
        if (!el) return false;
        (el as HTMLElement).scrollIntoView({ block: 'center' });
        (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      });

      if (!opened) {
        console.log('    ℹ️  未找到日期选择器入口，跳过目标日期点选（使用默认日期）');
        return;
      }

      await page.waitForTimeout(600);

      // 2) 在弹出的日历面板里点目标日。AntD 单元格 td[title="2026-08-18"] 最可靠；
      //    兜底则按"月份标题 + 日期数字"找。
      const picked = await page.evaluate(
        ({ full, ym, day, titleAttr }) => {
          const panel = document.querySelector<HTMLElement>(
            '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden), .ant-calendar-picker-container, [class*="picker-dropdown"]:not([class*="hidden"])'
          ) || document.body;

          // 优先：带 title="YYYY-MM-DD" 的单元格
          const byTitle = panel.querySelector<HTMLElement>(`[title="${full}"], [data-date="${full}"]`);
          if (byTitle) {
            byTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return 'title';
          }

          // 兜底：找到包含目标年月的面板，再点日期数字
          const panels = Array.from(panel.querySelectorAll<HTMLElement>('[class*="picker-cell"], td, [role="gridcell"]'));
          for (const cell of panels) {
            const title = cell.getAttribute('title') || '';
            if (title && title.replace(/[^0-9]/g, '').startsWith(ym)) {
              const txt = (cell.textContent || '').replace(/\s+/g, '').trim();
              if (txt === day && !cell.className.includes('disabled')) {
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                return 'cell';
              }
            }
          }

          // 再兜底：输入框直接赋值 + 触发 change（原生 input 场景）
          const input = document.querySelector<HTMLInputElement>(
            '.ant-picker-input input, input[placeholder*="日期"], input[class*="date"]'
          );
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            setter?.set?.call(input, full);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            return 'input';
          }
          void titleAttr;
          return false;
        },
        { full: targetDate, ym: ymNum, day: dayNum, titleAttr: monthLabel }
      );

      if (picked) {
        await this.waitForDataLoaded(page);
        console.log(`    ✅ 已在日历中选中目标日期：${targetDate}（方式：${picked}）`);
      } else {
        console.log(`    ⚠️  未能在日历中选中 ${targetDate}，本页将使用默认日期（建议核对该页是否支持历史日期）`);
      }
    } catch (err) {
      console.warn(`    ⚠️  目标日期点选异常（继续使用默认日期）：`, err);
    }
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

  /** 保存当前 Cookie：写常规 cookie 文件，并把全部 Cookie 设未来过期时间单独持久化（含会话级 Cookie） */
  private async saveCookies(): Promise<void> {
    if (!this.context) return;
    const cookies = await this.context.cookies();
    fs.mkdirSync(path.dirname(this.config.cookiePath), { recursive: true });
    fs.writeFileSync(this.config.cookiePath, JSON.stringify(cookies, null, 2), 'utf-8');

    // 会话 Cookie 持久化：强制设 30 天后过期，写文件 + 在浏览器关闭前重新写回浏览器，
    // 这样 Chrome 退出时会把它们以"持久 Cookie"落盘，而不是当作会话 Cookie 丢弃。
    //
    // 关键原因：运行中支付宝会用 Set-Cookie 把关键登录态改回"会话级（无 expires）"，
    // 若不在关闭前覆盖回去，Chrome 关闭即丢，下次启动目录里登录态残缺、又被踢登录。
    const futureExpires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const persisted = cookies
      .filter((c) => c.domain.includes('alipay.com'))
      .map((c) => this.toPersistedCookie(c, futureExpires));
    fs.writeFileSync(this.config.sessionCookiePath, JSON.stringify(persisted, null, 2), 'utf-8');

    // 关闭前把带过期时间的 Cookie 写回浏览器 Cookie 库，强制 Chrome 持久化到磁盘
    try {
      await this.context.addCookies(persisted);
    } catch (err) {
      console.warn('⚠️  Cookie 回写浏览器失败（不影响本次数据，可能影响下次免登录）：', err);
    }

    // 诊断：打印支付宝关键 Cookie 名（不打印值），便于确认登录态是否落盘
    const alipayNames = cookies.filter((c) => c.domain.includes('alipay.com')).map((c) => c.name);
    console.log(`🍪 Cookie 已保存（${cookies.length} 个，其中支付宝 ${alipayNames.length} 个已设为持久化并回写浏览器）`);
    console.log(`   🔑 支付宝 Cookie: ${alipayNames.join(', ')}`);
  }

  /**
   * 判断当前浏览器是否仍处于支付宝登录态。
   * 用于决定失败时是否刷新 Cookie 存档——避免把"被踢到登录页后的坏 Cookie"存盘。
   */
  private async isLoggedInContext(): Promise<boolean> {
    if (!this.page) return false;
    const url = this.page.url();
    if (!/b\.alipay\.com/.test(url)) return false;
    if (/(login|passport|sign[-_]?in|select-identity|select-account|staffmng\/account\/select)/i.test(url)) {
      return false;
    }
    return true;
  }

  /**
   * 仅当当前仍处于登录态时才保存 Cookie。
   * 抓取中途被重定向到登录页/选择身份页时调用，保护既有有效存档不被污染。
   */
  private async saveCookiesIfLoggedIn(): Promise<void> {
    if (await this.isLoggedInContext()) {
      await this.saveCookies();
    } else {
      console.warn('⚠️  当前处于非登录态页面，跳过 Cookie 存档以保护既有登录态');
    }
  }

  /**
   * 把 context.cookies() 拿到的 Cookie 转成可回写 addCookies 的格式，
   * 并把会话级 Cookie（expires 为 -1/0）设置为未来过期时间。保留 partitionKey。
   */
  private toPersistedCookie(
    c: Awaited<ReturnType<BrowserContext['cookies']>>[number],
    futureExpires: number
  ): {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
    expires: number;
    partitionKey?: string;
  } {
    const out: {
      name: string;
      value: string;
      domain: string;
      path: string;
      secure: boolean;
      httpOnly: boolean;
      sameSite: 'Strict' | 'Lax' | 'None';
      expires: number;
      partitionKey?: string;
    } = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite === 'None' ? 'None' : c.sameSite === 'Strict' ? 'Strict' : 'Lax',
      expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : futureExpires,
    };
    // 保留分区键（CHIPS Cookie，如 _CHIPS-ALIPAYJSESSIONID 需要带分区键才会被正确发送/持久化）
    const pk = c.partitionKey as unknown;
    if (typeof pk === 'string') {
      out.partitionKey = pk;
    } else if (pk && typeof pk === 'object') {
      const v = (pk as { topLevelSite?: unknown }).topLevelSite;
      if (typeof v === 'string') out.partitionKey = v;
    }
    return out;
  }

  /** 关闭浏览器（持久化上下文直接关闭 context，其内部 browser 会一并退出） */
  private async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => undefined);
    } else if (this.browser) {
      await this.browser.close().catch(() => undefined);
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}

/** 便捷函数：执行一次支付宝全量导出 */
export async function exportAlipayData(
  config: AlipayExportConfig = {}
): Promise<ExportResult> {
  const exporter = new AlipayExporter(config);
  return exporter.export();
}
