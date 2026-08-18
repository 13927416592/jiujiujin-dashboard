import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { ExportResult, ExportConfig, RawData, UnifiedMetrics } from './types';

export interface MeituanExportConfig extends ExportConfig {
  reportName?: string;
  reportUrl?: string;
  cookieFile?: string;
  /** 持久化浏览器用户目录（保留 Cookie/localStorage/IndexedDB，实现跨次免登录） */
  userDataDir?: string;
  /** 会话 Cookie 持久化文件（强制未来过期，补注重启） */
  sessionCookiePath?: string;
  /** 登录后判断"已登录"的企业/门店名称（页面左上角展示名） */
  accountName?: string;
  /** 要下载的报表模板名称（报表中心卡片标题） */
  reportCardName?: string;
  /** 下载近几天的数据（默认 1，即昨天） */
  daysToDownload?: number;
}

/** 默认配置（供测试脚本/API 使用） */
export const DEFAULT_MEITUAN_CONFIG: Required<
  Pick<
    MeituanExportConfig,
    | 'headless'
    | 'slowMo'
    | 'outputDir'
    | 'cookiePath'
    | 'reportUrl'
    | 'userDataDir'
    | 'sessionCookiePath'
    | 'accountName'
    | 'reportCardName'
    | 'daysToDownload'
  >
> &
  MeituanExportConfig = {
  headless: false,
  slowMo: 0,
  outputDir: path.join(process.cwd(), 'src', 'exporters', 'output'),
  cookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json'),
  cookieFile: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json'),
  reportUrl: 'https://e.dianping.com/',
  userDataDir: path.join(process.cwd(), 'src', 'exporters', 'browser-profile-meituan'),
  sessionCookiePath: path.join(
    process.cwd(),
    'src',
    'exporters',
    'cookies',
    'meituan-session.json'
  ),
  accountName: '久久金管家',
  reportCardName: '久久金美团经营数据',
  daysToDownload: 1,
};

interface MeituanReportRow {
  [key: string]: string | number;
}

