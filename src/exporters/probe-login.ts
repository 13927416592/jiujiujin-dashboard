/**
 * 支付宝登录页探针（诊断用）
 *
 * 用法：
 *   . ~/jiujiujin-dashboard/.alipay-env
 *   npx tsx src/exporters/probe-login.ts
 *
 * 作用：
 *   启动浏览器到支付宝登录页，自动填入 ALIPAY_USERNAME（账号），但【不自动填密码、不自动点登录】。
 *   然后请你【手动】在浏览器里：
 *     1) 确认账号框内容（不对就手动改）
 *     2) 手动输入密码
 *     3) 手动点蓝色「登录」按钮
 *   在这期间脚本会通过 init script 记录：
 *     - 页面上所有 input（含隐藏的）的 tag/type/name/id/placeholder/class/尺寸/可见性/所在 form
 *     - 所有含「登录」字样的可点元素（button/a/div/span/input）的同样信息
 *     - 你点击「登录」时实际命中的元素（event.target / currentTarget）及其外层结构
 *     - 点击后是否发生表单提交 / URL 变化
 *
 *   录到的信息会打印到终端，并写到 src/exporters/output/login-probe.json，
 *   把终端输出（或该 json）发回，就能据此一次性写对自动填充和按钮点击逻辑。
 */
import 'dotenv/config';
import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_DIR = process.cwd();
const userDataDir = path.join(PROJECT_DIR, 'src', 'exporters', 'browser-profile');
const outDir = path.join(PROJECT_DIR, 'src', 'exporters', 'output');
fs.mkdirSync(outDir, { recursive: true });

// 这段在浏览器页面里执行，挂载一个全局采集器
const PROBE_SCRIPT = `
(() => {
  if (window.__loginProbeInstalled) return;
  window.__loginProbeInstalled = true;
  window.__probeLog = [];
  const push = (type, data) => {
    try { window.__probeLog.push({ t: Date.now(), type, ...data }); } catch (e) {}
  };

  const elInfo = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const st = window.getComputedStyle ? window.getComputedStyle(el) : {};
    return {
      tag: el.tagName,
      type: el.getAttribute && el.getAttribute('type'),
      name: el.getAttribute && el.getAttribute('name'),
      id: el.id || '',
      cls: (el.className && el.className.toString) ? el.className.toString().slice(0, 120) : '',
      text: (el.textContent || '').replace(/\\s+/g, '').slice(0, 30),
      placeholder: el.getAttribute && el.getAttribute('placeholder'),
      role: el.getAttribute && el.getAttribute('role'),
      disabled: !!(el.disabled || el.hasAttribute && el.hasAttribute('disabled')),
      w: Math.round(r.width || 0),
      h: Math.round(r.height || 0),
      visible: !!(r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0),
      formAction: el.form ? el.form.action : '',
      outerHTMLStart: el.outerHTML ? el.outerHTML.slice(0, 300) : '',
    };
  };
  window.__probeElInfo = elInfo;

  // 采集全页快照
  window.__probeSnapshot = () => {
    const inputs = Array.from(document.querySelectorAll('input')).map(elInfo);
    const clickables = Array.from(document.querySelectorAll('button, a, div, span, input[type="submit"], input[type="button"], [role="button"]'))
      .filter(el => (el.textContent || '').replace(/\\s+/g, '').includes('登录'))
      .map(elInfo);
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({
      action: f.action, id: f.id, method: f.method, noValidate: f.noValidate,
      childButtons: Array.from(f.querySelectorAll('button,input[type="submit"]')).map(elInfo),
    }));
    return { url: location.href, title: document.title, inputs, clickables, forms };
  };

  // 监听全局点击：记录实际命中的元素及其祖先链
  document.addEventListener('click', (ev) => {
    const chain = [];
    let n = ev.target;
    let depth = 0;
    while (n && depth < 6) { chain.push(elInfo(n)); n = n.parentElement; depth++; }
    push('click', { target: elInfo(ev.target), currentTarget: elInfo(ev.currentTarget), chain });
  }, true);

  // 监听表单提交
  document.addEventListener('submit', (ev) => {
    push('submit', { defaultPrevented: ev.defaultPrevented, form: elInfo(ev.target) });
  }, true);

  // 监听 input 值变化
  document.addEventListener('input', (ev) => {
    push('input', { el: elInfo(ev.target), valueLen: ev.target && ev.target.value ? ev.target.value.length : 0 });
  }, true);

  push('installed', {});
})();
`;

