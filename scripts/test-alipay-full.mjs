import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

const DATE = new Date().toISOString().split('T')[0];
const OUTPUT_DIR = './src/exporters/output';
const results = { date: DATE, pages: {} };
mkdirSync(OUTPUT_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeEvaluate(fn, label) {
  for (let retry = 0; retry < 3; retry++) {
    try { return await page.evaluate(fn); }
    catch (e) {
      if (e.message?.includes('Execution context was destroyed')) {
        console.log(`   ${label}: 页面跳转中，重试 ${retry + 1}/3...`);
        await sleep(3000);
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      } else throw e;
    }
  }
  return null;
}

async function waitForStable(label, timeout = 10000) {
  try { await page.waitForLoadState('networkidle', { timeout }); } catch {}
  await sleep(2000);
}

async function clickSidebar(menuText, subText) {
  console.log(`[菜单] ${menuText} > ${subText || ''}`);
  if (menuText) {
    await page.evaluate((text) => {
      const els = Array.from(document.querySelectorAll('a, div, span, li, [class*="menu"], [class*="nav"]'));
      const el = els.find(e => e.textContent?.trim() === text);
      if (el) el.click();
    }, menuText);
    await sleep(1500);
  }
  if (subText) {
    await page.evaluate((text) => {
      const els = Array.from(document.querySelectorAll('a, div, span, li, [class*="menu"], [class*="nav"], [class*="sub"]'));
      const el = els.find(e => e.textContent?.trim() === text);
      if (el) el.click();
    }, subText);
    await waitForStable(subText);
  }
}

async function clickTab(tabName) {
  console.log(`  [Tab] 点击: ${tabName}`);
  const clicked = await page.evaluate((name) => {
    let els = Array.from(document.querySelectorAll('a, button, [role="tab"], [class*="tab"], [class*="Tab"]'));
    let target = els.find(e => e.textContent?.trim() === name);
    if (target) { target.click(); return true; }
    target = els.find(e => e.textContent?.trim().startsWith(name));
    if (target) { target.click(); return true; }
    target = els.find(e => e.textContent?.trim().includes(name));
    if (target) { target.click(); return true; }
    els = Array.from(document.querySelectorAll('li, div, span'));
    target = els.find(e => e.textContent?.trim() === name && e.children.length < 3);
    if (target) { target.click(); return true; }
    return false;
  }, tabName);
  if (!clicked) console.log(`   [Tab] 未找到: ${tabName}`);
  await waitForStable(`Tab: ${tabName}`);
}

async function grabPageData(label) {
  const data = await safeEvaluate(() => {
    const metrics = [];
    document.querySelectorAll('[class*="card"], [class*="data-item"], [class*="metric"], [class*="stat"], [class*="value"], [class*="number"], [class*="amount"]').forEach(card => {
      const text = card.innerText?.trim();
      if (text && text.length > 2 && text.length < 300) metrics.push(text.replace(/\s+/g, ' '));
    });
    const tables = [];
    document.querySelectorAll('table').forEach(table => {
      const rows = [];
      table.querySelectorAll('tr').forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th, td')).map(td => td.innerText?.trim());
        if (cells.length > 0) rows.push(cells);
      });
      if (rows.length > 0) tables.push(rows);
    });
    return { url: window.location.href, title: document.title, metrics: metrics.slice(0, 100), tables: tables.slice(0, 20), bodyText: document.body?.innerText?.substring(0, 5000) };
  }, label);
  if (data) {
    console.log(`  ✓ ${label}: ${data.metrics.length} 个指标, ${data.tables.length} 个表格`);
    if (data.metrics.length === 0 && data.tables.length === 0) console.log(`  ⚠ 未抓到数据！URL: ${data.url}`);
  } else { console.log(`  ✗ ${label}: 抓取失败`); }
  return data;
}

console.log('=== 支付宝全量数据抓取（v2 修复版）===');
console.log(`日期: ${DATE}`);
console.log('');

