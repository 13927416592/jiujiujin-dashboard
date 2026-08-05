/**
 * 抖音创作者中心数据导出脚本 - 最终版
 * 处理 SPA 路由和动态加载
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
  homeUrl: 'https://creator.douyin.com/creator-micro/home',
  headless: true,
};

async function main() {
  console.log('抖音数据导出脚本 - 最终版');
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
  
  // 监听所有请求和响应
  page.on('request', request => {
    const url = request.url();
    if (url.includes('data') || url.includes('export') || url.includes('download')) {
      console.log(`🌐 请求：${url}`);
    }
  });
  
  page.on('response', response => {
    const url = response.url();
    if (url.includes('data') || url.includes('export') || url.includes('download')) {
      console.log(`📥 响应：${url} (${response.status()})`);
    }
  });
  
  console.log(' 访问首页...');
  await page.goto(CONFIG.homeUrl, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log(' 首页加载完成');
  
  // 截图首页
  await page.screenshot({ path: path.join(CONFIG.downloadDir, '01-home.png'), fullPage: true });
  
  // 直接访问数据概览页面（避免菜单导航跳转到错误页面）
  console.log('\n 访问数据概览页面...');
  await page.goto('https://creator.douyin.com/creator-micro/data/overview', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  
  // 等待数据中心页面加载
  console.log('  等待数据中心页面加载...');
  await new Promise(resolve => setTimeout(resolve, 8000));
  
  const currentUrl = page.url();
  console.log(`  当前 URL: ${currentUrl}`);
  
  // 截图数据中心页面
  await page.screenshot({ path: path.join(CONFIG.downloadDir, '02-datacenter.png'), fullPage: true });
  console.log('  已保存数据中心截图');
  
  // 获取页面所有文本
  const bodyText = await page.locator('body').textContent();
  console.log('\n页面文本（前 800 字符）:');
  console.log(bodyText?.substring(0, 800));
  
  // 获取所有按钮和链接
  const buttons = await page.locator('button, a, [role="button"], [class*="btn"]').allTextContents();
  const uniqueButtons = [...new Set(buttons.filter(t => t.trim()))];
  console.log('\n页面按钮/链接:');
  console.log(uniqueButtons);
  
  // 查找「导出数据」按钮
  console.log('\n🔍 查找「导出数据」按钮...');
  
  // 尝试点击「查看更多」进入完整数据中心
  const moreLink = page.locator('a:has-text("查看更多"), div:has-text("查看更多")').first();
  if (await moreLink.count() > 0) {
    console.log('  找到「查看更多」，点击进入...');
    await moreLink.click();
    await new Promise(resolve => setTimeout(resolve, 5000));
    await page.screenshot({ path: path.join(CONFIG.downloadDir, '03-after-more.png'), fullPage: true });
  }
  
  // 再次查找导出按钮
  const exportBtn = page.locator('button:has-text("导出"), a:has-text("导出"), [class*="export"]').first();
  if (await exportBtn.count() > 0) {
    console.log('  ✅ 找到导出按钮！');
    const text = await exportBtn.textContent();
    console.log(`     文本：${text}`);
    
    await exportBtn.click();
    console.log('  已点击导出按钮');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    await page.screenshot({ path: path.join(CONFIG.downloadDir, '04-after-export.png'), fullPage: true });
  } else {
    console.log('  ❌ 未找到导出按钮');
    console.log('  页面可能没有数据或权限不足');
  }
  
  await browser.close();
  console.log('\n 浏览器已关闭');
}

main().catch(console.error);