/** 判断某个 Cookie 域名是否属于美团/点评系 */
function isMeituanDomain(domain: string): boolean {
  return /(^|\.)(meituan\.com|dianping\.com|maoyan\.com|meituan\.net)$/i.test(domain);
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
  config: Required<
    Pick<
      MeituanExportConfig,
      | 'headless'
      | 'slowMo'
      | 'outputDir'
      | 'cookiePath'
      | 'reportUrl'
      | 'userDataDir'
      | 'sessionCookiePath'
      | 'accountName'
      | 'reportCardName'
      | 'daysToDownload'
    >
  > &
    MeituanExportConfig;

  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(config: MeituanExportConfig) {
    this.config = { ...DEFAULT_MEITUAN_CONFIG, ...config } as typeof this.config;
  }

  /** 兼容 API 路由：初始化浏览器 */
  async init(headless?: boolean): Promise<void> {
    if (this.context) return;
    if (typeof headless === 'boolean') this.config.headless = headless;
    await this.launch();
  }

  /** 初始化浏览器（持久化用户目录，保留整套登录态跨次免登录） */
  private async launch(): Promise<void> {
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

    fs.mkdirSync(this.config.userDataDir, { recursive: true });

    // 清理上次异常退出残留的单例锁，避免持久化上下文启动失败
    for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lockPath = path.join(this.config.userDataDir, lockName);
      try {
        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    }

    // 优先用系统真实 Chrome（更难被风控识别），失败回退自带 Chromium
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

    // 隐藏自动化特征
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // @ts-expect-error chrome 对象在部分环境存在
      window.chrome = window.chrome || { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    });

    // 用上次保存的会话 Cookie 全集覆盖写入美团/点评域（顶掉可能被轮换的旧值）
    const savedCookies = this.loadSessionCookies();
    if (savedCookies.length > 0) {
      await this.context.addCookies(savedCookies);
      const after = await this.context.cookies();
      const afterMt = after.filter((c) => isMeituanDomain(c.domain));
      console.log(
        `🍪 已用最近保存的登录态覆盖写入 ${savedCookies.length} 个 Cookie（当前美团/点评域共 ${afterMt.length} 个）`
      );
    } else {
      const existing = await this.context.cookies();
      const mtCookies = existing.filter((c) => isMeituanDomain(c.domain));
      if (mtCookies.length > 0) {
        console.log(`🍪 持久化目录已保留 ${mtCookies.length} 个美团/点评 Cookie（无会话存档，沿用）`);
      } else if (fs.existsSync(this.config.cookiePath)) {
        try {
          const cookies = JSON.parse(fs.readFileSync(this.config.cookiePath, 'utf-8')) as Array<{
            name?: unknown;
            value?: unknown;
            domain?: unknown;
          }>;
          const valid = this.normalizeCookies(cookies);
          await this.context.addCookies(valid);
          console.log(`🍪 已从旧 Cookie 文件迁移 ${valid.length} 个 Cookie 到持久化目录`);
        } catch (err) {
          console.warn('⚠️  旧 Cookie 迁移失败（可忽略，重新登录即可）：', err);
        }
      }
    }

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
  }

  /**
   * 从会话存档读取上次保存的 Cookie，强制设置未来过期时间（30 天），
   * 返回可直接 addCookies 的数组。
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
  }> {
    if (!fs.existsSync(this.config.sessionCookiePath)) return [];
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.config.sessionCookiePath, 'utf-8')
      ) as unknown[];
      const futureExpires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const out: ReturnType<MeituanExporter['loadSessionCookies']> = [];
      for (const item of raw) {
        const c = item as Record<string, unknown>;
        if (!c || typeof c.name !== 'string' || typeof c.value !== 'string') continue;
        const domain = typeof c.domain === 'string' ? c.domain : '.dianping.com';
        out.push({
          name: c.name,
          value: c.value,
          domain,
          path: typeof c.path === 'string' ? c.path : '/',
          secure: c.secure !== false,
          httpOnly: c.httpOnly === true,
          sameSite: this.mapSameSite(c.sameSite),
          expires:
            typeof c.expires === 'number' && c.expires > 0 ? c.expires : futureExpires,
        });
      }
      return out;
    } catch (err) {
      console.warn('⚠️  读取会话 Cookie 存档失败：', err);
      return [];
    }
  }

  private mapSameSite(raw: unknown): 'Strict' | 'Lax' | 'None' {
    if (raw === 'Strict' || raw === 'strict') return 'Strict';
    if (raw === 'None' || raw === 'no_restriction' || raw === 'none') return 'None';
    return 'Lax';
  }

  /** 把任意来源 Cookie 规整为 Playwright 可接受格式 */
  private normalizeCookies(cookies: unknown[]): Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
    expires?: number;
  }> {
    const out: ReturnType<MeituanExporter['normalizeCookies']> = [];
    for (const item of cookies) {
      const c = item as Record<string, unknown>;
      if (!c || typeof c.name !== 'string' || typeof c.value !== 'string') continue;
      const domain = typeof c.domain === 'string' && c.domain ? c.domain : '.dianping.com';
      const entry: (typeof out)[number] = {
        name: c.name,
        value: c.value,
        domain,
        path: typeof c.path === 'string' && c.path ? c.path : '/',
        secure: c.secure !== false,
        httpOnly: c.httpOnly === true,
        sameSite: this.mapSameSite(c.sameSite),
      };
      if (typeof c.expires === 'number' && c.expires > 0) entry.expires = c.expires;
      out.push(entry);
    }
    return out;
  }

  /** 兼容 API 路由：加载 Cookie（持久化上下文下主要用于兼容，实际 launch 已注入） */
  async loadCookies(cookieFile?: string): Promise<void> {
    if (!this.context) throw new Error('浏览器未初始化，请先调用 init()');
    const cookiePath = cookieFile || this.config.cookiePath!;
    if (fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
      const valid = this.normalizeCookies(cookies);
      await this.context.addCookies(valid);
      console.log(`🍪 已加载 ${valid.length} 个 Cookie`);
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
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
      this.page = null;
    }
  }

  async export(): Promise<ExportResult> {
    if (!this.context) {
      await this.launch();
    }
    if (!this.context || !this.page) {
      throw new Error('浏览器初始化失败');
    }

    let downloadFilePath: string | undefined;
    try {
      const page = this.page;

      await this.ensureLogin();

      // 首页常有"新功能引导"遮罩(driver.js)、公告弹窗等拦截点击，先统一关闭
      await this.dismissOverlays(page);

      console.log('📊 导航到经营参谋 -> 报表中心...');
      const reportPage = await this.navigateToReportCenter(page);

      console.log('⏳ 等待报表中心加载...');
      await this.waitForReportCenter(reportPage);

      console.log(' 点击"使用模板"...');
      const useTemplateBtn = reportPage.locator('text=使用模板').first();
      if (await useTemplateBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
        await useTemplateBtn.click();
        await reportPage.waitForTimeout(3000);
      } else {
        throw new Error('未找到"使用模板"按钮');
      }

      console.log('⏳ 等待下载对话框...');
      const dialog = reportPage.locator(`text=${this.config.reportCardName}`).first();
      await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
      await reportPage.waitForTimeout(2000);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - this.config.daysToDownload);
      const dateStr = yesterday.toISOString().split('T')[0];
      console.log(` 设置日期范围：${dateStr}`);

      const dateInput = reportPage.locator('text=请选择时间范围').first();
      if (await dateInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dateInput.click();
        await reportPage.waitForTimeout(1000);

        const dateCell = reportPage.locator(`text=${yesterday.getDate()}`).first();
        if (await dateCell.isVisible({ timeout: 2000 }).catch(() => false)) {
          await dateCell.click();
          await reportPage.waitForTimeout(1000);
        }
      }

      console.log('⬇️  点击下载...');
      const downloadBtn = reportPage.locator('button:has-text("下载")').last();
      if (!(await downloadBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('未找到"下载"按钮');
      }

      const [download] = await Promise.all([
        reportPage.waitForEvent('download', { timeout: 60000 }),
        downloadBtn.click(),
      ]);

      const fileName = `meituan_report_${dateStr}.xlsx`;
      downloadFilePath = path.join(this.config.outputDir, fileName);
      fs.mkdirSync(this.config.outputDir, { recursive: true });
      await download.saveAs(downloadFilePath);
      console.log(` 文件已保存：${downloadFilePath}`);

      const data = this.parseExcel(downloadFilePath);

      const jsonPath = downloadFilePath.replace('.xlsx', '.json');
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`📊 JSON 已保存：${jsonPath}`);

      // 下载成功后保存最新登录态（含会话 Cookie 持久化与回写）
      await this.saveCookies();

      return {
        success: true,
        platform: 'meituan',
        accountId: 'jiujiujin',
        data: data as unknown as Record<string, unknown>[],
        filePath: jsonPath,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // 失败也尝试保存一次 Cookie（可能是半登录态，便于排查）
      await this.saveCookies().catch(() => undefined);
      return {
        success: false,
        platform: 'meituan',
        accountId: 'jiujiujin',
        error: msg,
        filePath: downloadFilePath,
        timestamp: new Date().toISOString(),
      };
    } finally {
      await this.close();
    }
  }

  /**
   * 检查美团/点评商家后台登录态，必要时引导手动登录。
   * - 已登录：直接返回
   * - 未登录且有终端：打开登录页，自动轮询检测登录成功（也可回车继续）
   * - 未登录且非交互环境（launchd）：直接抛错退出，触发告警，不挂起
   */
  private async ensureLogin(): Promise<void> {
    if (!this.page) throw new Error('浏览器未初始化');
    const page = this.page;

    console.log('🔐 检查美团/点评商家后台登录状态...');
    await page.goto(this.config.reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(
      () => undefined
    );
    await page.waitForTimeout(3000);

    if (await this.looksLoggedIn(page)) {
      console.log('✅ 已登录（URL:', page.url(), '）');
      return;
    }

    // 给页面跳转/渲染几轮重试机会
    let loggedIn = false;
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(2000);
      if (await this.looksLoggedIn(page)) {
        loggedIn = true;
        break;
      }
    }
    if (loggedIn) {
      console.log('✅ 已登录（URL:', page.url(), '）');
      return;
    }

    if (this.config.headless || !process.stdin.isTTY) {
      const reason = this.config.headless ? '无头模式' : '非交互环境（无终端）';
      console.error(`❌ ${reason}下检测到美团未登录。落地 URL:`, page.url());
      throw new Error(
        `${reason}下美团商家后台未登录（Cookie 可能已过期）。请在终端运行一次 npx tsx src/exporters/test-meituan-report.ts（不加 HEADLESS=1）手动登录以刷新登录态。`
      );
    }

    await this.promptManualLogin(page);
  }

  /** 判断当前页是否处于已登录状态 */
  private async looksLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    // 落在登录/通行证域 => 未登录
    if (/(passport|login|signin|sso)\./i.test(url) || /\/login\b/i.test(url)) {
      return false;
    }
    const body = await this.getBodyText(page);
    // 出现登录表单特征 => 未登录
    if (
      body.includes('扫码登录') ||
      body.includes('账号密码登录') ||
      body.includes('手机号登录')
    ) {
      return false;
    }
    // 出现配置的账号名（左上角主体名称）=> 已登录
    if (this.config.accountName && body.includes(this.config.accountName)) return true;
    // 落在 e.dianping.com 业务域且有经营参谋等业务菜单 => 已登录
    if (
      url.includes('e.dianping.com') &&
      (body.includes('经营参谋') || body.includes('报表中心') || body.includes('退出'))
    ) {
      return true;
    }
    return false;
  }

  private async getBodyText(page: Page): Promise<string> {
    try {
      return (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')) || '';
    } catch {
      return '';
    }
  }

  /** 引导用户在浏览器中完成登录，自动检测登录成功后继续（避免傻等回车） */
  private async promptManualLogin(page: Page): Promise<void> {
    console.log('\n==================================================');
    console.log('📱  请在弹出的浏览器中完成美团商家后台登录（扫码/账密）');
    console.log('👉  检测到登录成功后会自动继续（也可回到终端按【回车键】立即继续）');
    console.log('==================================================\n');

    await page.goto(this.config.reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(
      () => undefined
    );

    const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
    const startTime = Date.now();

    // stdin 监听器结束时显式移除，避免 TTY 句柄导致 Node 进程不退出
    let onData: ((chunk: Buffer) => void) | null = null;
    const enterPromise = new Promise<void>((resolve) => {
      onData = (): void => {
        if (onData) process.stdin.removeListener('data', onData);
        onData = null;
        resolve();
      };
      process.stdin.on('data', onData);
    });

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pollPromise = new Promise<void>((resolve, reject) => {
      const tick = async (): Promise<void> => {
        if (stopped) return;
        try {
          if (await this.looksLoggedIn(page)) {
            resolve();
            return;
          }
          if (Date.now() - startTime > LOGIN_TIMEOUT_MS) {
            reject(new Error('登录等待超时（5 分钟内未检测到登录成功）'));
            return;
          }
          if (!stopped) timer = setTimeout(tick, 2000);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void tick();
    });

    try {
      await Promise.race([enterPromise, pollPromise]);
    } finally {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (onData) {
        process.stdin.removeListener('data', onData);
        onData = null;
      }
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
    }

    console.log('⏳ 登录完成，继续抓取...');
    await page.waitForTimeout(2000);
  }

  /**
   * 彻底关闭美团首页的 driver.js 新功能引导遮罩。
   * 历史上 8/14 成功下载时这一步是用户手工点掉"知道了"完成的。
   *
   * 关键点：driver.js 不仅插入 .driver-overlay 等元素，还会在 <body> 上加
   * `driver-active driver-fade` 两个 class，CSS 通过 body.driver-active 让整个页面
   * 拦截指针事件。因此必须：1) 点掉气泡走完引导；2) 移除 body/html 上的 driver class；
   * 3) 删除所有 driver 元素；4) 重置 body 样式；5) 用 MutationObserver 阻止它重建。
   */
  private async dismissOverlays(page: Page): Promise<void> {
    // 先尝试点"知道了/跳过"把多步引导走完（最多 6 次）
    const dismissTexts = ['知道了', '我知道了', '跳过', '跳过引导', '完成', '不再提示', '下次再说', '关闭'];
    await page.waitForTimeout(500);
    for (let i = 0; i < 6; i++) {
      let clicked = false;
      for (const text of dismissTexts) {
        const btn = page
          .locator(
            `.driver-popover :has-text("${text}"), button:has-text("${text}"), [role="button"]:has-text("${text}"), a:has-text("${text}"), span:has-text("${text}"), div.driver-popover-item:has-text("${text}")`
          )
          .first();
        if (await btn.isVisible({ timeout: 400 }).catch(() => false)) {
          await btn.click({ timeout: 1500 }).catch(() => undefined);
          await page.waitForTimeout(400);
          clicked = true;
          break;
        }
      }
      if (!clicked) break;
    }

    // 从 DOM 根上彻底清除 driver.js：删 body/html class、删所有 driver 元素、重置样式、
    // 并挂一个 MutationObserver，在接下来的 3 秒内自动移除任何被重建的 driver 节点。
    const removed = await page
      .evaluate(() => {
        let count = 0;
        const kill = (): number => {
          let n = 0;
          // 1) 移除 body/html 上的 driver class（这是指针拦截的根源）
          for (const el of [document.body, document.documentElement]) {
            if (!el) continue;
            for (const cls of Array.from(el.classList)) {
              if (cls && cls.toLowerCase().startsWith('driver')) {
                el.classList.remove(cls);
                n++;
              }
            }
          }
          // 2) 删除所有 class 含 driver 的元素（遮罩 SVG、高亮层、气泡等）
          document.querySelectorAll('[class*="driver"]').forEach((el) => {
            // 不要误删业务元素：只删明显是 driver 遮罩/弹层的节点
            const cls = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase();
            if (
              cls.includes('driver-overlay') ||
              cls.includes('driver-popover') ||
              cls.includes('driver-highlight') ||
              cls.includes('driver-stage')
            ) {
              el.remove();
              n++;
            }
          });
          // 3) 重置 body/html 样式
          document.body.style.removeProperty('overflow');
          document.body.style.removeProperty('pointer-events');
          document.body.style.removeProperty('position');
          document.documentElement.style.removeProperty('overflow');
          return n;
        };

        count += kill();

        // 4) 阻止 driver.js 在接下来几秒重建遮罩（引导翻页会重建）
        try {
          const observer = new MutationObserver(() => {
            count += kill();
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          setTimeout(() => observer.disconnect(), 3000);
        } catch {
          /* MutationObserver 不可用时忽略 */
        }
        return count;
      })
      .catch(() => 0);

    if (removed > 0) {
      console.log(`   🧹 已清理引导遮罩（移除 ${removed} 处 driver 节点/class）`);
    }
    await page.waitForTimeout(500);
  }

  /**
   * 关闭右侧"重点消息"通知面板、顶部命令行提示条等非引导浮层。
   * 这些浮层会抢占焦点/改变布局，但不属于 driver.js 引导，单独处理。
   */
  private async closeFloatingPanels(page: Page): Promise<void> {
    // 按 Escape 关闭可能打开的弹窗/下拉
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(300);

    // 关闭右侧"重点消息"面板：找其右上角 X 关闭按钮
    const closeButtons = page.locator(
      '[class*="message"] [class*="close"], [class*="notice"] [class*="close"], [class*="drawer"] [class*="close"], [aria-label="关闭"], button[class*="close"]'
    );
    const count = await closeButtons.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = closeButtons.nth(i);
      if (await btn.isVisible({ timeout: 400 }).catch(() => false)) {
        await btn.click({ timeout: 1500 }).catch(() => undefined);
        await page.waitForTimeout(300);
      }
    }

    // 关闭顶部"不支持的命令行标记"提示条（若有 X）
    const topBarClose = page.locator('text=--disable-setuid-sandbox').first();
    if (await topBarClose.isVisible({ timeout: 500 }).catch(() => false)) {
      const x = page.locator('button:has(svg), [class*="close"]').last();
      await x.click({ timeout: 1000 }).catch(() => undefined);
    }
  }

  private async navigateToReportCenter(page: Page): Promise<Page> {
    if (!this.context) throw new Error('浏览器未初始化');

    // 监听新标签页：美团后台的"经营参谋/报表中心"历史上在当前页跳转，
    // 但也可能因改版在新 tab 打开，这里统一检测并切换。
    const newPages: Page[] = [];
    const onNewPage = (p: Page): void => {
      newPages.push(p);
    };
    this.context.on('page', onNewPage);

    try {
      // 注意：这里沿用历史已验证可用的最简导航逻辑（纯 text 选择器 + networkidle），
      // 不要加侧边栏作用域/遮罩移除等"优化"，它们曾导致子菜单点击失效。
      await page.goto('https://e.dianping.com/', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);

      // 关闭右侧"重点消息"面板等浮层，再清理 driver.js 引导遮罩
      await this.closeFloatingPanels(page);
      await this.dismissOverlays(page);

      // 方案 A：优先点首页中部"经营参谋"卡片右上角的"查看更多"，直接进入经营参谋页面。
      // 这是当前（侧边栏收起状态下）最可靠的入口。
      let enteredAdvisor = false;
      const advisorCardMore = page
        .locator('text=经营参谋')
        .first()
        .locator('xpath=ancestor::*[self::div or self::section][1]')
        .locator('text=查看更多')
        .first();
      // 上面的 ancestor 定位不一定稳定，再准备一个更直接的：
      const viewMoreNearAdvisor = page.locator('text=查看更多').first();

      console.log(' 进入"经营参谋"...');
      if (await advisorCardMore.isVisible({ timeout: 3000 }).catch(() => false)) {
        await advisorCardMore.click({ timeout: 6000 }).catch(async () => {
          await advisorCardMore.click({ timeout: 5000, force: true }).catch(() => undefined);
        });
        enteredAdvisor = true;
      } else if (await viewMoreNearAdvisor.isVisible({ timeout: 3000 }).catch(() => false)) {
        await viewMoreNearAdvisor.click({ timeout: 6000 }).catch(async () => {
          await viewMoreNearAdvisor.click({ timeout: 5000, force: true }).catch(() => undefined);
        });
        enteredAdvisor = true;
      } else {
        // 方案 B：尝试点左侧菜单中的"经营参谋"（侧边栏展开时可用）
        const advisorMenu = page.locator('text=经营参谋').first();
        if (await advisorMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
          await advisorMenu.click({ timeout: 6000 }).catch(async () => {
            await advisorMenu.click({ timeout: 5000, force: true }).catch(() => undefined);
          });
          enteredAdvisor = true;
        }
      }

      if (!enteredAdvisor) {
        await this.dumpVisibleMenu(page);
        throw new Error('未找到"经营参谋"入口（卡片"查看更多"与左侧菜单均不可见）');
      }

      await page.waitForTimeout(5000);
      await this.closeFloatingPanels(page);
      await this.dismissOverlays(page);

      // 进入经营参谋页面后，找"报表中心"（可能是页面内的卡片/按钮，也可能是左侧子菜单）
      console.log('   点击"报表中心"...');
      const reportCandidates = [
        page.locator('text=报表中心').first(),
        page.locator('a:has-text("报表中心"), [role="button"]:has-text("报表中心")').first(),
      ];
      let reportClicked = false;
      for (const candidate of reportCandidates) {
        if (await candidate.isVisible({ timeout: 4000 }).catch(() => false)) {
          await this.dismissOverlays(page);
          await candidate.click({ timeout: 8000 }).catch(async () => {
            await candidate.click({ timeout: 5000, force: true }).catch(() => undefined);
          });
          reportClicked = true;
          break;
        }
      }
      if (!reportClicked) {
        await this.dumpVisibleMenu(page);
        throw new Error('进入经营参谋后未找到"报表中心"入口');
      }
      await page.waitForTimeout(6000);

      // 等待可能的新标签页
      let target = page;
      if (newPages.length > 0) {
        target = newPages[newPages.length - 1];
        try {
          await target.waitForLoadState('networkidle', { timeout: 20000 });
        } catch {
          try {
            await target.waitForLoadState('domcontentloaded', { timeout: 10000 });
          } catch {
            /* ignore */
          }
        }
        await target.waitForTimeout(3000);
        this.page = target;
        console.log(`   📑 检测到新标签页，切换到：${target.url()}`);
      } else {
        console.log(`   📍 当前页落地：${page.url()}`);
      }
      return target;
    } finally {
      this.context.off('page', onNewPage);
    }
  }

  /** 诊断：打印当前页主要可见文本块/菜单，便于定位真实入口结构 */
  private async dumpVisibleMenu(page: Page): Promise<void> {
    try {
      const url = page.url();
      console.log(`   🔍 诊断当前页 URL: ${url}`);
      const texts = await page
        .locator('a, button, [role="menuitem"], [class*="menu-item"], [class*="card"], span[class*="title"]')
        .allInnerTexts()
        .catch(() => []);
      const items = [...new Set(texts.map((t) => t.trim()).filter((t) => t && t.length < 24))];
      console.log('   🔍 可见可点击项:', items.slice(0, 50).join(' | '));
    } catch {
      /* ignore */
    }
  }

  private async waitForReportCenter(page: Page): Promise<void> {
    // 等待报表卡片出现（配置的报表卡片标题）
    try {
      await page.locator(`text=${this.config.reportCardName}`).waitFor({
        state: 'visible',
        timeout: 15000,
      });
      console.log('✅ 报表中心已加载');
    } catch {
      // 备用：等待"使用模板"按钮出现
      try {
        await page.locator('text=使用模板').waitFor({ state: 'visible', timeout: 10000 });
        console.log('✅ 报表模板已加载');
      } catch {
        const title = await page.title();
        console.log(`⚠️  页面标题：${title}`);

        fs.mkdirSync(this.config.outputDir, { recursive: true });
        const screenshotPath = path.join(
          this.config.outputDir,
          `debug-meituan-report-${Date.now()}.png`
        );
        await page.screenshot({ path: screenshotPath });
        console.log(`📸 截图已保存：${screenshotPath}`);

        throw new Error('报表中心页面加载超时（未找到报表卡片或"使用模板"按钮）');
      }
    }
  }

  private parseExcel(filePath: string): MeituanReportRow[] {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      throw new Error(`Excel 文件中未找到工作表：${sheetName}`);
    }
    const data = XLSX.utils.sheet_to_json<MeituanReportRow>(worksheet);
    return data;
  }

  /**
   * 保存当前登录态：
   *  1) 全量 Cookie 写常规文件（兼容旧逻辑）
   *  2) 仅美团/点评域 Cookie 强制设 30 天后过期，写会话存档
   *  3) 关闭前把带过期时间的 Cookie 回写浏览器，强制 Chrome 以持久 Cookie 落盘，
   *     防止服务端把关键登录态改成会话级后被 Chrome 关闭丢弃
   */
  private async saveCookies(): Promise<void> {
    if (!this.context) return;
    const cookies = await this.context.cookies();

    fs.mkdirSync(path.dirname(this.config.cookiePath), { recursive: true });
    fs.writeFileSync(this.config.cookiePath, JSON.stringify(cookies, null, 2), 'utf-8');

    const futureExpires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const persisted = cookies
      .filter((c) => isMeituanDomain(c.domain))
      .map((c) => this.toPersistedCookie(c, futureExpires));

    fs.mkdirSync(path.dirname(this.config.sessionCookiePath), { recursive: true });
    fs.writeFileSync(this.config.sessionCookiePath, JSON.stringify(persisted, null, 2), 'utf-8');

    try {
      await this.context.addCookies(persisted);
    } catch (err) {
      console.warn('⚠️  Cookie 回写浏览器失败（不影响本次数据，可能影响下次免登录）：', err);
    }

    const mtNames = cookies.filter((c) => isMeituanDomain(c.domain)).map((c) => c.name);
    console.log(
      `🍪 Cookie 已保存（${cookies.length} 个，其中美团/点评 ${mtNames.length} 个已设为持久化并回写浏览器）`
    );
  }

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
  } {
    return {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite === 'None' ? 'None' : c.sameSite === 'Strict' ? 'Strict' : 'Lax',
      expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : futureExpires,
    };
  }
}
