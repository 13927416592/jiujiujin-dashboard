import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(__dirname, 'output', 'meituan-scan');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
const PHONE = '13927416592';

// 美团经营宝菜单配置
const MENUS = [
  { name: '首页', url: 'https://e.dianping.com/' },
  { name: '经营评分', url: 'https://e.dianping.com/#/shopScore' },
  { name: '交易管理', url: 'https://e.dianping.com/#/trade' },
  { name: '客资中心', url: 'https://e.dianping.com/#/customer' },
  { name: '订单中心', url: 'https://e.dianping.com/#/order' },
  { name: '店铺管理', url: 'https://e.dianping.com/#/shop' },
  { name: '推广中心', url: 'https://e.dianping.com/#/promotion' },
  { name: '营销活动', url: 'https://e.dianping.com/#/marketing' },
  { name: '经营参谋-市场洞察', url: 'https://e.dianping.com/#/advisor/market' },
  { name: '经营参谋-本店分析', url: 'https://e.dianping.com/#/advisor/shop' },
  { name: '经营参谋-客流分析', url: 'https://e.dianping.com/#/advisor/traffic' },
  { name: '经营参谋-商品分析', url: 'https://e.dianping.com/#/advisor/product' },
];

interface ScanResult {
  name: string;
  url: string;
  hasExport: boolean;
  exportButtonText: string | null;
  screenshot: string | null;
  error: string | null;
}

async function waitForLogin(page: Page): Promise<void> {
  console.log('\n📱 请在浏览器中完成登录：');
  console.log('   1. 输入收到的验证码');
  console.log('   2. 点击登录按钮');
  console.log('   3. 登录成功后，回到终端按 Enter 继续...\n');
  
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });
}

async function checkExportButton(page: Page): Promise<{ hasExport: boolean; buttonText: string | null }> {
  const selectors = [
    'text=下载明细表格',
    'text=下载明细',
    'text=导出',
    'text=导出数据',
    'text=下载',
    'button:has-text("下载")',
    'button:has-text("导出")',
    'a:has-text("下载")',
    'a:has-text("导出")',
    '[class*="download"]',
    '[class*="export"]',
  ];

  for (const selector of selectors) {
    try {
      const el = await page.locator(selector).first();
      if (await el.isVisible({ timeout: 1000 })) {
        const text = await el.textContent();
        return { hasExport: true, buttonText: text?.trim() || selector };
      }
    } catch {
      continue;
    }
  }

  return { hasExport: false, buttonText: null };
}

async function scan(): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // 打开登录页
    console.log(' 打开美团经营宝登录页...');
    await page.goto('https://e.dianping.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 输入手机号
    const phoneInput = page.locator('input[placeholder*="手机"], input[type="tel"], input[name="phone"]').first();
    if (await phoneInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await phoneInput.fill(PHONE);
      console.log(`📱 已输入手机号: ${PHONE}`);
    }

    // 点击获取验证码
    const codeBtn = page.locator('text=获取验证码, text=发送验证码').first();
    if (await codeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await codeBtn.click();
      console.log('📨 已点击"获取验证码"，请查看手机短信');
    }

    // 等待用户登录
    await waitForLogin(page);

    // 开始扫描
    console.log('\n🔍 开始扫描菜单页面...\n');
    const results: ScanResult[] = [];

    for (const menu of MENUS) {
      console.log(`📄 扫描: ${menu.name}`);
      let result: ScanResult = {
        name: menu.name,
        url: menu.url,
        hasExport: false,
        exportButtonText: null,
        screenshot: null,
        error: null,
      };

      try {
        await page.goto(menu.url, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(3000);

        const { hasExport, buttonText } = await checkExportButton(page);
        result.hasExport = hasExport;
        result.exportButtonText = buttonText;

        // 截图
        const screenshotPath = path.join(SCREENSHOT_DIR, `${menu.name.replace(/[/\s]/g, '_')}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        result.screenshot = screenshotPath;

        const status = hasExport ? `✅ 可导出 (${buttonText})` : '❌ 不可导出';
        console.log(`   ${status}`);
      } catch (err: any) {
        result.error = err.message?.substring(0, 100) || '未知错误';
        console.log(`   ⚠️ 错误: ${result.error}`);
      }

      results.push(result);
    }

    // 生成报告
    const report = generateReport(results);
    const reportPath = path.join(OUTPUT_DIR, 'scan-report.md');
    fs.writeFileSync(reportPath, report);
    console.log(`\n 扫描报告已保存: ${reportPath}`);

    // 打印摘要
    const exportable = results.filter(r => r.hasExport);
    console.log(`\n📊 扫描完成！共 ${results.length} 个页面，${exportable.length} 个可导出`);
    if (exportable.length > 0) {
      console.log('\n✅ 可导出的页面：');
      exportable.forEach(r => console.log(`   - ${r.name}: ${r.exportButtonText}`));
    }

  } finally {
    await browser.close();
  }
}

function generateReport(results: ScanResult[]): string {
  const exportable = results.filter(r => r.hasExport);
  const nonExportable = results.filter(r => !r.hasExport);

  let md = `# 美团经营宝可导出数据清单\n\n`;
  md += `扫描时间: ${new Date().toLocaleString('zh-CN')}\n\n`;
  md += `## 概览\n\n`;
  md += `- 总页面数: ${results.length}\n`;
  md += `- 可导出: ${exportable.length}\n`;
  md += `- 不可导出: ${nonExportable.length}\n\n`;

  if (exportable.length > 0) {
    md += `## ✅ 可导出页面\n\n`;
    md += `| 页面 | 导出按钮 | 截图 |\n`;
    md += `|------|---------|------|\n`;
    exportable.forEach(r => {
      md += `| ${r.name} | ${r.exportButtonText} | [查看](${path.basename(r.screenshot!)}) |\n`;
    });
    md += `\n`;
  }

  if (nonExportable.length > 0) {
    md += `## ❌ 不可导出页面\n\n`;
    md += `| 页面 | 备注 |\n`;
    md += `|------|------|\n`;
    nonExportable.forEach(r => {
      md += `| ${r.name} | 未发现导出按钮 |\n`;
    });
    md += `\n`;
  }

  return md;
}

scan().catch(console.error);
