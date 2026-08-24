import { chromium, BrowserContext, Page, Frame, ElementHandle, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { parseMeituanWorkbook, type MeituanRow } from './meituan-parser';
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
  /**
   * 指定抓取某一天的数据（YYYY-MM-DD），用于历史回填，例如 '2026-08-21'。
   * 设置后在日期选择器中选单日范围（起止同一天），下载文件名/数据日期均取该日。
   * 不设置时按 daysToDownload 走快捷选项（昨天/近7天/近30天）。
   */
  targetDate?: string;
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

/** MTD 双月日历面板中单栏（左/右）的状态 */
interface MtdColState {
  side: 'left' | 'right';
  year: number;
  month: number;
  targetPresent: boolean;
  targetEnabled: boolean;
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

      // 报表中心的实际内容嵌在 iframe 里（URL 的 iUrl base64 解码指向 h5.dianping.com/.../report-center）。
      // 必须在 frame 内定位元素，page.locator 不会穿透 iframe。
      console.log('⏳ 等待报表中心 iframe 加载...');
      const frame = await this.waitForReportFrame(reportPage);
      console.log('✅ 已进入报表中心 iframe');

      // 再次确保引导气泡已关闭（首页可能未点中）
      await this.dismissGuideEverywhere(reportPage);
      // 关闭右上角"重点消息"等通知弹窗，避免遮挡/拦截后续点击
      await this.dismissNotifications(reportPage);

      console.log(' 点击"使用模板"...');
      // 该按钮偶发渲染较慢，轮询等待最多 30 秒，并在多 frame 内查找。
      let useTemplateFrame: Frame = frame;
      let clickedTemplate = false;
      const tDeadline = Date.now() + 30000;
      while (Date.now() < tDeadline) {
        const candidates: Frame[] = [frame, ...reportPage.frames().filter((f) => f !== frame)];
        for (const f of candidates) {
          const btn = f.locator('text=使用模板').first();
          if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            useTemplateFrame = f;
            await btn.scrollIntoViewIfNeeded().catch(() => undefined);
            await btn.click({ timeout: 3000 }).catch(() => undefined);
            clickedTemplate = true;
            break;
          }
        }
        if (clickedTemplate) break;
        await reportPage.waitForTimeout(800);
      }
      if (!clickedTemplate) {
        // 诊断：打印各 frame 可见按钮 + 截图，帮助定位实际界面
        console.log('   🔍 未找到"使用模板"，输出当前页可见元素：');
        for (const f of reportPage.frames()) {
          const info = await f
            .evaluate(() => {
              const nodes = document.querySelectorAll(
                'button, a, [role="button"], [class*="btn"], [class*="card"]'
              );
              const set: Record<string, boolean> = {};
              const btns: string[] = [];
              for (let i = 0; i < nodes.length; i++) {
                const el = nodes[i] as HTMLElement;
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                const t = (el.textContent || '').trim();
                if (!t || t.length >= 24) continue;
                if (!set[t]) {
                  set[t] = true;
                  btns.push(t);
                }
                if (btns.length >= 50) break;
              }
              return { url: location.href, btns };
            })
            .catch(() => null);
          if (info) console.log(`      [${info.url.slice(0, 80)}] => ${info.btns.join(' | ') || '(无)'}`);
        }
        const missShot = path.join(this.config.outputDir, `debug-no-template-${Date.now()}.png`);
        fs.mkdirSync(this.config.outputDir, { recursive: true });
        await reportPage.screenshot({ path: missShot, fullPage: false }).catch(() => undefined);
        console.log(`   📸 截图：${missShot}`);
        throw new Error('未找到"使用模板"按钮（已等待 30 秒，见上方可见元素与截图）');
      }
      await useTemplateFrame.waitForTimeout(3000);

      console.log('⏳ 等待下载对话框...');
      // 历史成功版确认：点开"使用模板"后弹出的下载对话框标题是"久久金美团经营数据下载"（带"下载"后缀）
      const dialogCandidates = [
        useTemplateFrame.locator('text=久久金美团经营数据下载').first(),
        useTemplateFrame.locator(`text=${this.config.reportCardName}`).first(),
      ];
      for (const d of dialogCandidates) {
        if (await d.isVisible({ timeout: 4000 }).catch(() => false)) {
          await d.waitFor({ state: 'visible', timeout: 6000 }).catch(() => undefined);
          break;
        }
      }
      await useTemplateFrame.waitForTimeout(2000);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - this.config.daysToDownload);
      const dateStr = this.config.targetDate || yesterday.toISOString().split('T')[0];
      console.log(` 设置日期范围：${dateStr}`);

      // 历史已跑通方案（commit 8496468）：日期选择器打开后点【快捷选项"昨天"】，
      // 而不是在日历里点日期格子（点格子无法正确设置范围，导致下载不触发）。
      const dateInput = frame.locator('input[placeholder="请选择时间范围"]').first();
      if (!(await dateInput.isVisible({ timeout: 8000 }).catch(() => false))) {
        // 兜底：用文本定位
        const dateInputAlt = frame.locator('text=请选择时间范围').first();
        if (await dateInputAlt.isVisible({ timeout: 3000 }).catch(() => false)) {
          await dateInputAlt.click();
        } else {
          throw new Error('未找到"请选择时间范围"输入框');
        }
      } else {
        await dateInput.click();
      }
      await frame.waitForTimeout(2000);

      if (this.config.targetDate) {
        // 指定日期回填。美团报表中心使用自研 MTD 日期控件（mtd-date-picker），
        // 其"请选择时间范围"输入框【不接受自由键入】：逐字符敲入后 DOM 值正确，
        // 但一按回车/失焦就被 React 受控状态清空。唯一可靠方式是：点开输入框弹出
        // 浮动日历面板，在面板里点选日期格子。
        // 关键教训：之前用宽泛选择器（td、[class*=cell]）把下方"报表预览"表格的
        // 单元格误判成日历格子（cells=84），日历从没被真正操作。新版用"浮动定位 +
        // 内含 28+ 个日期数字"的几何特征精确定位日历弹层，彻底排除报表表格。
        const td = this.config.targetDate;
        console.log(`   指定日期回填：${td} ~ ${td}`);
        const clicked = await this.pickCalendarDate(frame, td);
        if (!clicked) {
          throw new Error(`无法在日历中选择指定日期 ${td}（详见上方诊断与导出的 HTML）`);
        }
        const finalVal = await this.readDateRangeValue(reportPage);
        console.log(`✅ 已选择日期范围：${finalVal || '(输入框值为空)'}`);
      } else {
        const days = this.config.daysToDownload || 1;
        let quickOption = '昨天';
        if (days === 7) quickOption = '近7天';
        else if (days === 30) quickOption = '近30天';
        console.log(`   选择快捷选项：${quickOption}`);

        const optionBtn = frame.locator(`text=${quickOption}`).first();
        await optionBtn.waitFor({ state: 'visible', timeout: 5000 });
        await optionBtn.click();
        await frame.waitForTimeout(2000);
        console.log(`✅ 已选择时间范围：${quickOption}`);
      }

      // 选定日期（尤其是改了日期）后，报表预览会重新加载，"下载"按钮要等
      // 预览加载完成才出现。轮询等待"正在加载中/加载中"消失，且下载按钮出现。
      console.log('⏳ 等待报表预览加载完成...');
      const dlDeadline = Date.now() + 60000;
      let readyToDownload = false;
      while (Date.now() < dlDeadline) {
        const st = await frame
          .evaluate(() => {
            let bodyText = '';
            if (document.body) bodyText = document.body.innerText || '';
            let hasDownload = false;
            const nodes = document.querySelectorAll('button, [role="button"], a, [class*="btn"]');
            for (let i = 0; i < nodes.length; i++) {
              const el = nodes[i] as HTMLElement;
              const t = (el.textContent || '').trim();
              if (t === '下载' || t === '导 出' || t === '导出') {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  hasDownload = true;
                  break;
                }
              }
            }
            const loading = bodyText.indexOf('正在加载') >= 0 || bodyText.indexOf('加载中') >= 0;
            return { loading, hasDownload, snippet: bodyText.slice(0, 120) };
          })
          .catch(() => ({ loading: false, hasDownload: false, snippet: '' }));
        if (!st.loading && st.hasDownload) {
          readyToDownload = true;
          console.log('   ✅ 报表预览已加载完成，下载按钮已出现');
          break;
        }
        if (Date.now() % 5000 < 600) {
          console.log(
            `   ...等待中 loading=${st.loading} hasDownload=${st.hasDownload} "${st.snippet.replace(/\s+/g, ' ')}"`
          );
        }
        await frame.waitForTimeout(700);
      }
      if (!readyToDownload) {
        console.log('   ⚠️ 60 秒内未确认加载完成，仍尝试查找下载按钮');
      }

      // 点下载前：截图 + 诊断对话框内可见按钮和文本，确认点的是正确的下载按钮
      fs.mkdirSync(this.config.outputDir, { recursive: true });
      const beforeDlShot = path.join(this.config.outputDir, `debug-before-download-${Date.now()}.png`);
      await reportPage.screenshot({ path: beforeDlShot }).catch(() => undefined);
      console.log(`📸 点下载前截图：${beforeDlShot}`);
      const dialogInfo = await frame
        .evaluate(() => {
          // evaluate 内禁止定义函数/箭头（tsx __name 坑），用纯 for 循环
          const buttons: string[] = [];
          const nodes = document.querySelectorAll('button, [role="button"], a');
          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i] as HTMLElement;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') continue;
            const t = (el.textContent || '').trim();
            if (t && t.length < 20) buttons.push(t);
          }
          const bodyText = (document.body.innerText || '').slice(0, 500);
          const unique: string[] = [];
          for (let i = 0; i < buttons.length; i++) {
            if (unique.indexOf(buttons[i]) < 0) unique.push(buttons[i]);
          }
          return { buttons: unique, bodyText };
        })
        .catch(() => ({ buttons: [] as string[], bodyText: '' }));
      console.log('   🔍 对话框内按钮:', dialogInfo.buttons.join(' | '));
      console.log('   🔍 对话框文本片段:', dialogInfo.bodyText.replace(/\s+/g, ' ').slice(0, 200));

      console.log('⬇️  点击下载...');
      // 优先在当前 frame 找文本精确为"下载"的按钮；找不到再跨所有 frame 找（弹层可能 portal）。
      const dlCandidates: Frame[] = [frame, ...this.collectAllFrames(reportPage).filter((f) => f !== frame)];
      let downloadBtn: Locator | null = null;
      let dlFrame: Frame = frame;
      for (const f of dlCandidates) {
        const btn = f
          .locator('button:has-text("下载"), [role="button"]:has-text("下载"), a:has-text("下载")')
          .last();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          downloadBtn = btn;
          dlFrame = f;
          break;
        }
      }
      if (!downloadBtn) {
        // 兜底：精确文本匹配（evaluate 纯循环）
        for (const f of dlCandidates) {
          const handle = await this.findClickableText(f as unknown as Page, '下载', [
            'button',
            '[role="button"]',
            'a',
          ]);
          if (handle) {
            await handle.dispose();
            downloadBtn = f.locator('text=下载').last();
            dlFrame = f;
            break;
          }
        }
      }
      if (!downloadBtn) {
        const failShot = path.join(this.config.outputDir, `debug-no-download-${Date.now()}.png`);
        await reportPage.screenshot({ path: failShot }).catch(() => undefined);
        throw new Error(`未找到"下载"按钮（已等待报表加载并跨 frame 查找，截图：${failShot}）`);
      }

      // 关键：跨域 iframe 内触发的下载事件在 context 级别监听最稳，同时也在 page 级别等。
      // 部分场景会先弹"导出确认/确定"二次弹窗，这里并行监听新弹窗。
      const downloadCtx = this.context!.waitForEvent('download', { timeout: 60000 }).catch(() => null);
      const downloadPageP = reportPage.waitForEvent('download', { timeout: 60000 }).catch(() => null);
      await downloadBtn.click();
      await dlFrame.waitForTimeout(1500);

      // 若出现二次确认弹窗（"确定/确认/导出/继续下载"），点掉它
      const confirmSelectors = [
        'button:has-text("确定")',
        'button:has-text("确认")',
        'button:has-text("导出")',
        'button:has-text("继续下载")',
      ];
      for (const sel of confirmSelectors) {
        const btn = frame.locator(sel).last();
        if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
          console.log(`   🔘 发现二次确认按钮：${sel}，点击`);
          await btn.click().catch(() => undefined);
          await frame.waitForTimeout(800);
        }
      }

      const [downloadFromCtx, downloadFromPage] = await Promise.all([downloadCtx, downloadPageP]);
      const download = downloadFromCtx || downloadFromPage;
      if (!download) {
        const failShot = path.join(this.config.outputDir, `debug-download-fail-${Date.now()}.png`);
        await reportPage.screenshot({ path: failShot }).catch(() => undefined);
        console.log(`📸 下载失败截图：${failShot}`);
        throw new Error('点击下载后 60 秒内未触发浏览器下载（可能是日期未选全、按钮不对或需要二次确认）');
      }

      const fileName = `meituan_report_${dateStr}.xlsx`;
      downloadFilePath = path.join(this.config.outputDir, fileName);
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
      // 失败时【仅当仍处于商家后台登录态】才刷新 Cookie 存档，
      // 避免被重定向到登录页后把失效 Cookie 存盘、污染下次免登录。
      await this.saveCookiesIfLoggedIn().catch(() => undefined);
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
    // 只需处理右下角的新功能引导气泡（1/3，含"跳过/下一步"）。
    // 用户确认：右侧"重点消息"面板无需关闭也能正常操作；之前手工只点了"跳过"。
    // 因此这里只做一件事：精确点掉"跳过"，再清掉 body 上的 driver-* class。
    await page.waitForTimeout(800);

    // 1) 精确点"跳过"：遍历可见元素，找文本精确等于"跳过"的叶子节点，点它本身或可点击父级。
    //    多步引导点一次"跳过"即整体结束，不需要逐页点"下一步"。
    const skipped = await page
      .evaluate(() => {
        const visible = (el: Element): boolean => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
        // 先找文本精确为"跳过"的小叶子节点
        const leaf = all.find((el) => {
          if (!visible(el)) return false;
          if (el.children.length > 1) return false;
          return (el.textContent || '').trim() === '跳过';
        });
        if (leaf) {
          // 优先点它最近的可点击祖先（button/a/[role=button]），否则点自身
          const clickable = leaf.closest('button,a,[role="button"],[class*="btn"]') || leaf;
          (clickable as HTMLElement).click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (skipped) {
      console.log('   ⏭️  已点掉引导气泡"跳过"');
    }
    await page.waitForTimeout(800);

    // 2) 从 DOM 根上清除 driver.js 残留（body/html 的 driver-* class 是指针拦截根源）
    const removed = await page
      .evaluate(() => {
        let count = 0;
        const kill = (): number => {
          let n = 0;
          for (const el of [document.body, document.documentElement]) {
            if (!el) continue;
            for (const cls of Array.from(el.classList)) {
              if (cls && cls.toLowerCase().startsWith('driver')) {
                el.classList.remove(cls);
                n++;
              }
            }
          }
          document
            .querySelectorAll(
              '.driver-overlay, [class*="driver-overlay"], .driver-popover, [class*="driver-popover"], .driver-highlighted-element, [class*="driver-highlight"], .driver-stage'
            )
            .forEach((el) => {
              el.remove();
              n++;
            });
          document.body.style.removeProperty('overflow');
          document.body.style.removeProperty('pointer-events');
          document.body.style.removeProperty('position');
          document.documentElement.style.removeProperty('overflow');
          return n;
        };
        count += kill();
        try {
          const observer = new MutationObserver(() => kill());
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          setTimeout(() => observer.disconnect(), 2500);
        } catch {
          /* ignore */
        }
        return count;
      })
      .catch(() => 0);

    if (removed > 0) {
      console.log(`   🧹 已清理引导遮罩（${removed} 处）`);
    }
    await page.waitForTimeout(400);
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
      // 用 domcontentloaded + 固定等待，不用 networkidle：
      // 美团首页有长连接/轮询，networkidle 可能永远等不到而超时（历史 8496468 跑通版即是此做法）。
      await page.goto('https://e.dianping.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(8000);

      // 1) 关闭首页所有遮挡：重点消息面板、新功能引导气泡、顶部命令行提示条、driver.js 遮罩
      await this.dismissOverlays(page);

      // 2) 进入"经营参谋"。截图显示首页中部有"经营参谋"数据卡片（橙色图标），
      //    其右侧有"查看更多"链接——这是历史上成功进入经营参谋页的入口。
      //    左侧菜单此时可能是折叠态，作为兜底。
      console.log(' 进入"经营参谋"卡片...');
      let navigated = await this.enterAdvisorCard(page);
      if (!navigated) {
        // 兜底：展开并点击左侧菜单"经营参谋"
        await this.expandSidebar(page);
        const advisorHandle = await this.findMenuTitle(page, '经营参谋');
        if (advisorHandle) {
          await advisorHandle.evaluate((el: Element) => {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            (el as HTMLElement).click();
          });
          await advisorHandle.dispose();
          navigated = true;
        }
      }
      if (!navigated) {
        await this.dumpVisibleMenu(page);
        throw new Error('未找到"经营参谋"入口（首页卡片"查看更多"与左侧菜单均未命中）');
      }
      await page.waitForTimeout(4000);

      // 3) 进入后再次清理遮罩/弹窗（经营参谋页也可能弹引导或反馈框）
      await this.dismissOverlays(page);
      await this.dismissFeedbackDialog(page);

      // 4) 找"报表中心"
      console.log('   点击"报表中心"...');
      const reportHandle = await this.findClickableText(page, '报表中心', [
        'a',
        '[role="menuitem"]',
        'span.title',
        'button',
        'div',
        'li',
      ]);
      if (!reportHandle) {
        await this.dumpVisibleMenu(page);
        throw new Error('进入经营参谋后未找到"报表中心"入口（可能是子菜单名称或页面结构变化）');
      }
      await this.dismissOverlays(page);
      await reportHandle.evaluate((el: Element) => {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        (el as HTMLElement).click();
      });
      await reportHandle.dispose();
      await page.waitForTimeout(6000);

      // 5) 等待可能的新标签页
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

  /**
   * 反复关闭遮挡页面的弹窗：
   * - 反馈/举报/地区选择类对话框（点"取消"）
   * - 右上角 X 关闭按钮
   * - driver.js 引导遮罩
   * 最多重试 5 轮，直到检测不到弹窗特征。
   */
  private async dismissBlockingDialogs(page: Page): Promise<void> {
    for (let round = 0; round < 5; round++) {
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(200);

      let acted = false;

      // 精确点击对话框中的"取消/关闭"按钮（反馈/举报/地区选择弹窗）
      const cancel = page
        .locator(
          'button:has-text("取消"), a:has-text("取消"), [role="button"]:has-text("取消")'
        )
        .first();
      if (await cancel.isVisible({ timeout: 400 }).catch(() => false)) {
        await cancel.click({ timeout: 1500 }).catch(() => undefined);
        acted = true;
        await page.waitForTimeout(500);
      }

      // 关闭右上角 X（限定在弹窗/抽屉/消息面板容器内，避免误点业务按钮）
      const closeX = page
        .locator(
          '[role="dialog"] [class*="close"], .ant-modal-close, [class*="dialog"] [class*="close"], [class*="drawer"] [class*="close"], [class*="message"] [class*="close"]'
        )
        .first();
      if (await closeX.isVisible({ timeout: 300 }).catch(() => false)) {
        await closeX.click({ timeout: 1200 }).catch(() => undefined);
        acted = true;
        await page.waitForTimeout(500);
      }

      // 清 driver.js 引导遮罩
      await this.dismissOverlays(page);

      if (!acted) break;
    }
  }

  /**
   * 关闭"提交反馈/举报 + 地区选择"对话框（若存在）。
   * 该弹窗特征：含"提交反馈"或"点击此处发起举报/申诉" + 一串省市名 + "确定/取消"。
   */
  private async dismissFeedbackDialog(page: Page): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const has = await page
        .evaluate(() => {
          const body = document.body.innerText || '';
          return (
            body.includes('提交反馈') &&
            (body.includes('点击此处发起举报') || body.includes('全选'))
          );
        })
        .catch(() => false);
      if (!has) break;
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(200);
      const cancel = page
        .locator('button:has-text("取消"), a:has-text("取消"), [role="button"]:has-text("取消")')
        .first();
      if (await cancel.isVisible({ timeout: 500 }).catch(() => false)) {
        await cancel.click({ timeout: 1500 }).catch(() => undefined);
        await page.waitForTimeout(500);
      } else {
        break;
      }
    }
  }

  /**
   * 点击首页"经营参谋"数据卡片右侧的"查看更多"进入经营参谋页。
   * 截图中：卡片标题为"经营参谋"（橙色图标），其右上方有蓝色"查看更多"链接。
   * 注意：只在"经营参谋"卡片附近找"查看更多"，避免误点其它卡片（如评价管理）的同名链接，
   * 更要避免误点到反馈/举报入口。
   */
  private async enterAdvisorCard(page: Page): Promise<boolean> {
    const clicked = await page
      .evaluate(() => {
        const visible = (el: Element): boolean => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        // 找到文本为"经营参谋"的标题元素
        const titles = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
          (el) =>
            el.children.length <= 2 &&
            (el.textContent || '').trim() === '经营参谋' &&
            visible(el)
        );
        for (const title of titles) {
          // 向上找卡片容器
          let card: HTMLElement | null = title;
          for (let i = 0; i < 6 && card; i++) {
            const r = card.getBoundingClientRect();
            if (r.width > 400 && r.height > 120) break;
            card = card.parentElement;
          }
          const root = card || document;
          // 在卡片内找文本精确为"查看更多"的链接/可点击元素
          const more = Array.from(
            root.querySelectorAll<HTMLElement>('a, button, [role="button"], span, div')
          ).find((el) => {
            if (!visible(el)) return false;
            const t = (el.textContent || '').trim();
            return t === '查看更多' && el.querySelectorAll('*').length <= 2;
          });
          if (more) {
            more.click();
            return true;
          }
        }
        return false;
      })
      .catch(() => false);
    if (clicked) {
      console.log('   ✅ 已点击"经营参谋"卡片的"查看更多"');
      await page.waitForTimeout(500);
      // 点击后若误弹出反馈框则关掉
      await this.dismissFeedbackDialog(page);
    }
    return clicked;
  }

  /** 展开左侧折叠的菜单栏（截图中左侧只显示一排 ▼）。 */
  private async expandSidebar(page: Page): Promise<void> {
    await page
      .evaluate(() => {
        const visible = (el: Element): boolean => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        // 点击左侧导航的折叠展开触发器
        const triggers = Array.from(
          document.querySelectorAll<HTMLElement>('[class*="collapse"], [class*="expand"], [class*="toggle"], [class*="arrow"]')
        ).filter((el) => visible(el) && el.getBoundingClientRect().left < 60);
        for (const t of triggers.slice(0, 10)) {
          t.click();
        }
      })
      .catch(() => undefined);
    await page.waitForTimeout(500);
  }

  /**
   * 在页面中遍历指定标签，精确匹配文本内容，返回第一个可见且（尽量）可点击的元素句柄。
   * 用 evaluate 做精确匹配，避免 Playwright text 选择器把子串/隐藏元素也算进去。
   */
  private async findMenuTitle(
    page: Page,
    text: string
  ): Promise<ElementHandle<Element> | null> {
    const handle = await page.evaluateHandle(
      ({ target }) => {
        const candidates = Array.from(document.querySelectorAll('span.title, .menu-item span, [class*="menu"] span'));
        const match = candidates.find((el) => {
          const t = (el.textContent || '').trim();
          if (t !== target) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });
        return match || null;
      },
      { target: text }
    );
    const el = handle.asElement();
    if (!el) {
      await handle.dispose();
      return null;
    }
    return el;
  }

  /**
   * 在报表下载对话框的浮动日历弹层里点选指定日期（单日范围点同一格两次）。
   *
   * 美团 MTD 日期控件实测结构（已从真实面板 dump 确认）：
   *   弹层:        div.mtd-popper (position:absolute, 约 672x289, 双月)
   *   左右两栏:    .mtd-picker-panel-content-left / -right
   *   日期格:      span.mtd-date-picker-cells-cell（内部 em 显示日号）
   *                禁用/补位格带 -disabled 或 上月/下月相关类
   *   翻月箭头:    .mtd-picker-header-prev-btn / -next-btn
   *   输入框:      input[placeholder="请选择时间范围"]，值 "YYYY-MM-DD - YYYY-MM-DD"
   *
   * 输入框不接受自由键入（回车即被 React 清空），必须点格子。
   */
  private async pickCalendarDate(frame: Frame, dateStr: string): Promise<boolean> {
    const target = new Date(dateStr + 'T00:00:00');
    if (Number.isNaN(target.getTime())) return false;
    const ty = target.getFullYear();
    const tm = target.getMonth() + 1;
    const td = target.getDate();
    const monthLabel = `${ty}年${tm}月`;
    const page = frame.page();
    const allFrames = this.collectAllFrames(page);

    // ---- 1) 打开日历面板（点输入框）----
    let opened = false;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      for (const f of allFrames) {
        await f
          .evaluate(() => {
            const inputs = document.querySelectorAll('input');
            for (let i = 0; i < inputs.length; i++) {
              const el = inputs[i] as HTMLInputElement;
              const ph = (el.getAttribute('placeholder') || '').trim();
              if (ph === '请选择时间范围' || ph.indexOf('时间范围') >= 0) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  el.focus();
                  el.click();
                  return true;
                }
              }
            }
            return false;
          })
          .catch(() => false);
      }
      for (let w = 0; w < 15 && !opened; w++) {
        await page.waitForTimeout(300);
        for (const f of allFrames) {
          const ok = await f
            .evaluate(() => {
              // 页面上有多个 .mtd-popper（含尺寸 0 的 tooltip 气泡），
              // 必须遍历选"可见 + 含 28+ 日期格"的那个日历面板。
              const pops = document.querySelectorAll('.mtd-popper');
              for (let i = 0; i < pops.length; i++) {
                const p = pops[i] as HTMLElement;
                const r = p.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;
                const cells = p.querySelectorAll('.mtd-date-picker-cells-cell');
                if (cells.length >= 28) return true;
              }
              return false;
            })
            .catch(() => false);
          if (ok) {
            opened = true;
            break;
          }
        }
      }
    }
    if (!opened) {
      console.log('   ❌ 点击日期输入框后未检测到 .mtd-popper 日历面板');
      await this.dumpCalendarPanel(frame, dateStr);
      return false;
    }
    console.log('   🗓️  MTD 日历面板已打开');

    // ---- 2) 读左右两栏年月 + 在目标栏点日 ----
    for (let round = 0; round < 12; round++) {
      const state = await this.readMtdPanel(frame, td);
      if (!state) {
        console.log(`   ⚠️ [round=${round}] 读取面板失败，重试`);
        await page.waitForTimeout(400);
        continue;
      }
      const colDesc = (c: MtdColState | null): string =>
        c
          ? `${c.year}年${c.month}月(${c.targetEnabled ? '目标日可选' : c.targetPresent ? '目标日禁用' : '无目标日'})`
          : '(空)';
      console.log(`   📅 [round=${round}] 两栏：[${colDesc(state.cols[0])} | ${colDesc(state.cols[1])}]`);

      // 在目标年月且目标日可选的栏里点日
      let clicked = false;
      for (const c of state.cols) {
        if (c && c.year === ty && c.month === tm && c.targetEnabled) {
          clicked = await this.clickMtdDay(frame, c.side, td);
          break;
        }
      }
      if (clicked) {
        await page.waitForTimeout(400);
        // 单日范围：范围选择器需要起止两次，再点一次目标日
        const st2 = await this.readMtdPanel(frame, td);
        if (st2) {
          for (const c of st2.cols) {
            if (c && c.year === ty && c.month === tm && c.targetEnabled) {
              await this.clickMtdDay(frame, c.side, td);
              break;
            }
          }
        }
        await page.waitForTimeout(500);
        if (await this.verifySelected(page, dateStr)) {
          console.log(`   ✓ 日历已选中 ${dateStr}（输入框校验通过）`);
          return true;
        }
        console.log('   ⚠️ 已点击目标日但输入框未含目标日期，继续');
      }

      // 目标月在面板里但目标日不可选/不存在 -> 无法通过翻页解决
      let targetVisible = false;
      let targetDisabled = false;
      for (const c of state.cols) {
        if (c && c.year === ty && c.month === tm) {
          targetVisible = true;
          if (c.targetPresent && !c.targetEnabled) targetDisabled = true;
        }
      }
      if (targetVisible) {
        console.log(
          `   ❌ ${monthLabel} 在面板中但 ${td} 日${targetDisabled ? '为禁用状态' : '不存在'}，无法选择`
        );
        await this.dumpCalendarPanel(frame, dateStr);
        return false;
      }

      // ---- 翻月：取较早一栏年月判断方向 ----
      let earliest: { year: number; month: number } | null = null;
      for (const c of state.cols) {
        if (!c) continue;
        if (!earliest || c.year < earliest.year || (c.year === earliest.year && c.month < earliest.month)) {
          earliest = { year: c.year, month: c.month };
        }
      }
      if (!earliest) {
        console.log('   ❌ 无法识别面板年月，停止盲目翻页');
        await this.dumpCalendarPanel(frame, dateStr);
        return false;
      }
      const goBack = earliest.year > ty || (earliest.year === ty && earliest.month > tm);
      const moved = await this.navMtdMonth(frame, goBack);
      if (!moved) {
        console.log(`   ❌ 找不到${goBack ? '上一月' : '下一月'}箭头`);
        await this.dumpCalendarPanel(frame, dateStr);
        return false;
      }
      console.log(`   ➡️ 翻到${goBack ? '上一月' : '下一月'}`);
      await page.waitForTimeout(450);
    }

    console.log('   ❌ 翻月超过上限仍未选中目标日期');
    await this.dumpCalendarPanel(frame, dateStr);
    return false;
  }

  /** 跨 frame 校验日期输入框值是否包含目标日期 */
  private async verifySelected(page: Page, dateStr: string): Promise<boolean> {
    for (const f of this.collectAllFrames(page)) {
      const ok = await f
        .evaluate((target) => {
          const inputs = document.querySelectorAll('input');
          for (let i = 0; i < inputs.length; i++) {
            const el = inputs[i] as HTMLInputElement;
            if ((el.value || '').indexOf(target) >= 0) return true;
          }
          return false;
        }, dateStr)
        .catch(() => false);
      if (ok) return true;
    }
    return false;
  }

  /**
   * 读取 MTD 双月面板左右两栏的年月与目标日状态。
   * header 里"YYYY"和"M月"可能分在不同 span，故在栏容器内取 innerText 后用正则抽取。
   */
  private async readMtdPanel(
    frame: Frame,
    targetDay: number
  ): Promise<{ cols: (MtdColState | null)[] } | null> {
    for (const f of this.collectAllFrames(frame.page())) {
      const res = await f
        .evaluate(
          (td) => {
            // 多个 .mtd-popper（含 0 尺寸 tooltip），选可见且含日期格的日历面板
            let popper: HTMLElement | null = null;
            const pops = document.querySelectorAll('.mtd-popper');
            for (let pi = 0; pi < pops.length; pi++) {
              const pp = pops[pi] as HTMLElement;
              const rr = pp.getBoundingClientRect();
              if (rr.width <= 0 || rr.height <= 0) continue;
              if (pp.querySelectorAll('.mtd-date-picker-cells-cell').length >= 28) {
                popper = pp;
                break;
              }
            }
            if (!popper) return null;
            // 注意：本回调内禁止定义任何函数/箭头（tsx/esbuild 注入 __name 会导致
            // ReferenceError 被 catch 吞掉），左右两栏用纯 for 循环内联解析。
            const cols: ({ side: 'left' | 'right'; year: number; month: number; targetPresent: boolean; targetEnabled: boolean } | null)[] = [];
            const sides: ('left' | 'right')[] = ['left', 'right'];
            for (let si = 0; si < sides.length; si++) {
              const side = sides[si];
              const content = popper.querySelector('.mtd-picker-panel-content-' + side) as HTMLElement | null;
              if (!content) {
                cols.push(null);
                continue;
              }
              const txt = (content.innerText || content.textContent || '').replace(/\s+/g, ' ');
              // 年月：表头形如 "2026年 8月"。年份取 20xx，月份取"数字月"，
              // 用 /(\d{1,2})\s*月/ 可正确匹配到 8月（不会被日期数字干扰）。
              const yMatch = txt.match(/(20\d{2})\s*年/);
              const mMatch = txt.match(/(\d{1,2})\s*月/);
              if (!yMatch || !mMatch) {
                cols.push(null);
                continue;
              }
              const year = parseInt(yMatch[1], 10);
              const month = parseInt(mMatch[1], 10);
              if (month < 1 || month > 12) {
                cols.push(null);
                continue;
              }

              let targetPresent = false;
              let targetEnabled = false;
              const cells = content.querySelectorAll('.mtd-date-picker-cells-cell');
              for (let i = 0; i < cells.length; i++) {
                const cell = cells[i] as HTMLElement;
                const em = cell.querySelector('em');
                const numText = ((em ? em.textContent : cell.textContent) || '').trim();
                if (!/^\d{1,2}$/.test(numText)) continue;
                if (parseInt(numText, 10) !== td) continue;
                targetPresent = true;
                const cls = cell.className || '';
                if (/(disabled|prev|next|other|last-month|gray)/i.test(cls)) continue;
                const r = cell.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;
                targetEnabled = true;
              }
              cols.push({ side, year, month, targetPresent, targetEnabled });
            }
            return { cols };
          },
          targetDay
        )
        .catch(() => null);
      if (res) return res as { cols: (MtdColState | null)[] };
    }
    return null;
  }

  /** 点击指定栏（left/right）里的目标日格 */
  private async clickMtdDay(frame: Frame, side: 'left' | 'right', targetDay: number): Promise<boolean> {
    for (const f of this.collectAllFrames(frame.page())) {
      const clicked = await f
        .evaluate(
          (args) => {
            let popper: HTMLElement | null = null;
            const pops0 = document.querySelectorAll('.mtd-popper');
            for (let pi = 0; pi < pops0.length; pi++) {
              const pp = pops0[pi] as HTMLElement;
              const rr = pp.getBoundingClientRect();
              if (rr.width <= 0 || rr.height <= 0) continue;
              if (pp.querySelectorAll('.mtd-date-picker-cells-cell').length >= 28) {
                popper = pp;
                break;
              }
            }
            if (!popper) return false;
            const content = popper.querySelector('.mtd-picker-panel-content-' + args.side) as HTMLElement | null;
            if (!content) return false;
            const cells = content.querySelectorAll('.mtd-date-picker-cells-cell');
            for (let i = 0; i < cells.length; i++) {
              const cell = cells[i] as HTMLElement;
              const em = cell.querySelector('em');
              const numText = ((em ? em.textContent : cell.textContent) || '').trim();
              if (!/^\d{1,2}$/.test(numText)) continue;
              if (parseInt(numText, 10) !== args.td) continue;
              const cls = cell.className || '';
              if (/(disabled|prev|next|other|last-month|gray)/i.test(cls)) continue;
              const r = cell.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0) continue;
              cell.scrollIntoView({ block: 'center', inline: 'center' });
              if (em) (em as HTMLElement).click();
              cell.click();
              return true;
            }
            return false;
          },
          { side, td: targetDay }
        )
        .catch(() => false);
      if (clicked) return true;
    }
    return false;
  }

  /** 点击 MTD 面板的上一月/下一月箭头 */
  private async navMtdMonth(frame: Frame, goBack: boolean): Promise<boolean> {
    for (const f of this.collectAllFrames(frame.page())) {
      const ok = await f
        .evaluate((back) => {
          let popper: HTMLElement | null = null;
          const pops1 = document.querySelectorAll('.mtd-popper');
          for (let pi = 0; pi < pops1.length; pi++) {
            const pp = pops1[pi] as HTMLElement;
            const rr = pp.getBoundingClientRect();
            if (rr.width <= 0 || rr.height <= 0) continue;
            if (pp.querySelectorAll('.mtd-date-picker-cells-cell').length >= 28) {
              popper = pp;
              break;
            }
          }
          if (!popper) return false;
          // MTD 有单月箭头(-prev-btn/-next-btn)和跨年双箭头(-double-*-btn)，单月翻页排除双箭头
          const sel = back
            ? '.mtd-picker-header-prev-btn:not(.mtd-picker-header-double-prev-btn)'
            : '.mtd-picker-header-next-btn:not(.mtd-picker-header-double-next-btn)';
          let btn = popper.querySelector(sel) as HTMLElement | null;
          if (!btn) {
            const btns = popper.querySelectorAll('button, [role="button"], span, i');
            for (let i = 0; i < btns.length; i++) {
              const b = btns[i] as HTMLElement;
              const r = b.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0 || r.width > 80) continue;
              const aria = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
              const cls = b.className || '';
              const hay = aria + ' ' + cls;
              if (back && /(prev|上一|上个月|previous)/i.test(hay)) {
                btn = b;
                break;
              }
              if (!back && /(next|下一|下个月)/i.test(hay)) {
                btn = b;
                break;
              }
            }
          }
          if (!btn) return false;
          const r = btn.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          btn.click();
          return true;
        }, goBack)
        .catch(() => false);
      if (ok) return true;
    }
    return false;
  }

  /**
   * 失败诊断：把 MTD 日历面板的完整 outerHTML、左右两栏年月、目标日候选导出并截图。
   */
  private async dumpCalendarPanel(frame: Frame, dateStr: string): Promise<void> {
    try {
      const td = parseInt(dateStr.slice(8, 10), 10);
      let html = '';
      let summary = '';
      for (const f of this.collectAllFrames(frame.page())) {
        const res = await f
          .evaluate((targetDay) => {
          // 多个 .mtd-popper（含 0 尺寸 tooltip），优先选可见且含日期格的日历面板
          let popper: HTMLElement | null = null;
          const allPop = document.querySelectorAll('.mtd-popper');
          for (let pi = 0; pi < allPop.length; pi++) {
            const pp = allPop[pi] as HTMLElement;
            const rr = pp.getBoundingClientRect();
            if (rr.width <= 0 || rr.height <= 0) continue;
            if (pp.querySelectorAll('.mtd-date-picker-cells-cell').length >= 28) {
              popper = pp;
              break;
            }
          }
          if (!popper) {
            // 兜底：取任一可见 popper（可能是 tooltip），便于诊断
            for (let pi = 0; pi < allPop.length; pi++) {
              const pp = allPop[pi] as HTMLElement;
              const rr = pp.getBoundingClientRect();
              if (rr.width > 0 && rr.height > 0) {
                popper = pp;
                break;
              }
            }
          }
          if (!popper) return { html: '', summary: `frame=${location.href} 无可见 .mtd-popper` };
          const infos: string[] = [];
            const sides: ('left' | 'right')[] = ['left', 'right'];
            for (let si = 0; si < sides.length; si++) {
              const side = sides[si];
              const content = popper.querySelector('.mtd-picker-panel-content-' + side) as HTMLElement | null;
              if (!content) continue;
              const txt = (content.innerText || '').replace(/\s+/g, ' ').slice(0, 40);
              const cells = content.querySelectorAll('.mtd-date-picker-cells-cell');
              for (let i = 0; i < cells.length; i++) {
                const cell = cells[i] as HTMLElement;
                const em = cell.querySelector('em');
                const numText = ((em ? em.textContent : cell.textContent) || '').trim();
                if (numText !== String(targetDay)) continue;
                const r = cell.getBoundingClientRect();
                infos.push(
                  `[${side}] "${txt}" day=${targetDay} rect=(${Math.round(r.left)},${Math.round(r.top)}) class="${cell.className}"`
                );
              }
            }
            return {
              html: popper.outerHTML,
              summary:
                `frame=${location.href}\nmtd-popper class="${popper.className}" 尺寸=${Math.round(
                  popper.getBoundingClientRect().width
                )}x${Math.round(popper.getBoundingClientRect().height)}\n目标日候选:\n` + (infos.join('\n') || '(无)'),
            };
          }, td)
          .catch(() => null);
        if (res && res.html) {
          html = res.html;
          summary = res.summary;
          break;
        }
        if (res && res.summary) summary += res.summary + '\n';
      }

      fs.mkdirSync(this.config.outputDir, { recursive: true });
      const htmlPath = path.join(this.config.outputDir, `calendar-panel-${Date.now()}.html`);
      if (html) {
        fs.writeFileSync(htmlPath, html, 'utf-8');
        console.log(`   🔍 日历面板 HTML：${htmlPath}`);
      } else {
        console.log('   🔍 未找到 .mtd-popper 面板（可能已关闭）');
      }
      if (summary) {
        const sumPath = path.join(this.config.outputDir, `calendar-summary-${Date.now()}.txt`);
        fs.writeFileSync(sumPath, summary, 'utf-8');
        console.log('   🔍 ' + summary.split('\n').join('\n   🔍 '));
      }
      const shot = path.join(this.config.outputDir, `debug-calendar-${Date.now()}.png`);
      await frame.page().screenshot({ path: shot, fullPage: false }).catch(() => undefined);
      console.log(`   🔍 截图：${shot}`);
    } catch (e) {
      console.log('   🔍 导出日历面板失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** 递归收集 page 下所有 frame（含顶层主 frame） */
  private collectAllFrames(page: Page): Frame[] {
    const out: Frame[] = [];
    const walk = (f: Frame): void => {
      out.push(f);
      for (const child of f.childFrames()) walk(child);
    };
    walk(page.mainFrame());
    return out;
  }

  /**
   * 回读日期范围控件最终显示的值（跨所有 frame）。
   * evaluate 内用纯 for 循环，禁止定义函数（tsx __name 坑）。
   */
  private async readDateRangeValue(page: Page): Promise<string> {
    const frames = this.collectAllFrames(page);
    for (const f of frames) {
      let v = '';
      try {
        v = await f.evaluate(() => {
          let result = '';
          const inputs = document.querySelectorAll('input');
          for (let i = 0; i < inputs.length; i++) {
            const el = inputs[i] as HTMLInputElement;
            const ph = (el.getAttribute('placeholder') || '').trim();
            if (ph === '请选择时间范围' || ph.indexOf('日期') >= 0 || ph.indexOf('时间') >= 0) {
              const val = (el.value || '').trim();
              if (val) {
                if (result) result += ' | ';
                result += ph + ':' + val;
              }
            }
          }
          return result;
        });
      } catch {
        v = '';
      }
      if (v) return v;
    }
    return '';
  }

  private async findClickableText(
    page: Page,
    text: string,
    selectors: string[]
  ): Promise<ElementHandle<Element> | null> {
    const handle = await page.evaluateHandle(
      ({ target, sels }) => {
        const all: Element[] = [];
        for (const sel of sels) {
          document.querySelectorAll(sel).forEach((el) => all.push(el));
        }
        const match = all.find((el) => {
          const t = (el.textContent || '').trim();
          if (t !== target) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });
        return match || null;
      },
      { target: text, sels: selectors }
    );
    const el = handle.asElement();
    if (!el) {
      await handle.dispose();
      return null;
    }
    return el;
  }

  /** 诊断：打印当前页主要可见文本块/菜单，便于定位真实入口结构 */
  private async dumpVisibleMenu(page: Page): Promise<void> {
    try {
      const url = page.url();
      console.log(`   🔍 诊断当前页 URL: ${url}`);
      const info = await page
        .evaluate(() => {
          const visible = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          const titles = Array.from(document.querySelectorAll('span.title'))
            .filter(visible)
            .map((el) => (el.textContent || '').trim())
            .filter((t) => t && t.length < 24);
          const clickable = Array.from(
            document.querySelectorAll('a, button, [role="menuitem"], li, [class*="menu-item"]')
          )
            .filter(visible)
            .map((el) => (el.textContent || '').trim())
            .filter((t) => t && t.length < 24);
          return {
            titles: [...new Set(titles)],
            clickable: [...new Set(clickable)],
          };
        })
        .catch(() => ({ titles: [] as string[], clickable: [] as string[] }));
      console.log('   🔍 左侧菜单标题(span.title):', info.titles.slice(0, 40).join(' | ') || '(无)');
      console.log('   🔍 可见可点击项:', info.clickable.slice(0, 60).join(' | ') || '(无)');
    } catch {
      /* ignore */
    }
  }

  /**
   * 报表中心内容在 iframe 内。返回包含"使用模板"或报表卡片标题的 Frame。
   */
  private async waitForReportFrame(page: Page): Promise<Frame> {
    const want = this.config.reportCardName;
    const deadline = Date.now() + 30000;
    let lastErr: string = '';
    while (Date.now() < deadline) {
      const frames = page.frames();
      for (const f of frames) {
        try {
          const hasCard = await f
            .locator(`text=${want}`)
            .first()
            .isVisible({ timeout: 600 })
            .catch(() => false);
          if (hasCard) return f;
          const hasBtn = await f
            .locator('text=使用模板')
            .first()
            .isVisible({ timeout: 600 })
            .catch(() => false);
          if (hasBtn) return f;
        } catch (e: unknown) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      await page.waitForTimeout(800);
    }
    // 兜底：返回任意非主 frame
    const sub = page.frames().find((f) => f !== page.mainFrame());
    if (sub) return sub;
    throw new Error(`未找到报表中心 iframe（${lastErr || '超时'}）`);
  }

  /**
   * 在页面顶层和所有 iframe 内都尝试点掉右下角引导气泡的"跳过"，
   * 防止首页那一次没点中、或跨页面后引导又出现。
   */
  private async dismissGuideEverywhere(page: Page): Promise<void> {
    const targets = [page, ...page.frames()];
    for (const scope of targets) {
      try {
        // 直接用 Playwright 精确匹配叶子文本
        const skip = scope.locator('button:has-text("跳过"), [role="button"]:has-text("跳过")').first();
        if (await skip.isVisible({ timeout: 400 }).catch(() => false)) {
          await skip.click({ timeout: 1500 }).catch(() => undefined);
          await page.waitForTimeout(400);
        } else {
          // 兜底：在 DOM 里找文本恰好为"跳过"的小节点并点击
          const clicked = await scope
            .evaluate(() => {
              const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
              const visible = (el: Element): boolean => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
              };
              const leaf = all.find(
                (el) => visible(el) && el.children.length <= 1 && (el.textContent || '').trim() === '跳过'
              );
              if (leaf) {
                (leaf.closest('button,a,[role="button"],[class*="btn"]') || leaf).dispatchEvent(
                  new MouseEvent('click', { bubbles: true, cancelable: true })
                );
                return true;
              }
              return false;
            })
            .catch(() => false);
          if (clicked) {
            await page.waitForTimeout(400);
          }
        }
      } catch {
        /* ignore frame cross-origin errors */
      }
    }
    // 清掉顶层 body driver class
    await this.dismissOverlays(page);
  }

  /**
   * 关闭右上角"重点消息/通知"等弹窗（点其 × 或"收起/关闭"），避免遮挡报表对话框与按钮。
   * 在顶层页面和各 frame 都尝试一次。
   */
  private async dismissNotifications(page: Page): Promise<void> {
    const scopes = [page, ...page.frames()];
    for (const scope of scopes) {
      try {
        // 优先用可见文本定位"关闭"类按钮
        const textBtns = [
          'text=重点消息',
          'button:has-text("关闭")',
          '[role="button"]:has-text("关闭")',
          'button:has-text("收起")',
        ];
        for (const sel of textBtns) {
          const btn = scope.locator(sel).first();
          if (await btn.isVisible({ timeout: 250 }).catch(() => false)) {
            // 找到弹窗容器内的 × 关闭图标（常见为 aria-label=close / class 含 close）
            const close = scope
              .locator('[aria-label="close"], [aria-label="关闭"], [class*="close"], [class*="Close"]')
              .last();
            if (await close.isVisible({ timeout: 300 }).catch(() => false)) {
              await close.click({ timeout: 1200 }).catch(() => undefined);
              await page.waitForTimeout(400);
              break;
            }
          }
        }
        // 兜底：DOM 里找包含"重点消息"且右上角有可点 × 的容器
        await scope
          .evaluate(() => {
            const all = document.querySelectorAll('div,aside,section');
            for (let i = 0; i < all.length; i++) {
              const el = all[i] as HTMLElement;
              const t = (el.textContent || '').trim();
              if (t.indexOf('重点消息') !== 0) continue;
              const r = el.getBoundingClientRect();
              if (r.width < 100) continue;
              // 找容器内最后一个看起来像关闭的小元素
              const closes = el.querySelectorAll('[class*="close"],[class*="Close"],svg,button,[role="button"]');
              let target: HTMLElement | null = null;
              for (let j = closes.length - 1; j >= 0; j--) {
                const c = closes[j] as HTMLElement;
                const cr = c.getBoundingClientRect();
                if (cr.width > 0 && cr.width <= 40 && cr.height <= 40) {
                  target = c;
                  break;
                }
              }
              if (target) {
                (target as HTMLElement).click();
                return true;
              }
            }
            return false;
          })
          .catch(() => false);
      } catch {
        /* ignore cross-origin */
      }
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

  private parseExcel(filePath: string): MeituanRow[] {
    // 双行表头语义化解析：维度列 + 指标(单位) + <指标>__环比，全量保留
    return parseMeituanWorkbook(filePath);
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

  /**
   * 判断当前是否仍在美团/点评商家后台（登录态）。
   * 用于失败时决定是否刷新 Cookie 存档，避免把登录页的失效 Cookie 写盘。
   */
  private async isLoggedInContext(): Promise<boolean> {
    if (!this.page) return false;
    const url = this.page.url();
    if (!/(dianping\.com|meituan\.com|maoyan\.com|meituan\.net)/i.test(url)) return false;
    if (/(login|passport|sign[-_]?in|account\/login)/i.test(url)) return false;
    return true;
  }

  private async saveCookiesIfLoggedIn(): Promise<void> {
    if (await this.isLoggedInContext()) {
      await this.saveCookies();
    } else {
      console.warn('⚠️  当前处于非登录态页面，跳过 Cookie 存档以保护既有登录态');
    }
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
