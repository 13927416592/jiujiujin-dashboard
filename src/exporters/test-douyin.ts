/**
 * 抖音导出器测试脚本
 * 
 * 测试1: 使用已有的 overview-response.json 验证转换逻辑
 * 测试2: 使用 Playwright 实时导出（需要有效 Cookie）
 */

import { DouyinExporter } from './douyin';
import { parseDouyinOverview, metricsToCSV, cleanData } from './transform';
import * as fs from 'fs';
import * as path from 'path';

async function testTransformExistingData() {
  console.log('=== 测试1: 使用已有数据验证转换逻辑 ===\n');
  
  const overviewFile = path.join(process.cwd(), 'scripts/douyin-export/downloads/overview-response.json');
  
  if (!fs.existsSync(overviewFile)) {
    console.error('  文件不存在:', overviewFile);
    console.log('  请先运行: npx tsx scripts/douyin-export/douyin-export-api.ts');
    return false;
  }
  
  // 读取原始数据
  const rawData = JSON.parse(fs.readFileSync(overviewFile, 'utf-8'));
  console.log('  原始数据键:', Object.keys(rawData.data || {}));
  console.log('  指标数量:', Object.keys(rawData.data || {}).length);
  
  // 解析 overview 数据
  const metrics = parseDouyinOverview(rawData);
  console.log(`\n  转换后指标数量: ${metrics.length}`);
  
  if (metrics.length === 0) {
    console.error('  转换失败: 没有生成任何指标');
    return false;
  }
  
  // 显示汇总数据
  const summary = metrics[0];
  console.log('\n  📊 汇总指标:');
  console.log(`    总粉丝: ${summary.totalFans}`);
  console.log(`    净增粉丝: ${summary.netFansGrowth}`);
  console.log(`    取关粉丝: ${summary.unfollowFans}`);
  console.log(`    播放量: ${summary.playCount}`);
  console.log(`    点赞: ${summary.likeCount}`);
  console.log(`    评论: ${summary.commentCount}`);
  console.log(`    分享: ${summary.shareCount}`);
  console.log(`    主页访问: ${summary.homepageVisits}`);
  console.log(`    新增粉丝: ${(summary.platformSpecific as any)?.newFans || 0}`);
  console.log(`    账号搜索: ${(summary.platformSpecific as any)?.accountSearch || 0}`);
  console.log(`    作品搜索: ${(summary.platformSpecific as any)?.postSearch || 0}`);
  
  // 显示每日明细
  if (metrics.length > 1) {
    console.log(`\n  📅 每日明细: ${metrics.length - 1} 天`);
    for (let i = 1; i < Math.min(metrics.length, 4); i++) {
      const m = metrics[i];
      console.log(`    ${m.date}: 粉丝=${m.totalFans}, 播放=${m.playCount}, 点赞=${m.likeCount}`);
    }
    if (metrics.length > 4) {
      console.log(`    ... 还有 ${metrics.length - 4} 天`);
    }
  }
  
  // 数据清洗
  const cleaned = cleanData(metrics);
  
  // 导出 CSV
  const outputDir = path.join(process.cwd(), 'src/exporters/output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const csvFile = path.join(outputDir, 'douyin_unified_test.csv');
  metricsToCSV(cleaned, csvFile);
  
  // 保存 JSON
  const jsonFile = path.join(outputDir, 'douyin_unified_test.json');
  fs.writeFileSync(jsonFile, JSON.stringify(cleaned, null, 2));
  console.log(`\n  结果已保存: ${csvFile}, ${jsonFile}`);
  
  console.log('\n=== 测试1 通过 ===');
  return true;
}

async function testLiveExport() {
  console.log('\n=== 测试2: Playwright 实时导出 ===\n');
  
  const cookieFile = path.join(process.cwd(), 'src/exporters/cookies/account1.json');
  
  if (!fs.existsSync(cookieFile)) {
    // 尝试从旧路径复制
    const oldCookieFile = path.join(process.cwd(), 'scripts/douyin-export/cookies/account1.json');
    if (fs.existsSync(oldCookieFile)) {
      const dir = path.dirname(cookieFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(oldCookieFile, cookieFile);
      console.log('  已从旧路径复制 Cookie 文件');
    } else {
      console.error('  Cookie 文件不存在，跳过实时导出测试');
      return false;
    }
  }
  
  try {
    const exporter = new DouyinExporter();
    const rawData = await exporter.export();
    
    console.log('\n  导出结果:');
    console.log(`    平台: ${rawData.platform}`);
    console.log(`    时间: ${rawData.timestamp}`);
    console.log(`    数据键: ${Object.keys(rawData.data).join(', ')}`);
    
    // 检查是否有有效数据
    const hasOverview = rawData.data.overview !== null && rawData.data.overview !== undefined;
    console.log(`    overview 数据: ${hasOverview ? '✅ 已捕获' : '❌ 未捕获（Cookie 可能过期）'}`);
    
    if (hasOverview) {
      const metrics = await exporter.convertToUnified(rawData);
      console.log(`    统一指标: ${metrics.length} 条`);
      
      if (metrics.length > 0) {
        const summary = metrics[0];
        console.log(`    总粉丝: ${summary.totalFans}`);
        console.log(`    播放量: ${summary.playCount}`);
      }
    }
    
    console.log('\n=== 测试2 完成 ===');
    return hasOverview;
  } catch (error: any) {
    console.error('  实时导出失败:', error.message);
    return false;
  }
}

async function main() {
  console.log('抖音数据导出器 - 综合测试');
  console.log('=========================================\n');
  
  // 测试1: 使用已有数据验证转换逻辑
  const test1Result = await testTransformExistingData();
  
  // 测试2: 实时导出（可选，需要有效 Cookie）
  const test2Result = await testLiveExport();
  
  console.log('\n=========================================');
  console.log('测试总结:');
  console.log(`  转换逻辑测试: ${test1Result ? '✅ 通过' : '❌ 失败'}`);
  console.log(`  实时导出测试: ${test2Result ? '✅ 通过' : '⚠️ 跳过或失败（Cookie 可能过期）'}`);
}

main().catch(console.error);
