/**
 * 支付宝登录页探针（诊断用）—— 稳健版
 *
 * 用法：
 *   . ~/jiujiujin-dashboard/.alipay-env
 *   npx tsx src/exporters/probe-login.ts
 *
 * 你只需：浏览器打开后【手动输入密码】→【点蓝色登录按钮】（有滑块/短信就照常过）。
 * 脚本会在点击/输入/提交发生的【瞬间】通过 exposeFunction 把事件推给 Node 立即写盘，
 * 不再受登录后整页跳转导致 window 重置的影响；所有快照累积写入（不覆盖）。
 *
 * 产物：src/exporters/output/login-probe.ndjson（每行一条事件/快照，最关键）
 *       src/exporters/output/login-probe.json  （汇总）
 * 跑完把这两个文件（或终端输出）发回。
 */
import 'dotenv/config';
import { chromium, Page, Frame } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_DIR = process.cwd();
const userDataDir = path.join(PROJECT_DIR, 'src', 'exporters', 'browser-profile');
const outDir = path.join(PROJECT_DIR, 'src', 'exporters', 'output');
fs.mkdirSync(outDir, { recursive: true });

const ndjsonFile = path.join(outDir, 'login-probe.ndjson');
const jsonFile = path.join(outDir, 'login-probe.json');
fs.writeFileSync(ndjsonFile, '', 'utf-8'); // 清空

const allRecords: Array<Record<string, unknown>> = [];

function rec(label: string, data: Record<string, unknown>): void {
  const entry = { t: Date.now(), iso: new Date().toISOString(), label, ...data };
  allRecords.push(entry);
  fs.appendFileSync(ndjsonFile, JSON.stringify(entry) + '\n', 'utf-8');
  // 同步写汇总（每次都全量写，保证中断也有数据）
  try {
    fs.writeFileSync(jsonFile, JSON.stringify(allRecords, null, 2), 'utf-8');
  } catch {
    /* ignore */
  }
}

// 这段在浏览器页面里执行
function probeScript(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__probeInstalled2) return;
  w.__probeInstalled2 = true;

  const elInfo = (el: Element | null): Record<string, unknown> | null => {
    if (!el) return null;
    const htmlEl = el as HTMLElement;
    const r = htmlEl.getBoundingClientRect
      ? htmlEl.getBoundingClientRect()
      : ({ width: 0, height: 0 } as DOMRect);
    const st = window.getComputedStyle ? window.getComputedStyle(htmlEl) : ({} as CSSStyleDeclaration);
    return {
      tag: el.tagName,
      type: htmlEl.getAttribute && htmlEl.getAttribute('type'),
      name: htmlEl.getAttribute && htmlEl.getAttribute('name'),
      id: htmlEl.id || '',
      cls: (htmlEl.className && htmlEl.className.toString
        ? htmlEl.className.toString()
        : ''
      ).slice(0, 160),
      text: (htmlEl.textContent || '').replace(/\s+/g, '').slice(0, 30),
      placeholder: htmlEl.getAttribute && htmlEl.getAttribute('placeholder'),
      role: htmlEl.getAttribute && htmlEl.getAttribute('role'),
      disabled: !!(
        (htmlEl as HTMLInputElement).disabled ||
        (htmlEl.hasAttribute && htmlEl.hasAttribute('disabled'))
      ),
      w: Math.round(r.width || 0),
      h: Math.round(r.height || 0),
      visible: !!(
        r.width > 0 &&
        r.height > 0 &&
        st.display !== 'none' &&
        st.visibility !== 'hidden' &&
        Number(st.opacity) !== 0
      ),
      formAction: (htmlEl as HTMLInputElement).form
        ? (htmlEl as HTMLInputElement).form!.action
        : '',
      outer: htmlEl.outerHTML ? htmlEl.outerHTML.slice(0, 400) : '',
    };
  };
  w.__probeElInfo = elInfo;

  w.__probeSnapshot = () => {
    const inputs = Array.from(document.querySelectorAll('input')).map((el) => elInfo(el));
    const clickables = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a, div, span, input[type="submit"], input[type="button"], [role="button"]'
      )
    )
      .filter((el) => (el.textContent || '').replace(/\s+/g, '').includes('登录'))
      .map((el) => elInfo(el));
    const forms = Array.from(document.querySelectorAll('form')).map((f) => ({
      action: f.action,
      id: f.id,
      method: f.method,
      noValidate: f.noValidate,
      childButtons: Array.from(f.querySelectorAll('button,input[type="submit"]')).map((el) =>
        elInfo(el)
      ),
    }));
    return { url: location.href, title: document.title, inputs, clickables, forms };
  };

  const send = (type: string, data: Record<string, unknown>): void => {
    try {
      // 立即推给 Node 写盘（不等跳转）
      if (typeof w.__probePush === 'function') {
        w.__probePush({ type, url: location.href, ...data }).catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  };

  // 点击：记录命中元素 + 祖先链
  document.addEventListener(
    'click',
    (ev) => {
      const chain: unknown[] = [];
      let n: Element | null = ev.target as Element;
      let depth = 0;
      while (n && depth < 7) {
        chain.push(elInfo(n));
        n = n.parentElement;
        depth++;
      }
      send('click', { target: elInfo(ev.target as Element), chain });
    },
    true
  );

  // 提交
  document.addEventListener(
    'submit',
    (ev) => {
      send('submit', {
        defaultPrevented: ev.defaultPrevented,
        form: elInfo(ev.target as Element),
      });
    },
    true
  );

  // 输入（只记长度，不记密码明文）
  document.addEventListener(
    'input',
    (ev) => {
      const t = ev.target as HTMLInputElement;
      send('input', {
        tag: t.tagName,
        type: t.type,
        name: t.name,
        id: t.id,
        valueLen: t && t.value ? t.value.length : 0,
      });
    },
    true
  );

  // 页面即将跳转时最后打一帧快照（best effort）
  window.addEventListener('beforeunload', () => {
    try {
      send('beforeunload', { snap: w.__probeSnapshot ? w.__probeSnapshot() : null });
    } catch {
      /* ignore */
    }
  });

  send('installed', {});
}

async function attachProbe(page: Page): Promise<void> {
  // 暴露给浏览器：事件立即回 Node 写盘
  await page
    .exposeFunction('__probePush', (payload: Record<string, unknown>) => {
      rec('browser-event:' + String(payload.type || '?'), payload);
    })
    .catch(() => undefined);
  await page.addInitScript(`(${probeScript.toString()})();`);
}

async function snapshot(page: Page, label: string): Promise<void> {
  // 主 frame + 所有子 frame 都采
  const frames = page.frames();
  const frameSnaps: unknown[] = [];
  for (const f of frames) {
    const snap = await f
      .evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        return w.__probeSnapshot ? w.__probeSnapshot() : null;
      })
      .catch(() => null);
    if (snap) {
      frameSnaps.push({ frameUrl: f.url(), ...(snap as Record<string, unknown>) });
    }
  }
  rec('snapshot:' + label, { frames: frameSnaps });
  printSnapshot(label, frameSnaps);
}