async function snapshot(page: Page, label: string): Promise<void> {
  const data = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return w.__probeSnapshot ? w.__probeSnapshot() : null;
  });
  const events = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__probeLog || [];
  });
  const payload = { label, at: new Date().toISOString(), snapshot: data, events };
  const file = path.join(outDir, 'login-probe.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`\n===== 探针快照 [${label}] =====`);
  console.log('URL:', data?.url);
  console.log('title:', data?.title);
  console.log(`inputs: ${data?.inputs?.length ?? 0} 个（可见的标 *）：`);
  for (const inp of data?.inputs ?? []) {
    console.log(
      `  ${inp.visible ? '*' : ' '} <${inp.tag}> type=${inp.type} name=${inp.name} id=${inp.id} placeholder="${inp.placeholder}" ${inp.w}x${inp.h} disabled=${inp.disabled}`
    );
    console.log(`      class=${inp.cls}`);
    if (inp.outerHTMLStart) console.log(`      html=${inp.outerHTMLStart}`);
  }
  console.log(`\n含「登录」的可点元素: ${data?.clickables?.length ?? 0} 个（可见的标 *）：`);
  for (const b of data?.clickables ?? []) {
    console.log(
      `  ${b.visible ? '*' : ' '} <${b.tag}> type=${b.type} role=${b.role} text="${b.text}" ${b.w}x${b.h} disabled=${b.disabled}`
    );
    console.log(`      class=${b.cls}`);
    if (b.outerHTMLStart) console.log(`      html=${b.outerHTMLStart}`);
  }
  console.log(`\nforms: ${data?.forms?.length ?? 0} 个`);
  for (const f of data?.forms ?? []) {
    console.log(`  form action=${f.action} id=${f.id} noValidate=${f.noValidate}, 内部按钮 ${f.childButtons?.length ?? 0} 个`);
    for (const cb of f.childButtons ?? []) {
      console.log(`      - <${cb.tag}> type=${cb.type} text="${cb.text}" ${cb.w}x${cb.h}`);
    }
  }
  console.log(`\n事件记录 ${events.length} 条（最近 15 条 click/submit）：`);
  for (const e of events.filter((x: { type: string }) => x.type === 'click' || x.type === 'submit').slice(-15)) {
    if (e.type === 'click') {
      console.log(`  [click] 命中 <${e.target?.tag}> "${e.target?.text}" ${e.target?.w}x${e.target?.h}`);
      if (e.chain?.[1]) console.log(`         父级 <${e.chain[1].tag}> "${e.chain[1].text}" class=${e.chain[1].cls}`);
    } else {
      console.log(`  [submit] form action=${e.form?.action} defaultPrevented=${e.defaultPrevented}`);
    }
  }
  console.log(`\n已写入: ${file}\n`);
}

async function main(): Promise<void> {
  const username = process.env.ALIPAY_USERNAME || '';
  if (!username) {
    console.warn('⚠️  未设置 ALIPAY_USERNAME，将不自动填账号（你也可以手动输入）');
  }

  fs.mkdirSync(userDataDir, { recursive: true });
  for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = path.join(userDataDir, lockName);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--disable-save-password-bubble',
    ],
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.addInitScript(PROBE_SCRIPT);
  // 对任何新页面/导航也注入
  context.on('page', async (p) => { await p.addInitScript(PROBE_SCRIPT).catch(() => undefined); });

  const url =
    'https://auth.alipay.com/login/index.htm?goto=' +
    encodeURIComponent('https://b.alipay.com/page/manage-consultant/trade-analysis/overview');
  console.log('🌐 打开支付宝登录页...');
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // 尝试切到账密登录 Tab
  await page.waitForTimeout(1500);
  for (const sel of ['text=账密登录', 'a:has-text("账密登录")', 'li:has-text("账密登录")']) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
      await loc.click({ timeout: 2000 }).catch(() => undefined);
      break;
    }
  }
  await page.waitForTimeout(800);

  // 自动填账号（不填密码、不点登录）
  if (username) {
    const acct = page
      .locator(
        [
          'input[name="logonId"]:not([type="password"])',
          'input[placeholder*="账户"]:not([type="password"])',
          'input[placeholder*="账号"]:not([type="password"])',
          'input[placeholder*="手机"]:not([type="password"])',
          'input[type="text"]:not([type="password"])',
        ].join(', ')
      )
      .first();
    await acct.fill(username, { timeout: 4000, force: true }).catch(() => undefined);
    console.log(`✏️  已自动填入账号: ${username}（密码请你手动输入）`);
  }

  await snapshot(page, '初始（账号已填，密码待手动输入）');

  console.log('==================================================');
  console.log('👉  请在浏览器里【手动输入密码】并【点击蓝色登录按钮】');
  console.log('    脚本会在你点击后自动采集页面结构和事件。');
  console.log('    如果有滑块/短信验证，也请一并完成。');
  console.log('==================================================');

  // 等 URL 离开登录页，或最多 5 分钟
  const start = Date.now();
  let lastSnap = 0;
  while (Date.now() - start < 5 * 60 * 1000) {
    await page.waitForTimeout(1500);
    const curUrl = page.url();
    // 每隔 5 秒打一个增量快照（捕获你输入密码、点击过程）
    if (Date.now() - lastSnap > 5000) {
      await snapshot(page, '进行中');
      lastSnap = Date.now();
    }
    if (!/login|passport/i.test(curUrl)) {
      console.log('✅ 已离开登录页:', curUrl);
      break;
    }
  }

  await snapshot(page, '结束');
  console.log('✅ 采集完成。请把上面的终端输出，');
  console.log(`   或文件 ${path.join(outDir, 'login-probe.json')} 发回。`);
  console.log('   浏览器保持打开，你可以自行关闭。');
  // 不自动关闭浏览器，方便用户查看
  await new Promise(() => {});
}

main().catch((e) => {
  console.error('探针运行失败：', e);
  process.exit(1);
});
