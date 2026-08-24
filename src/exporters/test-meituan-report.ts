/**
 * 美团经营宝报表每日下载 + 上传入口
 *
 * 运行：npx tsx src/exporters/test-meituan-report.ts
 *
 * - 首次运行会弹出浏览器，请手动扫码/账密登录美团商家后台(e.dianping.com)
 * - 登录成功后登录态会持久化到浏览器用户目录，后续运行自动免登录
 * - 下载昨天的经营报表 xlsx，解析为 JSON，并自动上传到云端看板
 *
 * 自动化 / 定时任务：
 *   脚本由 scripts/meituan-daily.sh 以有头模式调用（无头会被美团风控拦截）。
 *   登录态失效时直接失败退出（exit 1），不会挂起等待，便于飞书告警。
 */

import { MeituanExporter, DEFAULT_MEITUAN_CONFIG } from './meituan';
import { uploadSnapshotItems } from './upload-to-cloud';
import * as fs from 'fs';
import * as path from 'path';

function todayShanghai(): string {
  // 按上海时区取当天日期（YYYY-MM-DD），避免 UTC 偏差
  const now = new Date();
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shanghai.toISOString().slice(0, 10);
}

function yesterdayShanghai(): string {
  const now = new Date();
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return shanghai.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const headless = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
  console.log('=== 美团经营宝报表下载 ===');
  console.log(`模式: ${headless ? '无头（自动化）' : '有界面（可手动登录）'}\n`);

  const outputDir = path.join(process.cwd(), 'src', 'exporters', 'output');

  // 导出天数：默认 1（昨天，每日定时任务用）。
  // 首次补历史数据时设 MEITUAN_EXPORT_DAYS=30，会在日期选择器点"近30天"。
  // 导出器内部 7→"近7天"、30→"近30天"，其余→"昨天"。
  // 历史回填指定某天：设 MEITUAN_TARGET_DATE=YYYY-MM-DD（如 2026-08-21），
  // 会在双月日历里选单日范围（起止同一天），下载/上传数据日期均为该日。
  const daysToDownload = Number(process.env.MEITUAN_EXPORT_DAYS) || 1;
  const targetDate = (process.env.MEITUAN_TARGET_DATE || '').trim() || undefined;
  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    console.error(`❌ MEITUAN_TARGET_DATE 格式错误：${targetDate}，应为 YYYY-MM-DD`);
    process.exit(1);
  }
  const rangeLabel = targetDate
    ? `指定日（${targetDate}）`
    : daysToDownload === 1
    ? '昨天'
    : `近${daysToDownload}天`;
  console.log(`📅 导出时间范围：${rangeLabel}`);

  const exporter = new MeituanExporter({
    headless,
    slowMo: headless ? 0 : 300,
    outputDir,
    cookiePath: DEFAULT_MEITUAN_CONFIG.cookiePath,
    userDataDir: DEFAULT_MEITUAN_CONFIG.userDataDir,
    sessionCookiePath: DEFAULT_MEITUAN_CONFIG.sessionCookiePath,
    reportUrl: DEFAULT_MEITUAN_CONFIG.reportUrl,
    accountName: DEFAULT_MEITUAN_CONFIG.accountName,
    reportCardName: DEFAULT_MEITUAN_CONFIG.reportCardName,
    daysToDownload,
    targetDate,
  });

  const result = await exporter.export();

  if (!result.success) {
    console.error('\n❌ 下载失败:', result.error);
    process.exit(1);
  }

  console.log('\n✅ 下载成功！');
  console.log('平台:', result.platform);
  console.log('时间:', result.timestamp);

  // result.filePath 在新实现里指向解析后的 JSON 路径（已语义化列名、全量保留）
  const rows = ((result.data as unknown[]) || []) as Array<Record<string, unknown>>;
  console.log('数据条数:', rows.length);

  // 写一份 full JSON 留本地备份
  // 定时任务取昨天；指定回填日时用 targetDate；多行（近7/30天）时用导出当天日期作文件名
  const backupDate = targetDate || (daysToDownload === 1 ? yesterdayShanghai() : todayShanghai());
  const fullJsonPath = path.join(outputDir, `meituan_full_${backupDate}.json`);
  const payload = {
    platform: 'meituan',
    exportDate: backupDate,
    exportedAt: result.timestamp,
    accountId: result.accountId,
    rowCount: rows.length,
    rows,
  };
  fs.writeFileSync(fullJsonPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log('数据文件:', fullJsonPath);

  // 自动上传：按行内"日期"拆分，每天一条快照入库（全量列保留，含环比）
  // 单日定时任务只含1天；首次/补数含多天时会拆成多条，避免单条 jsonb 过大
  const byDate = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const d = String(r['日期'] ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const arr = byDate.get(d) ?? [];
    arr.push(r);
    byDate.set(d, arr);
  }

  // 安全闸：指定回填日时，报表内日期必须等于 targetDate，否则说明日历点错了月份，
  // 直接失败，避免把错误日期的数据 upsert 覆盖到别的快照。
  if (targetDate) {
    const dates = [...byDate.keys()];
    const ok = dates.length === 1 && dates[0] === targetDate;
    if (!ok) {
      console.error(
        `\n❌ 日期校验失败：目标回填 ${targetDate}，但报表内日期为 [${dates.join(', ')}]。`
      );
      console.error('   日历可能选错了月份，本次不写入云端，请重跑或检查日期面板。');
      setTimeout(() => process.exit(1), 300);
      return;
    }
    console.log(`🔒 日期校验通过：报表内日期 = ${targetDate}`);
  }

  const items = [...byDate.entries()].map(([date, dateRows]) => ({
    dataDate: date,
    rawData: {
      platform: 'meituan',
      exportDate: date,
      exportedAt: result.timestamp,
      accountId: result.accountId,
      rowCount: dateRows.length,
      rows: dateRows,
    },
  }));
  if (items.length === 0) {
    console.error('\n❌ 数据中未识别到有效日期');
    setTimeout(() => process.exit(1), 300);
    return;
  }

  // 上传带长重试：Supabase 网关曾出现持续数十分钟的 502，
  // 短重试（秒级）扛不住。这里默认每 2 分钟重试一次、最多 30 次（共约 1 小时），
  // 网关一恢复就自动补传成功，避免当天数据静默丢失。可用环境变量调整：
  //   UPLOAD_MAX_ATTEMPTS=5 UPLOAD_RETRY_INTERVAL_MS=60000
  const maxAttempts = Math.max(1, Number(process.env.UPLOAD_MAX_ATTEMPTS) || 30);
  const retryIntervalMs = Math.max(5000, Number(process.env.UPLOAD_RETRY_INTERVAL_MS) || 120000);
  let uploadOk = false;
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`\n☁️  正在上传到云端看板（第 ${attempt}/${maxAttempts} 次）...`);
      const upload = await uploadSnapshotItems('meituan', items);
      console.log('✅ 已上传到云端看板:', upload.body);
      uploadOk = true;
      break;
    } catch (uploadErr) {
      lastErr = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
      console.warn(`⚠️  第 ${attempt} 次上传失败: ${lastErr}`);
      if (attempt < maxAttempts) {
        console.log(`   ${retryIntervalMs / 1000} 秒后重试...（本地数据已保存，不影响下载）`);
        await new Promise((r) => setTimeout(r, retryIntervalMs));
      }
    }
  }

  if (!uploadOk) {
    // 上传最终失败：非 0 退出，让 meituan-daily.sh 触发飞书告警
    console.error(`\n❌ 上传到云端看板失败，已重试 ${maxAttempts} 次: ${lastErr}`);
    console.error('   本地数据已保存，网关恢复后可手动补传：');
    console.error(`   npx tsx src/exporters/re-upload.ts <xlsx路径> meituan`);
    setTimeout(() => process.exit(1), 300);
    return;
  }

  // 显式退出：Playwright/网络/stdin 可能残留句柄导致事件循环不退出
  setTimeout(() => process.exit(0), 300);
}

main().catch((err: unknown) => {
  console.error('未捕获的异常:', err);
  process.exit(1);
});