console.log('[1] 打开支付宝商家平台...');
await page.goto('https://b.alipay.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

console.log('[2] 等待登录（请扫码）...');
let loggedIn = false;
for (let i = 0; i < 60; i++) {
  try {
    const hasData = await page.evaluate(() => {
      return document.body?.innerText?.includes('数据中心') || document.body?.innerText?.includes('经营数据') || document.body?.innerText?.includes('工作台');
    });
    if (hasData) { loggedIn = true; break; }
  } catch {}
  await sleep(2000);
  if (i % 5 === 0) console.log(`  等待中... ${i * 2}秒`);
}
if (!loggedIn) { console.log('[2] ✗ 登录超时！'); await browser.close(); process.exit(1); }
console.log('[2] ✓ 登录成功！');
await waitForStable('登录后首页');

console.log('\n[3] 经营总览...');
results.pages.overview = await grabPageData('经营总览');

console.log('\n[4] 流量分析...');
await clickSidebar('经营效果', '流量分析');
results.pages.traffic = { tabs: {} };
for (const tab of ['流量概览', '小程序流量', '生活号+流量', '商家粉丝群流量', '其他活跃流量']) {
  await clickTab(tab);
  results.pages.traffic.tabs[tab] = await grabPageData(`流量→${tab}`);
}

console.log('\n[5] 用户分析...');
await clickSidebar('经营效果', '用户分析');
results.pages.user = await grabPageData('用户分析');

console.log('\n[6] 交易分析...');
await clickSidebar('经营效果', '交易分析');
results.pages.trade = await grabPageData('交易分析');

console.log('\n[7] 小程序分析...');
await clickSidebar('经营阵地', '小程序分析');

const miniPrograms = await safeEvaluate(() => {
  const select = document.querySelector('select');
  if (select && select.options.length > 0) return Array.from(select.options).map(opt => ({ id: opt.value, name: opt.textContent?.trim() }));
  const dropdown = document.querySelector('[class*="select"], [class*="dropdown"], [class*="picker"]');
  if (dropdown) {
    const items = dropdown.querySelectorAll('[class*="option"], [class*="item"], li');
    if (items.length > 0) return Array.from(items).map(item => ({ id: item.dataset?.value || item.getAttribute('data-value') || '', name: item.textContent?.trim() || '' }));
  }
  const text = document.body?.innerText || '';
  const ids = [...text.matchAll(/ID[:\s]*(\d{10,})/g)].map(m => m[1]);
  const names = [...text.matchAll(/(今日金价格|黄金价格|黄金回收)[^\n]*/g)].map(m => m[0].trim());
  if (ids.length > 0) return ids.map((id, i) => ({ id, name: names[i] || '未知' }));
  const appidEls = Array.from(document.querySelectorAll('*')).filter(el => el.textContent?.includes('appid'));
  if (appidEls.length > 0) return appidEls.map(el => { const match = el.textContent?.match(/appid\s*(\d{10,})/); const nameMatch = el.textContent?.match(/(今日金价格|黄金价格|黄金回收)[^\n]*/); return { id: match?.[1] || '', name: nameMatch?.[0]?.trim() || '未知' }; });
  return [];
}, '获取小程序列表');
console.log(`  找到 ${miniPrograms?.length || 0} 个小程序`);
if (miniPrograms?.length > 0) miniPrograms.forEach((mp, i) => console.log(`    ${i+1}. ${mp.name} (${mp.id})`));

results.pages.miniProgram = { programs: [] };
if (miniPrograms && miniPrograms.length > 0) {
  for (const mp of miniPrograms) {
    console.log(`\n  --- ${mp.name} (${mp.id}) ---`);
    const mpData = { id: mp.id, name: mp.name, tabs: {} };
    if (mp.id) {
      await page.evaluate((id) => {
        const select = document.querySelector('select');
        if (select) { select.value = id; select.dispatchEvent(new Event('change')); return true; }
        const dropdown = document.querySelector('[class*="select"], [class*="dropdown"]');
        if (dropdown) { const trigger = dropdown.querySelector('[class*="selector"], [class*="trigger"], span'); if (trigger) trigger.click(); return true; }
        return false;
      }, mp.id);
      await sleep(3000);
    }
    for (const tab of ['概览', '流量', '交易']) {
      await clickTab(tab);
      mpData.tabs[tab] = await grabPageData(`${mp.name}→${tab}`);
    }
    results.pages.miniProgram.programs.push(mpData);
  }
} else {
  console.log('   未找到小程序，抓取默认数据');
  const mpData = { id: 'default', name: '默认小程序', tabs: {} };
  for (const tab of ['概览', '流量', '交易']) {
    await clickTab(tab);
    mpData.tabs[tab] = await grabPageData(`默认→${tab}`);
  }
  results.pages.miniProgram.programs.push(mpData);
}

console.log('\n[8] 生活号+分析...');
await clickSidebar('经营阵地', '生活号+分析');
results.pages.lifeAccount = await grabPageData('生活号+分析');

console.log('\n[9] 商家粉丝群...');
await clickSidebar('经营阵地', '商家粉丝群');
results.pages.fanGroup = await grabPageData('商家粉丝群');

const filename = `${OUTPUT_DIR}/alipay_full_${DATE}.json`;
writeFileSync(filename, JSON.stringify(results, null, 2));
console.log(`\n[保存] ✓ 数据已保存到: ${filename}`);

await browser.close();
console.log('=== 抓取完成！===');
