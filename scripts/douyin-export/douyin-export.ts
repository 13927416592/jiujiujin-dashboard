/**
 * 抖音创作者中心数据导出脚本
 * 
 * 使用方式：
 * 1. 手动登录抖音创作者中心，导出 Cookie（见 README.md）
 * 2. 将 Cookie 保存到 cookies.json 文件
 * 3. 运行：npx tsx scripts/douyin-export/douyin-export.ts
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// 配置
const CONFIG = {
  // 抖音创作者中心数据中心 URL
  dataCenterUrl: 'https://creator.douyin.com/creator-micro/content/data',
  // Cookie 文件路径
  cookiesFile: path.join(__dirname, 'cookies.json'),
  // 下载目录
  downloadDir: path.join(__dirname, 'downloads'),
  // 导出时间范围：'yesterday' | '7days' | '30days'
  timeRange: '30days',
  // 请求间隔（毫秒），避免触发风控
  requestDelay: 3000,
  // 超时时间（毫秒）
  timeout: 60000,
};

// 抖音 Cookie 格式
interface DouyinCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * 加载 Cookie
 */
function loadCookies(): DouyinCookie[] {
  if (!fs.existsSync(CONFIG.cookiesFile)) {
    throw new Error(
      `Cookie 文件不存在：${CONFIG.cookiesFile}\n` +
      '请先手动登录抖音创作者中心，导出 Cookie（见 README.md）'
    );
  }
  
  const cookies = JSON.parse(fs.readFileSync(CONFIG.cookiesFile, 'utf-8'));
  console.log(`✅ 加载了 ${cookies.length} 个 Cookie`);
  return cookies;
}

/**
 * 创建浏览器上下文并设置 Cookie
 */
async function createContext(browser: Browser, cookies: DouyinCookie[]): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  
  // 设置 Cookie
  await context.addCookies(cookies.map(c => ({
    ...c,
    expires: c.expires || Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 默认7天过期
  })));
  
  console.log('✅ Cookie 已设置');
  return context;
}

/**
 * 等待随机延迟（避免风控）
 */
async function randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 导出数据
 */
async function exportData(page: Page): Promise<string | null> {
  console.log(' 进入数据中心页面...');
  
  // 访问数据中心
  await page.goto(CONFIG.dataCenterUrl, {
    waitUntil: 'networkidle',
    timeout: CONFIG.timeout,
  });
  
  await randomDelay(2000, 4000);
  
  // 检查是否登录成功（通过页面标题或特定元素判断）
  const pageTitle = await page.title();
  console.log(`页面标题：${pageTitle}`);
  
  if (pageTitle.includes('登录') || pageTitle.includes('login')) {
    console.error(' 登录失败，Cookie 可能已过期');
    return null;
  }
  
  // 选择时间范围
  console.log(`⏱️  选择时间范围：${CONFIG.timeRange}`);
  const timeRangeMap: Record<string, string> = {
    'yesterday': '昨日',
    '7days': '近7天',
    '30days': '近30天',
  };
  
  const timeRangeText = timeRangeMap[CONFIG.timeRange] || '近30天';
  const timeRangeButton = page.locator(`button:has-text("${timeRangeText}")`).first();
  
  if (await timeRangeButton.isVisible()) {
    await timeRangeButton.click();
    await randomDelay(1000, 2000);
    console.log(`✅ 已选择「${timeRangeText}」`);
  } else {
    console.log('⚠️  未找到时间范围按钮，使用默认值');
  }
  
  // 点击「导出数据」按钮
  console.log('📥 点击「导出数据」...');
  const exportButton = page.locator('button:has-text("导出数据")').first();
  
  if (!await exportButton.isVisible()) {
    console.error('❌ 未找到「导出数据」按钮');
    console.log('页面可能未正确加载，或页面结构已变化');
    return null;
  }
  
  // 设置下载监听
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  
  await exportButton.click();
  console.log('⏳ 等待下载...');
  
  try {
    const download = await downloadPromise;
    const fileName = download.suggestedFilename() || `douyin_data_${Date.now()}.csv`;
    const savePath = path.join(CONFIG.downloadDir, fileName);
    
    // 确保下载目录存在
    if (!fs.existsSync(CONFIG.downloadDir)) {
      fs.mkdirSync(CONFIG.downloadDir, { recursive: true });
    }
    
    await download.saveAs(savePath);
    console.log(`✅ 下载完成：${savePath}`);
    
    return savePath;
  } catch (error) {
    console.error('❌ 下载失败：', error);
    return null;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log(' 抖音数据导出脚本启动');
  console.log('='.repeat(50));
  
  // 加载 Cookie
  let cookies: DouyinCookie[];
  try {
    cookies = loadCookies();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  
  // 启动浏览器
  const browser = await chromium.launch({
    headless: true, // 无头模式，生产环境使用
    // headless: false, // 有头模式，调试时使用
  });
  
  try {
    // 创建上下文
    const context = await createContext(browser, cookies);
    const page = await context.newPage();
    
    // 导出数据
    const filePath = await exportData(page);
    
    if (filePath) {
      console.log('='.repeat(50));
      console.log(' 导出成功！');
      console.log(`📁 文件位置：${filePath}`);
      
      // 读取并显示前几行数据
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      console.log(`📊 共 ${lines.length} 行数据`);
      console.log('前3行预览：');
      lines.slice(0, 3).forEach((line, i) => {
        console.log(`  ${i + 1}: ${line.substring(0, 100)}...`);
      });
    } else {
      console.error('❌ 导出失败');
      process.exit(1);
    }
  } finally {
    await browser.close();
    console.log('🔒 浏览器已关闭');
  }
}

// 导出供批量脚本使用
export { DouyinCookie, CONFIG, loadCookies, createContext, randomDelay, exportData };

// 运行
if (require.main === module) {
  main().catch(error => {
    console.error(' 脚本执行出错：', error);
    process.exit(1);
  });
}
