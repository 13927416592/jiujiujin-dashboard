import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 1000 });
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
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('知道了'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(1000);
  }

  // 导航到报表中心
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('*'));
    const menu = elements.find(el => el.textContent?.trim() === '经营参谋');
    if (menu) (menu as HTMLElement).click();
  });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('*'));
    const menu = elements.find(el => el.textContent?.trim() === '报表中心');
    if (menu) (menu as HTMLElement).click();
  });
  await page.waitForTimeout(5000);

  // 获取 iframe
  const reportFrame = page.frames().find(frame => 
    frame.url().includes('report-center') || frame.url().includes('h5.dianping.com')
  );

  if (!reportFrame) {
    console.log('❌ 未找到 iframe');
    await browser.close();
    return;
  }

  console.log('✅ 找到 iframe');

  // 点击使用模板
  const btn = reportFrame.locator('text=使用模板').first();
  await btn.click();
  console.log('✅ 已点击"使用模板"');

  // 等待更长时间
  console.log(' 等待对话框...');
  await page.waitForTimeout(10000);

  // 截图
  await page.screenshot({ path: 'debug-dialog.png', fullPage: true });
  console.log('📸 截图已保存');

  // 在 iframe 中查找对话框
  console.log('\n=== 在 iframe 中查找 ===');
  
  const iframeInputs = await reportFrame.locator('input').all();
  console.log(`iframe 中找到 ${iframeInputs.length} 个 input`);
  for (let i = 0; i < iframeInputs.length; i++) {
    const placeholder = await iframeInputs[i].getAttribute('placeholder').catch(() => null);
    const type = await iframeInputs[i].getAttribute('type').catch(() => null);
    console.log(`  input[${i}]: placeholder="${placeholder}", type="${type}"`);
  }

  // 查找按钮
  const iframeButtons = await reportFrame.locator('button').all();
  console.log(`\niframe 中找到 ${iframeButtons.length} 个 button`);
  for (let i = 0; i < iframeButtons.length; i++) {
    const text = await iframeButtons[i].textContent().catch(() => null);
    console.log(`  button[${i}]: "${text}"`);
  }

  // 查找"时间范围"
  const timeRange = await reportFrame.locator('text=时间范围').all();
  console.log(`\niframe 中找到 ${timeRange.length} 个"时间范围"`);

  // 查找"昨天"
  const yesterday = await reportFrame.locator('text=昨天').first().isVisible({ timeout: 2000 }).catch(() => false);
  console.log(`\niframe 中"昨天"可见：${yesterday}`);

  // 获取 iframe 的 HTML
  const iframeHtml = await reportFrame.evaluate(() => {
    const body = document.body;
    return body.innerHTML.substring(0, 3000);
  });
  console.log(`\niframe HTML (前 3000 字符):\n${iframeHtml}`);

  console.log('\n按回车键退出...');
  await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));
  await browser.close();
}

main().catch(console.error);
