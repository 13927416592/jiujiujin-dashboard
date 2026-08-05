/**
 * Playwright 安装测试脚本
 * 
 * 用于验证 Playwright 是否正确安装
 * 运行：npx tsx scripts/douyin-export/test.ts
 */

import { chromium } from 'playwright';

async function test() {
  console.log(' 测试 Playwright 安装...');
  
  try {
    const browser = await chromium.launch({ headless: true });
    console.log('✅ 浏览器启动成功');
    
    const page = await browser.newPage();
    console.log('✅ 页面创建成功');
    
    await page.goto('https://creator.douyin.com', { timeout: 10000 });
    const title = await page.title();
    console.log(`✅ 页面访问成功，标题：${title}`);
    
    await browser.close();
    console.log('✅ 浏览器关闭成功');
    
    console.log('\n🎉 Playwright 安装测试通过！');
    console.log('接下来请按照 README.md 的步骤获取 Cookie 并运行导出脚本。');
  } catch (error) {
    console.error('❌ 测试失败：', error);
    console.log('\n请确保已安装 Playwright 浏览器：');
    console.log('  npx playwright install chromium');
  }
}

test();