function printSnapshot(label: string, frames: unknown[]): void {
  console.log(`\n===== 快照 [${label}] =====`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const fs of frames as any[]) {
    console.log(`\n--- frame: ${fs.frameUrl} | title: ${fs.title}`);
    console.log(`inputs: ${fs.inputs?.length ?? 0}`);
    for (const inp of fs.inputs ?? []) {
      console.log(
        `  ${inp.visible ? '*' : ' '} <${inp.tag}> type=${inp.type} name=${inp.name} id=${inp.id} ph="${inp.placeholder}" ${inp.w}x${inp.h} disabled=${inp.disabled}`
      );
      console.log(`      class=${inp.cls}`);
    }
    console.log(`含「登录」元素: ${fs.clickables?.length ?? 0}`);
    for (const b of fs.clickables ?? []) {
      console.log(
        `  ${b.visible ? '*' : ' '} <${b.tag}> type=${b.type} role=${b.role} text="${b.text}" ${b.w}x${b.h}`
      );
      console.log(`      class=${b.cls}`);
      if (b.outer) console.log(`      outer=${b.outer}`);
    }
    console.log(`forms: ${fs.forms?.length ?? 0}`);
    for (const f of fs.forms ?? []) {
      console.log(`  form action=${f.action} id=${f.id} noValidate=${f.noValidate}`);
      for (const cb of f.childButtons ?? []) {
        console.log(`      btn <${cb.tag}> type=${cb.type} text="${cb.text}" ${cb.w}x${cb.h}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const username = process.env.ALIPAY_USERNAME || '';
  if (!username) console.warn('⚠️  未设置 ALIPAY_USERNAME，账号需你手动输入');

  fs.mkdirSync(userDataDir, { recursive: true });
  for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = path.join(userDataDir, lockName);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
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

  const page: Page = context.pages()[0] || (await context.newPage());
  await attachProbe(page);
  context.on('page', async (p: Page) => {
    await attachProbe(p).catch(() => undefined);
  });
  // 每次导航都打快照（跳转前/后）
  page.on('framenavigated', async (frame: Frame) => {
    if (frame === page.mainFrame()) {
      rec('framenavigated', { url: frame.url() });
    }
  });

  const url =
    'https://auth.alipay.com/login/index.htm?goto=' +
    encodeURIComponent('https://b.alipay.com/page/manage-consultant/trade-analysis/overview');
  console.log('🌐 打开支付宝登录页...');
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await page.waitForTimeout(1800);
  for (const sel of ['text=账密登录', 'a:has-text("账密登录")', 'li:has-text("账密登录")']) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
      await loc.click({ timeout: 2000 }).catch(() => undefined);
      break;
    }
  }
  await page.waitForTimeout(1000);

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
    console.log(`✏️  已自动填账号: ${username}（密码请手动输入）`);
  }

  await snapshot(page, '初始(账号已填,密码待输入)');

  console.log('\n==================================================');
  console.log('👉  请在浏览器里【手动输入密码】并【点蓝色登录按钮】');
  console.log('    有滑块/短信验证也照常完成。脚本全程录制。');
  console.log('==================================================\n');

  const start = Date.now();
  let lastSnap = 0;
  while (Date.now() - start < 6 * 60 * 1000) {
    await page.waitForTimeout(1000);
    // 每 3 秒一个快照（仍在登录页时）
    if (Date.now() - lastSnap > 3000) {
      await snapshot(page, '进行中').catch(() => undefined);
      lastSnap = Date.now();
    }
    if (!/login|passport/i.test(page.url())) {
      console.log('✅ 已离开登录页:', page.url());
      await page.waitForTimeout(2000);
      break;
    }
  }

  await snapshot(page, '结束').catch(() => undefined);
  console.log('\n✅ 采集完成。');
  console.log(`   关键文件（把它发我）: ${ndjsonFile}`);
  console.log(`   汇总文件: ${jsonFile}`);
  console.log('   浏览器保持打开，可自行关闭。');
  await new Promise(() => {});
}

main().catch((e) => {
  console.error('探针运行失败：', e);
  process.exit(1);
});
