/**
 * 抖音创作者中心数据导出脚本 - API 版本
 * 直接从 API 接口获取数据，不依赖页面 UI
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const CONFIG = {
  homeUrl: 'https://creator.douyin.com/creator-micro/home',
  downloadDir: path.join(process.cwd(), 'scripts/douyin-export/downloads'),
  cookieFile: path.join(process.cwd(), 'scripts/douyin-export/cookies/account1.json'),
};

// 确保下载目录存在
if (!fs.existsSync(CONFIG.downloadDir)) {
  fs.mkdirSync(CONFIG.downloadDir, { recursive: true });
}

// 读取 Cookie
function loadCookies(): any[] {
  if (!fs.existsSync(CONFIG.cookieFile)) {
    throw new Error(`Cookie 文件不存在：${CONFIG.cookieFile}`);
  }
  const content = fs.readFileSync(CONFIG.cookieFile, 'utf-8');
  return JSON.parse(content);
}

// 保存数据为 CSV
function saveToCSV(filename: string, headers: string[], rows: any[][]): string {
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  const filePath = path.join(CONFIG.downloadDir, filename);
  fs.writeFileSync(filePath, csvContent, 'utf-8');
  return filePath;
}

async function main() {
  console.log('抖音数据导出脚本 - API 版本');
  console.log('==================================================');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai'
  });
  
  // 加载并设置 Cookie
  const cookies = loadCookies();
  console.log(`✅ 加载了 ${cookies.length} 个 Cookie`);
  
  await context.addCookies(cookies.map(c => {
    const sameSite = c.sameSite;
    let validSameSite: 'Strict' | 'Lax' | 'None' | undefined = undefined;
    if (sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None') {
      validSameSite = sameSite;
    } else if (sameSite === 'strict' || sameSite === 'lax' || sameSite === 'none') {
      validSameSite = sameSite.charAt(0).toUpperCase() + sameSite.slice(1) as any;
    }
    
    return {
      name: c.name,
      value: c.value,
      domain: c.domain || '.douyin.com',
      path: c.path || '/',
      secure: c.secure || false,
      httpOnly: c.httpOnly || false,
      sameSite: validSameSite,
    };
  }));
  console.log('✅ Cookie 已设置');
  
  const page = await context.newPage();
  
  // 拦截 API 响应
  const apiData: any = {
    billboard: null,
    overview: null,
  };
  
  page.on('response', async (response) => {
    const url = response.url();
    
    // 捕获所有创作者数据相关的 API
    if (url.includes('/aweme/v1/creator/data/') || url.includes('/aweme/janus/creator/data/')) {
      try {
        const json = await response.json();
        console.log(`📊 捕获 API: ${url.split('?')[0].split('/').slice(-3).join('/')}`);
        
        if (url.includes('/overview/billboard')) {
          apiData.billboard = json;
        } else if (url.includes('/overview')) {
          apiData.overview = json;
        }
      } catch (e) {}
    }
  });
  
  // 访问首页（触发 API 请求）
  console.log('\n 访问首页...');
  await page.goto(CONFIG.homeUrl, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(' 首页加载完成');
  
  // 截图首页
  await page.screenshot({ path: path.join(CONFIG.downloadDir, '01-home.png'), fullPage: true });
  
  // 检查捕获的数据
  console.log('\n📊 数据捕获结果：');
  console.log(`  billboard: ${apiData.billboard ? '✅ 已捕获' : '❌ 未捕获'}`);
  console.log(`  overview: ${apiData.overview ? '✅ 已捕获' : '❌ 未捕获'}`);
  
  // 导出 billboard 数据
  if (apiData.billboard) {
    console.log('\n📝 导出 billboard 数据...');
    console.log('  数据结构:', JSON.stringify(apiData.billboard, null, 2).substring(0, 800));
    
    const data = apiData.billboard;
    const rows: any[][] = [];
    
    // 解析 billboard 数据结构
    if (data.billboard_data && data.billboard_data.element_list) {
      const elements = data.billboard_data.element_list;
      for (const element of elements) {
        const base = element.base_data || {};
        rows.push([
          base.title || '',
          base.author || '',
          (base.tags || []).join(', '),
          base.billboard_id || '',
        ]);
      }
    }
    
    if (rows.length > 0) {
      const filePath = saveToCSV('billboard_data.csv', ['标题', '作者', '标签', 'ID'], rows);
      console.log(`✅ 已导出：${filePath}`);
      console.log(`  共 ${rows.length} 条热搜`);
    } else {
      console.log('  ⚠️ 数据为空，结构可能不匹配');
    }
  }
  
  // 导出 overview 数据
  if (apiData.overview) {
    console.log('\n📝 导出 overview 数据...');
    
    const data = apiData.overview;
    const rows: any[][] = [];
    
    // 解析 overview 数据结构 - 按指标类别遍历
    if (data.data) {
      for (const [category, categoryData] of Object.entries(data.data)) {
        if (typeof categoryData === 'object' && categoryData !== null) {
          const cat = categoryData as any;
          const currentCount = cat.current_count || cat.value || '';
          const lastPeriodIncr = cat.last_period_incr || cat.compare || '';
          
          rows.push([
            category,
            currentCount,
            lastPeriodIncr,
          ]);
        }
      }
    }
    
    if (rows.length > 0) {
      const filePath = saveToCSV('overview_data.csv', ['指标类别', '当前值', '较上期增长'], rows);
      console.log(`✅ 已导出：${filePath}`);
      console.log(`  共 ${rows.length} 个指标`);
    } else {
      console.log('  ⚠️ 数据为空，结构可能不匹配');
    }
  }
  
  // 如果 API 数据为空，尝试从页面提取
  if (!apiData.billboard && !apiData.overview) {
    console.log('\n️  API 数据未捕获，尝试从页面提取...');
    
    // 从首页提取数据中心卡片数据
    const dataCards = await page.locator('[class*="data-card"], [class*="metric"]').allTextContents();
    console.log('  页面数据卡片:', dataCards);
  }
  
  console.log('\n✅ 导出完成！');
  console.log(`📁 文件保存在：${CONFIG.downloadDir}`);
  
  await browser.close();
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
