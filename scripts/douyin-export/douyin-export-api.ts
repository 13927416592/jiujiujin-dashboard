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
    } else if (sameSite === 'no_restriction') {
      validSameSite = 'None';
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
    overviewAll: null,
    overviewDashboard: null,  // 新增
    works: null,
    live: null,
    fans: null,
  };
  
  page.on('response', async (response) => {
    const url = response.url();
    
    // 捕获所有创作者数据相关的 API
    if (url.includes('/aweme/v1/creator/data/') || url.includes('/aweme/janus/creator/data/') || url.includes('overview/dashboard')) {
      try {
        const json = await response.json();
        const apiName = url.split('?')[0].split('/').slice(-4).join('/');
        console.log(` 捕获 API: ${apiName}`);
        
        if (url.includes('/overview/billboard')) {
          apiData.billboard = json;
        } else if (url.includes('/overview/all')) {
          apiData.overviewAll = json;
        } else if (url.includes('overview/dashboard')) {
          apiData.overviewDashboard = json;
        } else if (url.includes('/overview')) {
          apiData.overview = json;
        } else if (url.includes('/works') || url.includes('/video')) {
          apiData.works = json;
        } else if (url.includes('/live')) {
          apiData.live = json;
        } else if (url.includes('/fans')) {
          apiData.fans = json;
        } else if (url.includes('/data/')) {
          // 数据中心其他 API
          const apiName = url.split('/').pop() || 'unknown';
          apiData[`data_${apiName}`] = json;
        }
      } catch (e) {}
    }
  });
  
  // 访问首页，然后点击数据中心菜单
  console.log('\n 访问首页...');
  await page.goto('https://creator.douyin.com/creator-micro/home', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log(' 首页加载完成');
  
  // 1. 访问账号总览
  console.log(' 1. 访问账号总览...');
  await page.goto('https://creator.douyin.com/creator-micro/data-center/operation', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(' 账号总览 URL:', page.url());
  await page.screenshot({ path: path.join(CONFIG.downloadDir, '01-account-overview.png'), fullPage: true });
  
  // 2. 访问作品分析
  console.log(' 2. 访问作品分析...');
  await page.goto('https://creator.douyin.com/creator-micro/data-center/work', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(' 作品分析 URL:', page.url());
  await page.screenshot({ path: path.join(CONFIG.downloadDir, '02-works-analysis.png'), fullPage: true });
  
  // 3. 访问粉丝分析
  console.log(' 3. 访问粉丝分析...');
  await page.goto('https://creator.douyin.com/creator-micro/data-center/fans', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(' 粉丝分析 URL:', page.url());
  await page.screenshot({ path: path.join(CONFIG.downloadDir, '03-fans-analysis.png'), fullPage: true });
  
  // 4. 访问重点关心
  console.log(' 4. 访问重点关心...');
  await page.goto('https://creator.douyin.com/creator-micro/data-center/key', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(' 重点关心 URL:', page.url());
  await page.screenshot({ path: path.join(CONFIG.downloadDir, '04-key-focus.png'), fullPage: true });
  
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
  
  // 导出 overview 数据（overviewAll 或 overview）
  const overviewData = apiData.overviewAll || apiData.overview;
  if (overviewData) {
    console.log('\n 导出 overview 数据...');
    
    // 解析响应结构：{ status_code, data: { account_search, cancel_fans, ... } }
    const data = overviewData.data || overviewData;
    const rows: any[][] = [];
    
    // 解析 overview 数据结构 - 按指标类别遍历
    for (const [category, categoryData] of Object.entries(data)) {
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
    
    if (rows.length > 0) {
      const filePath = saveToCSV('overview_data.csv', ['指标类别', '当前值', '较上期增长'], rows);
      console.log(`✅ 已导出：${filePath}`);
      console.log(`  共 ${rows.length} 个指标`);
    } else {
      console.log('  ️ 数据为空，结构可能不匹配');
    }
    
    // 导出 dashboard 数据（总览卡片）
    if (apiData.overviewDashboard) {
      console.log('\n  导出 dashboard 数据...');
      const dashboardData = apiData.overviewDashboard;
      const dashboardRows: any[][] = [];
      
      // 数据结构是 metrics 数组
      if (Array.isArray(dashboardData.metrics)) {
        for (const metric of dashboardData.metrics) {
          dashboardRows.push([
            metric.metric_name || metric.english_metric_name || '',
            metric.metric_value || '',
            metric.trends?.[0]?.value || metric.trends?.[0]?.douyin_value || '',
            metric.unit || '',
          ]);
        }
      }
      
      if (dashboardRows.length > 0) {
        const filePath = saveToCSV('dashboard_data.csv', ['指标', '当前值', '最新日数据', '单位'], dashboardRows);
        console.log(`  ✅ 已导出：${filePath}`);
        console.log(`  共 ${dashboardRows.length} 个指标`);
      } else {
        console.log('  ⚠️ dashboard 数据为空');
      }
    }
    
    // 导出每日明细数据（option_list）
    console.log('\n  导出每日明细数据...');
    const dailyRows: any[][] = [];
    const dateSet = new Set<string>();
    
    for (const [category, categoryData] of Object.entries(data)) {
      if (typeof categoryData === 'object' && categoryData !== null) {
        const cat = categoryData as any;
        const optionList = cat.option_list || [];
        
        for (const option of optionList) {
          const date = option.date || option.time || '';
          const value = option.value || option.count || '';
          dateSet.add(date);
          dailyRows.push([category, date, value]);
        }
      }
    }
    
    if (dailyRows.length > 0) {
      const filePath = saveToCSV('overview_daily_data.csv', ['指标类别', '日期', '数值'], dailyRows);
      console.log(`✅ 已导出：${filePath}`);
      console.log(`  共 ${dailyRows.length} 条记录，覆盖 ${dateSet.size} 天`);
    } else {
      console.log('  ⚠️ 每日明细数据为空');
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
