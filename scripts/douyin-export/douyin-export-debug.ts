/**
 * 抖音创作者中心数据导出脚本 - 简化调试版
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

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

const CONFIG = {
  cookieFile: path.join(__dirname, 'cookies', 'account1.json'),
  downloadDir: path.join(__dirname, 'downloads'),
  dataCenterUrl: 'https://creator.douyin.com/creator-micro/data',
  headless: true,
};

async function main() {
  console.log('抖音数据导出脚本 - 调试模式');
  console.log('='.repeat(50));
  
  if (!fs.existsSync(CONFIG.downloadDir)) {
    fs.mkdirSync(CONFIG.downloadDir, { recursive: true });
  }
  
  const cookies: DouyinCookie[] = JSON.parse(fs.readFileSync(CONFIG.cookieFile, 'utf-8'));
  console.log(`✅ 加载了 ${cookies.length} 个 Cookie`);
  
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  
  const validCookies = cookies.map(c => ({
    ...c,
    expires: c.expires || Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    sameSite: c.sameSite === 'no_restriction' ? 'None' : (c.sameSite === 'strict' ? 'Strict' : 'Lax') as 'Strict' | 'Lax' | 'None' | undefined,
  }));
  await context.addCookies(validCookies);
  console.log('✅ Cookie 已设置');
  
  const page = await context.newPage();
  
  // 监听所有请求
  page.on('request', request => {
    if (request.url().includes('data') || request.url().includes('export')) {
      console.log(`🌐 请求：${request.url()}`);
    }
  });
  
  console.log(' 访问数据中心...');
  await page.goto(CONFIG.dataCenterUrl, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const title = await page.title();
  console.log(`页面标题：${title}`);
  
  const url = page.url();
  console.log(`当前 URL: ${url}`);
  
  // 获取页面所有文本
  const bodyText = await page.locator('body').textContent();
  console.log('页面文本（前 1000 字符）:');
  console.log(bodyText?.substring(0, 1000));
  
  // 获取所有按钮
  const buttons = await page.locator('button, a, [role="button"]').allTextContents();
  const uniqueButtons = [...new Set(buttons.filter(t => t.trim()))];
  console.log('\n页面按钮/链接:');
  console.log(uniqueButtons);
  
  // 截图
  await page.screenshot({ path: path.join(CONFIG.downloadDir, 'debug-datacenter.png'), fullPage: true });
  console.log('\n 已保存完整页面截图');
  
  // 尝试查找导出数据按钮的各种可能
  console.log('\n🔍 查找导出数据按钮...');
  const possibleSelectors = [
    'button:has-text("导出")',
    'button:has-text("导出数据")',
    'a:has-text("导出")',
    'div:has-text("导出")',
    'span:has-text("导出")',
    '[class*="export"]',
    '[class*="download"]',
    'button',
  ];
  
  for (const selector of possibleSelectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      const texts = await page.locator(selector).allTextContents();
      console.log(`${selector}: ${count}个 - ${texts.slice(0, 5)}`);
    }
  }
  
  await browser.close();
  console.log('\n 浏览器已关闭');
}

main().catch(console.error);
