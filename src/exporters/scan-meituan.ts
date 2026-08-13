/**
 * 美团经营宝数据导出清单生成器
 * 
 * 功能：
 * 1. 自动登录美团经营宝（验证码方式）
 * 2. 遍历所有菜单页面
 * 3. 检测每个页面是否有"下载明细表格"按钮
 * 4. 截图记录每个页面
 * 5. 生成可导出数据清单
 * 
 * 使用方式：
 * npx tsx src/exporters/scan-meituan.ts
 */

import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

// 配置
const CONFIG = {
  username: '13927416592',
  baseUrl: 'https://e.dianping.com',
  outputDir: path.join(process.cwd(), 'src/exporters/output/meituan-scan'),
  screenshotDir: path.join(process.cwd(), 'src/exporters/output/meituan-scan/screenshots'),
};

// 菜单配置（根据实际后台调整）
const MENU_ITEMS = [
  { name: '首页', path: '/' },
  { name: '经营评分', path: '/rating' },
  { name: '交易管理', path: '/trade' },
  { name: '客资中心', path: '/customer' },
  { name: '订单中心', path: '/order' },
  { name: '店铺管理', path: '/shop' },
  { name: '推广中心', path: '/promotion' },
  { name: '营销活动', path: '/marketing' },
  { name: '经营参谋', path: '/advisor' },
  { name: '客流分析', path: '/traffic' },
  { name: '商品分析', path: '/product' },
];

interface ScanResult {
  name: string;
  path: string;
  hasExportButton: boolean;
  exportButtonText?: string;
  screenshotPath?: string;
  error?: string;
}

export class MeituanScanner {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private results: ScanResult[] = [];

