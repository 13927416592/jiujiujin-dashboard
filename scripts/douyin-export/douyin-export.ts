/**
 * 抖音创作者中心数据导出脚本
 * 使用 Playwright 自动登录并导出数据
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Cookie 类型定义
interface DouyinCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None' | 'strict' | 'lax' | 'no_restriction';
}

// 配置
const CONFIG = {
  cookieFile: path.join(__dirname, 'cookies', 'account1.json'),
  downloadDir: path.join(__dirname, 'downloads'),
  baseUrl: 'https://creator.douyin.com',
  dataCenterUrl: 'https://creator.douyin.com/creator-micro/data',
  timeRange: '近 30 天',
  headless: true,
};

/**
 * 加载 Cookie 文件
 */
function loadCookies(): DouyinCookie[] {
  if (!fs.existsSync(CONFIG.cookieFile)) {
    throw new Error(`Cookie 文件不存在：${CONFIG.cookieFile}`);
  }
  
  const content = fs.readFileSync(CONFIG.cookieFile, 'utf-8');
  const cookies: DouyinCookie[] = JSON.parse(content);
  
  console.log(`✅ 加载了 ${cookies.length} 个 Cookie`);
  return cookies;
}

/**
 * 创建浏览器上下文
 */
async function createContext(browser: Browser, cookies: DouyinCookie[]): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  
  // 设置 Cookie（修复 sameSite 格式）
  const validCookies = cookies.map(c => ({
    ...c,
    expires: c.expires || Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    sameSite: c.sameSite === 'no_restriction' ? 'None' : (c.sameSite === 'strict' ? 'Strict' : 'Lax') as 'Strict' | 'Lax' | 'None' | undefined,
  }));
  await context.addCookies(validCookies);
  
  console.log('✅ Cookie 已设置');
  return context;
}

/**
 * 等待随机延迟
 */
async function randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 导出数据
 */
async function exportData(context: BrowserContext): Promise<string | null> {
  const page = await context.newPage();
  
  try {
    console.log(' 访问抖音创作者中心...');
    await page.goto(CONFIG.baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    
    await randomDelay(3000, 5000);
    
    // 截图查看当前状态
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug-01-homepage.png') });
    console.log('📸 已保存首页截图');
    
    // 检查页面标题
    const title = await page.title();
    console.log(`页面标题：${title}`);
    
    // 尝试查找并点击「数据中心」链接
    console.log('🔍 查找数据中心入口...');
    const dataCenterLink = page.locator('a:has-text("数据中心"), div:has-text("数据中心"), span:has-text("数据中心")').first();
    
    if (await dataCenterLink.isVisible().catch(() => false)) {
      console.log('✅ 找到数据中心链接，点击进入...');
      await dataCenterLink.click();
      await randomDelay(3000, 5000);
    } else {
      console.log('⚠️  未找到数据中心链接，尝试直接访问数据中心 URL');
      await page.goto(CONFIG.dataCenterUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await randomDelay(3000, 5000);
    }
    
    // 等待页面完全加载
    console.log(' 等待页面完全加载...');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      console.log('⚠️  网络空闲超时，继续执行');
    });
    await randomDelay(3000, 5000);
    
    // 截图查看数据中心页面
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug-02-datacenter.png') });
    console.log('📸 已保存数据中心截图');
    
    // 打印页面所有按钮和链接
    const buttons = await page.locator('button, a, [role="button"]').allTextContents();
    const uniqueButtons = [...new Set(buttons.filter(t => t.trim()))];
    console.log('页面按钮/链接:', uniqueButtons.slice(0, 30));
    
    // 选择时间范围
    console.log(`📅 选择时间范围：${CONFIG.timeRange}`);
    const timeRangeButton = page.locator(`button:has-text("${CONFIG.timeRange}"), div:has-text("${CONFIG.timeRange}")`);
    if (await timeRangeButton.isVisible().catch(() => false)) {
      await timeRangeButton.click();
      await randomDelay(1000, 2000);
      console.log('✅ 已选择时间范围');
    } else {
      console.log('⚠️  未找到时间范围按钮，使用默认范围');
    }
    
    // 查找「导出数据」按钮
    console.log('📊 查找「导出数据」按钮...');
    const selectors = [
      'button:has-text("导出数据")',
      'button:has-text("导出")',
      'a:has-text("导出数据")',
      'div:has-text("导出数据")',
      'span:has-text("导出数据")',
    ];
    
    let exportButton = null;
    for (const selector of selectors) {
      const element = page.locator(selector);
      if (await element.isVisible().catch(() => false)) {
        console.log(`✅ 找到按钮：${selector}`);
        exportButton = element;
        break;
      }
    }
    
    if (exportButton) {
      await exportButton.click();
      await randomDelay(2000, 3000);
      
      // 等待下载
      console.log('⏳ 等待文件下载...');
      try {
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
        const download = await downloadPromise;
        
        const fileName = `douyin-data-${Date.now()}.csv`;
        const filePath = path.join(CONFIG.downloadDir, fileName);
        await download.saveAs(filePath);
        
        console.log(`✅ 数据已导出：${filePath}`);
        return filePath;
      } catch (e) {
        console.log('⚠️  未检测到下载事件，截图查看当前状态');
        await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug-03-after-export.png') });
        return null;
      }
    } else {
      console.error('❌ 未找到「导出数据」按钮');
      // 打印页面所有文本
      const bodyText = await page.locator('body').textContent();
      console.log('页面文本（前 500 字符）:', bodyText?.substring(0, 500));
      await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug-03-no-export.png') });
      return null;
    }
    
  } catch (error) {
    console.error('❌ 导出失败:', error);
    await page.screenshot({ path: path.join(CONFIG.downloadDir, 'error-export.png') });
    return null;
  } finally {
    await page.close();
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('抖音数据导出脚本启动');
  console.log('='.repeat(50));
  
  // 创建下载目录
  if (!fs.existsSync(CONFIG.downloadDir)) {
    fs.mkdirSync(CONFIG.downloadDir, { recursive: true });
  }
  
  // 加载 Cookie
  const cookies = loadCookies();
  
  // 启动浏览器
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  try {
    const context = await createContext(browser, cookies);
    const result = await exportData(context);
    
    if (result) {
      console.log('\n 导出完成！');
      console.log(`📁 文件位置：${result}`);
    } else {
      console.log('\n⚠️  导出失败，请检查截图');
    }
    
  } catch (error) {
    console.error(' 脚本执行出错:', error);
  } finally {
    await browser.close();
    console.log(' 浏览器已关闭');
  }
}

main().catch(console.error);
