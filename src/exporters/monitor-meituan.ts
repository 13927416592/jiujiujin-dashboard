import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function monitorOperations() {
  console.log('🎯 开始监控美团经营宝操作...\n');
  console.log('📋 操作步骤：');
  console.log('1. 登录美团经营宝');
  console.log('2. 点击"经营参谋"');
  console.log('3. 点击"报表中心"');
  console.log('4. 点击"使用模板"');
  console.log('5. 完成操作后按 Enter\n');

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const cookiePath = path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json');
  if (fs.existsSync(cookiePath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    await context.addCookies(cookies);
    console.log('🍪 已加载 Cookie');
  }

  const page = await context.newPage();
  await page.goto('https://e.dianping.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 记录操作日志
  const logs: Array<{ time: string; url: string; title: string; screenshot: string }> = [];
  let step = 0;

  const takeSnapshot = async (label: string) => {
    step++;
    const url = page.url();
    const title = await page.title();
    const screenshotName = `monitor-${String(step).padStart(2, '0')}-${label}.png`;
    const screenshotPath = path.join(process.cwd(), 'src', 'exporters', 'output', screenshotName);
    
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    logs.push({
      time: new Date().toISOString(),
      url: url.substring(0, 100),
      title,
      screenshot: screenshotName,
    });

    console.log(`\n [步骤 ${step}] ${label}`);
    console.log(`   URL: ${url.substring(0, 80)}...`);
    console.log(`   标题：${title}`);
    console.log(`   截图：${screenshotName}`);
  };

  // 监听页面导航
  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      console.log(`🔗 页面导航：${frame.url().substring(0, 80)}...`);
    }
  });

  // 监听控制台消息
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`❌ 页面错误：${msg.text().substring(0, 100)}`);
    }
  });

  console.log('️  浏览器已打开，请开始手动操作...\n');
  console.log('我会每 3 秒自动截图一次，记录你的操作过程。\n');

  // 自动截图循环
  const snapshotInterval = setInterval(async () => {
    const currentUrl = page.url();
    const lastLog = logs[logs.length - 1];
    
    // 如果 URL 变化了，自动截图
    if (!lastLog || !currentUrl.includes(lastLog.url.substring(0, 50))) {
      await takeSnapshot('URL 变化');
    }
  }, 3000);

  // 等待用户完成操作
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => {
      clearInterval(snapshotInterval);
      resolve();
    });
  });

  // 最终截图
  await takeSnapshot('最终状态');

  // 保存操作日志
  const logPath = path.join(process.cwd(), 'src', 'exporters', 'output', 'monitor-log.json');
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
  console.log(`\n💾 操作日志已保存：monitor-log.json`);

  // 打印完整日志
  console.log('\n=== 操作记录 ===');
  logs.forEach((log, i) => {
    console.log(`${i + 1}. [${log.time}] ${log.title}`);
    console.log(`   URL: ${log.url}`);
    console.log(`   截图：${log.screenshot}`);
  });

  console.log('\n✅ 监控完成！请把所有 monitor-*.png 截图发给我。');
  console.log('️  浏览器保持打开，按 Enter 关闭...');
  
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  await browser.close();
}

monitorOperations().catch(console.error);