  async init() {
    // 创建输出目录
    if (!fs.existsSync(CONFIG.outputDir)) {
      fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }
    if (!fs.existsSync(CONFIG.screenshotDir)) {
      fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
    }

    // 启动浏览器
    this.browser = await chromium.launch({
      headless: false,
      args: ['--start-maximized'],
    });

    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });

    this.page = await context.newPage();
  }

  /**
   * 登录流程（验证码方式）
   */
  async login() {
    if (!this.page) throw new Error('Page not initialized');

    console.log('\n 步骤 1: 打开登录页面...');
    await this.page.goto(`${CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // 等待页面加载
    await this.page.waitForTimeout(2000);

    // 检查是否已登录
    const isLoggedIn = await this.page.locator('text=退出').isVisible().catch(() => false);
    if (isLoggedIn) {
      console.log('✅ 已登录状态，跳过登录步骤');
      return;
    }

    console.log('\n📱 步骤 2: 输入手机号...');
    
    // 尝试找到手机号输入框（选择器可能需要根据实际页面调整）
    const phoneInput = await this.page.locator('input[placeholder*="手机"], input[type="tel"], input[name="phone"]').first();
    
    if (await phoneInput.isVisible()) {
      await phoneInput.fill(CONFIG.username);
      console.log(`✅ 已输入手机号：${CONFIG.username}`);
    } else {
      console.log('⚠️  未找到手机号输入框，请手动输入');
      await this.page.waitForTimeout(1000);
    }

    console.log('\n📱 步骤 3: 点击获取验证码...');
    
    // 尝试找到获取验证码按钮
    const codeButton = await this.page.locator('button:has-text("获取验证码"), button:has-text("发送验证码"), text=获取验证码').first();
    
    if (await codeButton.isVisible()) {
      await codeButton.click();
      console.log('✅ 已点击获取验证码按钮');
    } else {
      console.log('️  未找到获取验证码按钮，请手动点击');
    }

    console.log('\n⏸️  请在浏览器中输入验证码并完成登录...');
    console.log('登录完成后，按 Enter 键继续...\n');

    // 等待用户按 Enter
    await this.waitForEnter();

    // 验证登录是否成功
    console.log('\n 验证登录状态...');
    const loginSuccess = await this.page.locator('text=退出, text=我的, text=首页').first().isVisible().catch(() => false);
    
    if (loginSuccess) {
      console.log('✅ 登录成功！');
    } else {
      console.log(' 登录可能未成功，请检查浏览器状态');
      console.log('如果已登录，按 Enter 继续；否则按 Ctrl+C 退出');
      await this.waitForEnter();
    }

    // 保存登录状态
    const storageState = await this.page.context().storageState();
    const statePath = path.join(CONFIG.outputDir, 'auth.json');
    fs.writeFileSync(statePath, JSON.stringify(storageState, null, 2));
    console.log(`✅ 登录状态已保存到：${statePath}`);
  }

  /**
   * 遍历所有菜单页面
   */
  async scanAllPages() {
    if (!this.page) throw new Error('Page not initialized');

    console.log('\n 开始遍历菜单页面...\n');

    for (const menu of MENU_ITEMS) {
      console.log(`\n📄 扫描：${menu.name} (${menu.path})`);
      
      const result = await this.scanPage(menu.name, menu.path);
      this.results.push(result);

      // 打印结果
      if (result.hasExportButton) {
        console.log(`  ✅ 发现导出按钮：${result.exportButtonText}`);
      } else {
        console.log(`  ❌ 未发现导出按钮`);
      }

      if (result.error) {
        console.log(`  ⚠️  错误：${result.error}`);
      }
    }

    // 生成报告
    this.generateReport();
  }

  /**
   * 扫描单个页面
   */
  private async scanPage(name: string, pagePath: string): Promise<ScanResult> {
    if (!this.page) throw new Error('Page not initialized');

    const result: ScanResult = {
      name,
      path: pagePath,
      hasExportButton: false,
    };

    try {
      // 导航到页面
      const url = pagePath.startsWith('http') ? pagePath : `${CONFIG.baseUrl}${pagePath}`;
      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // 等待页面加载
      await this.page.waitForTimeout(2000);

      // 截图
      const screenshotPath = path.join(CONFIG.screenshotDir, `${name.replace(/\//g, '_')}.png`);
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshotPath = screenshotPath;

      // 检测导出按钮（多种可能的文本）
      const exportSelectors = [
        'button:has-text("下载明细表格")',
        'button:has-text("下载明细")',
        'button:has-text("导出")',
        'button:has-text("导出 CSV")',
        'button:has-text("导出 Excel")',
        'a:has-text("下载")',
        'text=下载明细表格',
      ];

      for (const selector of exportSelectors) {
        const element = await this.page.locator(selector).first();
        if (await element.isVisible().catch(() => false)) {
          result.hasExportButton = true;
          result.exportButtonText = selector.match(/has-text\("([^"]+)"\)/)?.[1] || selector;
          break;
        }
      }

      // 如果没有找到按钮，再检查是否有下载图标
      if (!result.hasExportButton) {
        const downloadIcon = await this.page.locator('[class*="download"], [class*="export"], svg[class*="download"]').first();
        if (await downloadIcon.isVisible().catch(() => false)) {
          result.hasExportButton = true;
          result.exportButtonText = '下载图标';
        }
      }

    } catch (error: any) {
      result.error = error.message;
    }

    return result;
  }

  /**
   * 生成扫描报告
   */
  private generateReport() {
    const reportPath = path.join(CONFIG.outputDir, 'scan-report.md');
    
    const exportable = this.results.filter(r => r.hasExportButton);
    const nonExportable = this.results.filter(r => !r.hasExportButton);

    const report = `# 美团经营宝可导出数据清单

扫描时间：${new Date().toLocaleString('zh-CN')}

## ✅ 可导出页面（${exportable.length} 个）

${exportable.map(r => `- [ ] **${r.name}** - 导出按钮：${r.exportButtonText}`).join('\n')}

##  不可导出页面（${nonExportable.length} 个）

${nonExportable.map(r => `- [ ] **${r.name}**${r.error ? ` - 错误：${r.error}` : ''}`).join('\n')}

## 详细结果

| 页面 | 路径 | 可导出 | 导出按钮 | 截图 |
|------|------|--------|----------|------|
${this.results.map(r => `| ${r.name} | ${r.path} | ${r.hasExportButton ? '✅' : '❌'} | ${r.exportButtonText || '-'} | [查看](${r.screenshotPath}) |`).join('\n')}

## 截图目录

所有截图保存在：\`${CONFIG.screenshotDir}\`
`;

    fs.writeFileSync(reportPath, report);
    console.log(`\n 扫描报告已生成：${reportPath}`);
    console.log(`\n 截图目录：${CONFIG.screenshotDir}`);

    // 打印摘要
    console.log('\n' + '='.repeat(60));
    console.log('扫描完成！');
    console.log(`✅ 可导出页面：${exportable.length} 个`);
    console.log(`❌ 不可导出页面：${nonExportable.length} 个`);
    console.log('='.repeat(60));
  }

  /**
   * 等待用户按 Enter
   */
  private async waitForEnter() {
    return new Promise<void>((resolve) => {
      process.stdin.once('data', () => {
        resolve();
      });
    });
  }

  /**
   * 关闭浏览器
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('\n👋 浏览器已关闭');
    }
  }
}

// 主函数
async function main() {
  const scanner = new MeituanScanner();

  try {
    await scanner.init();
    await scanner.login();
    await scanner.scanAllPages();
  } catch (error) {
    console.error('❌ 扫描失败:', error);
  } finally {
    await scanner.close();
  }
}

// 运行
main().catch(console.error);
