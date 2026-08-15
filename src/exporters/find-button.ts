import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function findButton() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const cookiePath = path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json');
  if (fs.existsSync(cookiePath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    await context.addCookies(cookies);
  }

  const page = await context.newPage();
  await page.goto('https://e.dianping.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  // 关闭弹窗
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach(btn => {
      if (btn.textContent?.includes('知道了')) btn.click();
      if (btn.textContent?.includes('跳过')) btn.click();
    });
    document.querySelectorAll('[class*="close"]').forEach(el => (el as HTMLElement).click());
  });
  await page.waitForTimeout(2000);

  // 导航到报表中心
  await page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('*'));
    const advisor = menus.find(el => el.textContent?.trim() === '经营参谋');
    if (advisor) (advisor as HTMLElement).click();
  });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('*'));
    const report = menus.find(el => el.textContent?.trim() === '报表中心');
    if (report) (report as HTMLElement).click();
  });
  await page.waitForTimeout(10000);

  console.log('=== 查找"使用模板"按钮 ===\n');

  // 查找所有包含"模板"的元素，打印详细信息
  const result = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('*'));
    return allElements
      .filter(el => {
        const text = el.textContent || '';
        return text.includes('模板');
      })
      .map(el => {
        // 获取计算后的样式
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        
        return {
          tag: el.tagName,
          text: el.textContent?.trim(),
          textLength: el.textContent?.trim().length,
          textHex: Array.from(el.textContent?.trim() || '').map(c => c.charCodeAt(0).toString(16)).join(' '),
          class: el.className?.toString().substring(0, 100),
          id: el.id,
          visible: rect.width > 0 && rect.height > 0,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          children: el.children.length,
        };
      });
  });

  console.log(`找到 ${result.length} 个包含"模板"的元素：\n`);
  result.forEach((el, i) => {
    console.log(`[${i}] <${el.tag}>`);
    console.log(`    文本："${el.text}"`);
    console.log(`    长度：${el.textLength} 字符`);
    console.log(`    十六进制：${el.textHex}`);
    console.log(`    类名：${el.class}`);
    console.log(`    ID: ${el.id}`);
    console.log(`    可见：${el.visible}`);
    console.log(`    位置：x=${el.rect.x}, y=${el.rect.y}, w=${el.rect.width}, h=${el.rect.height}`);
    console.log(`    显示：${el.display}, 可见性：${el.visibility}, 透明度：${el.opacity}`);
    console.log(`    子元素：${el.children}个`);
    console.log('');
  });

  // 检查 iframe
  const frames = page.frames();
  console.log(`\n=== 页面有 ${frames.length} 个 Frame ===`);
  frames.forEach((frame, i) => {
    console.log(`Frame ${i}: ${frame.url().substring(0, 80)}`);
  });

  // 截图
  await page.screenshot({ path: path.join(process.cwd(), 'src', 'exporters', 'output', 'debug-find-button.png'), fullPage: true });
  console.log('\n📸 截图已保存：debug-find-button.png');

  console.log('\n️  浏览器保持打开，按 Enter 关闭...');
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  await browser.close();
}

findButton().catch(console.error);
