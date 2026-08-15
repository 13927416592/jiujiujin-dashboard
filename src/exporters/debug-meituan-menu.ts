import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function debugMenu() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const cookiePath = path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json');
  if (fs.existsSync(cookiePath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    await context.addCookies(cookies);
    console.log('🍪 已加载 Cookie');
  }

  const page = await context.newPage();
  
  console.log('🌐 打开美团经营宝...');
  await page.goto('https://e.dianping.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 检查是否需要登录
  const title = await page.title();
  console.log(`📄 当前标题：${title}`);
  console.log(` 当前 URL: ${page.url().substring(0, 100)}...`);

  // 如果还在登录页或跳转页，等待用户手动登录
  if (title.includes('登录') || page.url().includes('biz-choice') || page.url().includes('passport')) {
    console.log('\n⚠️  需要登录，请在浏览器中完成登录...');
    console.log('登录完成后按 Enter 继续...\n');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
    
    // 登录后再等待页面加载
    await page.waitForTimeout(5000);
    console.log(`📄 登录后标题：${await page.title()}`);
    console.log(`🔗 登录后 URL: ${page.url().substring(0, 100)}...`);
  }

  // 保存登录后的 Cookie
  const cookies = await context.cookies();
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  console.log('💾 Cookie 已更新');

  // 查找所有包含"经营"的文字元素
  console.log('\n=== 查找"经营参谋"相关元素 ===');
  const elements = await page.locator('*:has-text("经营参谋")').all();
  console.log(`找到 ${elements.length} 个元素`);
  for (let i = 0; i < elements.length; i++) {
    const tag = await elements[i].evaluate(el => el.tagName);
    const text = await elements[i].textContent();
    const cls = await elements[i].evaluate(el => el.className);
    console.log(`  [${i}] <${tag}> class="${cls}" text="${text?.trim().substring(0, 50)}"`);
  }

  // 查找所有包含"报表"的文字元素
  console.log('\n=== 查找"报表"相关元素 ===');
  const reportElements = await page.locator('*:has-text("报表")').all();
  console.log(`找到 ${reportElements.length} 个元素`);
  for (let i = 0; i < reportElements.length; i++) {
    const tag = await reportElements[i].evaluate(el => el.tagName);
    const text = await reportElements[i].textContent();
    const cls = await reportElements[i].evaluate(el => el.className);
    console.log(`  [${i}] <${tag}> class="${cls}" text="${text?.trim().substring(0, 50)}"`);
  }

  // 查找所有左侧菜单项
  console.log('\n=== 查找侧边栏菜单 ===');
  const menuItems = await page.locator('[class*="menu"] li, [class*="nav"] li, [class*="sidebar"] li, aside li, [class*="MenuItem"]').all();
  console.log(`找到 ${menuItems.length} 个菜单项`);
  for (let i = 0; i < Math.min(menuItems.length, 30); i++) {
    const text = await menuItems[i].textContent();
    console.log(`  [${i}] ${text?.trim().substring(0, 60)}`);
  }

  // 截图
  await page.screenshot({ path: path.join(process.cwd(), 'src', 'exporters', 'output', 'debug-menu-structure.png'), fullPage: true });
  console.log('\n📸 完整页面截图已保存');

  // 获取页面 HTML 结构（左侧栏部分）
  console.log('\n=== 左侧栏 HTML 结构 ===');
  const sidebarHtml = await page.evaluate(() => {
    const aside = document.querySelector('aside') || document.querySelector('[class*="sidebar"]') || document.querySelector('[class*="menu"]') || document.querySelector('[class*="nav"]');
    return aside ? aside.innerHTML.substring(0, 3000) : '未找到侧边栏';
  });
  console.log(sidebarHtml);

  console.log('\n️  浏览器保持打开，按 Enter 关闭...');
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  await browser.close();
}

debugMenu().catch(console.error);
