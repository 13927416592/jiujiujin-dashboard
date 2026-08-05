/**
 * 抖音多账号批量导出脚本
 * 
 * 用于批量导出多个门店账号的数据
 * 
 * 使用方式：
 * 1. 在 cookies/ 目录下放置多个 Cookie 文件（cookies_001.json, cookies_002.json...）
 * 2. 运行：npx tsx scripts/douyin-export/batch-export.ts
 */

import { chromium, Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { exportData, loadCookies, DouyinCookie, CONFIG } from './douyin-export';

// 批量导出配置
const BATCH_CONFIG = {
  // Cookie 文件目录
  cookiesDir: path.join(__dirname, 'cookies'),
  // 账号列表文件（可选，用于记录账号信息）
  accountsFile: path.join(__dirname, 'accounts.json'),
  // 每个账号之间的间隔（毫秒）
  accountDelay: 300000, // 5分钟
  // 失败重试次数
  maxRetries: 2,
};

interface Account {
  id: string;
  name: string;
  platform: string;
  cookieFile: string;
}

/**
 * 获取所有 Cookie 文件
 */
function getCookiesFiles(): string[] {
  if (!fs.existsSync(BATCH_CONFIG.cookiesDir)) {
    throw new Error(`Cookie 目录不存在：${BATCH_CONFIG.cookiesDir}`);
  }
  
  return fs.readdirSync(BATCH_CONFIG.cookiesDir)
    .filter(f => f.endsWith('.json'))
    .sort();
}

/**
 * 加载账号列表
 */
function loadAccounts(): Account[] {
  if (!fs.existsSync(BATCH_CONFIG.accountsFile)) {
    // 如果没有账号列表文件，从 Cookie 文件名生成
    const files = getCookiesFiles();
    return files.map((file, index) => ({
      id: `account_${String(index + 1).padStart(3, '0')}`,
      name: `账号 ${index + 1}`,
      platform: '抖音',
      cookieFile: file,
    }));
  }
  
  return JSON.parse(fs.readFileSync(BATCH_CONFIG.accountsFile, 'utf-8'));
}

/**
 * 批量导出
 */
async function batchExport() {
  console.log(' 抖音多账号批量导出');
  console.log('='.repeat(50));
  
  const accounts = loadAccounts();
  console.log(`📋 共 ${accounts.length} 个账号待导出`);
  
  const browser = await chromium.launch({
    headless: true,
  });
  
  const results: Array<{
    account: Account;
    success: boolean;
    filePath?: string;
    error?: string;
  }> = [];
  
  try {
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      console.log(`\n[${i + 1}/${accounts.length}] 处理账号：${account.name} (${account.id})`);
      
      const cookieFile = path.join(BATCH_CONFIG.cookiesDir, account.cookieFile);
      
      if (!fs.existsSync(cookieFile)) {
        console.error(`  Cookie 文件不存在：${cookieFile}`);
        results.push({ account, success: false, error: 'Cookie 文件不存在' });
        continue;
      }
      
      // 加载 Cookie
      let cookies: DouyinCookie[];
      try {
        cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
      } catch (error) {
        console.error(`  Cookie 解析失败：${error}`);
        results.push({ account, success: false, error: 'Cookie 解析失败' });
        continue;
      }
      
      // 重试逻辑
      let success = false;
      let filePath: string | undefined;
      let lastError: string | undefined;
      
      for (let retry = 0; retry <= BATCH_CONFIG.maxRetries; retry++) {
        if (retry > 0) {
          console.log(`  重试第 ${retry} 次...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        try {
          const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            locale: 'zh-CN',
            timezoneId: 'Asia/Shanghai',
          });
          
          await context.addCookies(cookies.map(c => ({
            ...c,
            expires: c.expires || Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
          })));
          
          const page = await context.newPage();
          filePath = await exportData(page);
          
          await context.close();
          
          if (filePath) {
            success = true;
            break;
          } else {
            lastError = '导出返回空结果';
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          console.error(`  错误：${lastError}`);
        }
      }
      
      results.push({ account, success, filePath, error: lastError });
      
      // 账号间延迟（避免风控）
      if (i < accounts.length - 1) {
        console.log(` 等待 ${BATCH_CONFIG.accountDelay / 1000} 秒...`);
        await new Promise(resolve => setTimeout(resolve, BATCH_CONFIG.accountDelay));
      }
    }
  } finally {
    await browser.close();
  }
  
  // 输出结果汇总
  console.log('\n' + '='.repeat(50));
  console.log(' 批量导出完成');
  console.log('='.repeat(50));
  
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  console.log(`✅ 成功：${successCount} 个`);
  console.log(`❌ 失败：${failCount} 个`);
  
  if (failCount > 0) {
    console.log('\n失败详情：');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.account.name}: ${r.error}`);
    });
  }
  
  // 保存结果报告
  const reportFile = path.join(__dirname, `export_report_${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(results, null, 2));
  console.log(`\n📄 详细报告：${reportFile}`);
}

// 运行
batchExport().catch(error => {
  console.error(' 批量导出出错：', error);
  process.exit(1);
});
