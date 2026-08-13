/**
 * 美团数据导出测试脚本
 * 
 * 运行方式：
 * npx tsx src/exporters/test-meituan.ts
 * 
 * 首次运行会打开浏览器，需要手动登录美团经营宝
 * 登录成功后会自动保存 Cookie，后续运行可自动登录
 */

import { exportMeituanData, DEFAULT_MEITUAN_CONFIG } from './meituan';
import * as path from 'path';

async function main() {
  console.log('========================================');
  console.log('  美团经营宝数据导出测试');
  console.log('========================================\n');

  try {
    // 配置输出目录
    const outputDir = path.join(process.cwd(), 'src/exporters/output');
    
    console.log('配置信息：');
    console.log(`- 输出目录：${outputDir}`);
    console.log(`- Cookie 文件：${DEFAULT_MEITUAN_CONFIG.cookieFile}`);
    console.log(`- 报表 URL：${DEFAULT_MEITUAN_CONFIG.reportUrl}`);
    console.log('');

    // 执行导出
    const result = await exportMeituanData({
      outputDir,
      headless: false  // 首次运行需要看到浏览器
    });

    console.log('\n========================================');
    console.log('  导出完成');
    console.log('========================================');
    console.log(`平台：${result.platform}`);
    console.log(`状态：成功`);
    console.log(`时间：${result.timestamp}`);
    console.log('');

  } catch (error) {
    console.error('\n导出失败：', error);
    process.exit(1);
  }
}

main();
