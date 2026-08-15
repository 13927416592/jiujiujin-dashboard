import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

console.log('正在打开支付宝商家平台...');
await page.goto('https://b.alipay.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

console.log('请在浏览器中完成登录（扫码或密码）...');
console.log('登录成功后，脚本会自动抓取数据。');

try {
  await page.waitForSelector('text=经营数据', { timeout: 120000 });
  console.log('检测到登录成功，开始抓取数据...');
} catch {
  console.log('等待超时，尝试继续抓取...');
}

await new Promise(r => setTimeout(r, 5000));

const data = await page.evaluate(() => {
  const cards = document.querySelectorAll('[class*="card"], [class*="data-item"]');
  const results = [];
  cards.forEach(card => {
    const text = card.innerText?.trim();
    if (text) results.push(text);
  });
  return {
    url: window.location.href,
    title: document.title,
    cards: results,
    bodyText: document.body?.innerText?.substring(0, 3000)
  };
});

mkdirSync('./src/exporters/output', { recursive: true });
const filename = `./src/exporters/output/alipay_raw_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(filename, JSON.stringify(data, null, 2));
console.log(`数据已保存到: ${filename}`);

await browser.close();
console.log('完成！');
