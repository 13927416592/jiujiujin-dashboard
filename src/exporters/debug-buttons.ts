import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function debugButtons() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const cookiePath = path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json');
  if (fs.existsSync(cookiePath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    await context.addCookies(cookies);
  }

  const page = await context.newPage();
  await page.goto('https://e.dianping.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 关闭弹窗
  const knowBtn = page.locator('button:has-text("知道了")').first();
  if (await knowBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await knowBtn.click();
    await page.waitForTimeout(1000);
  }

  // 导航到报表中心
  await page.locator('text=经营参谋').first().click();
  await page.waitForTimeout(3000);
  await page.locator('text=报表中心').first().click();
  await page.waitForTimeout(10000);

  console.log('=== 页面分析 ===\n');

  // 1. 检查是否有 iframe
  const frames = page.frames();
  console.log(`📦 页面有 ${frames.length} 个 frame`);
  frames.forEach((frame, i) => {
    console.log(`  Frame ${i}: ${frame.url().substring(0, 80)}`);
  });

  // 2. 在主 frame 中查找所有包含"模板"的元素
  console.log('\n=== 主 Frame 中的"模板"元素 ===');
  const templateElements = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all
      .filter(el => el.textContent?.includes('模板'))
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().substring(0, 50),
        class: el.className?.toString().substring(0, 50),
        id: el.id,
        visible: (el as HTMLElement).offsetParent !== null,
      }));
  });
  console.log(`找到 ${templateElements.length} 个元素`);
  templateElements.forEach((el, i) => {
    console.log(`  [${i}] <${el.tag}> "${el.text}" class="${el.class}" visible=${el.visible}`);
  });

  // 3. 在所有 iframe 中查找
  console.log('\n=== Iframe 中的"模板"元素 ===');
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i];
    const elements = await frame.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      return all
        .filter(el => el.textContent?.includes('模板'))
        .map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim().substring(0, 50),
          class: el.className?.toString().substring(0, 50),
        }));
    });
    if (elements.length > 0) {
      console.log(`Frame ${i} 找到 ${elements.length} 个元素`);
      elements.forEach((el, j) => {
        console.log(`  [${j}] <${el.tag}> "${el.text}" class="${el.class}"`);
      });
    }
  }

  // 4. 查找所有按钮
  console.log('\n=== 页面上的所有按钮 ===');
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"], a.btn'))
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().substring(0, 50),
        class: el.className?.toString().substring(0, 50),
      }))
      .filter(el => el.text);
  });
  console.log(`找到 ${buttons.length} 个按钮`);
  buttons.slice(0, 20).forEach((btn, i) => {
    console.log(`  [${i}] <${btn.tag}> "${btn.text}" class="${btn.class}"`);
  });

  // 截图
  await page.screenshot({ path: path.join(process.cwd(), 'src', 'exporters', 'output', 'debug-buttons.png'), fullPage: true });
  console.log('\n📸 截图已保存：debug-buttons.png');

  console.log('\n️  浏览器保持打开，按 Enter 关闭...');
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  await browser.close();
}

debugButtons().catch(console.error);
