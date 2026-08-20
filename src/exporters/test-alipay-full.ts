/**
 * 支付宝全量数据抓取测试入口
 *
 * 运行：npx tsx src/exporters/test-alipay-full.ts
 *
 * - 首次运行会弹出浏览器，请手动登录，登录后脚本自动检测并继续
 * - 登录成功后 Cookie 会保存到 src/exporters/cookies/alipay.json（约 7 天有效）
 * - 后续运行自动复用 Cookie，无需重复登录
 *
 * 日期范围（与美团 MEITUAN_EXPORT_DAYS 对齐）：
 *   - 默认 ALIPAY_EXPORT_DAYS=1：每日定时任务用，点页面"1日"取昨天数据，存每日快照
 *   - 首次回填设 ALIPAY_EXPORT_DAYS=7：点"7日/近7日"取近7日汇总作为基线（用户分析页
 *     只有单日口径，取其默认最近一天）
 *
 * 自动化 / 定时任务（无界面）：
 *   HEADLESS=1 npx tsx src/exporters/test-alipay-full.ts
 * - Cookie 有效时全程无弹窗、自动抓取并上传
 * - Cookie 过期时立即失败退出（exit 1），不会挂起等待回车，便于飞书告警
 * - 上传失败默认长重试（30 次 × 2 分钟，约 1 小时），最终失败 exit 1 触发告警；
 *   可用 UPLOAD_MAX_ATTEMPTS / UPLOAD_RETRY_INTERVAL_MS 调整
 */

import { exportAlipayData } from './alipay';
import { uploadSnapshot } from './upload-to-cloud';
import * as path from 'path';

function todayShanghai(): string {
  // 按上海时区取当天日期（YYYY-MM-DD），避免 UTC 偏差
  const now = new Date();
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shanghai.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const headless = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
  // 导出天数：默认 1（每日明细）。
  // - 每日定时：不设 ALIPAY_TARGET_DATE，取昨天。
  // - 历史回填：设 ALIPAY_TARGET_DATE=YYYY-MM-DD（如 2026-08-18），抓取指定日期。
  //   小程序页通过 URL 参数精确取数；其余页尝试在日历中点选该日。
  const daysToDownload = Number(process.env.ALIPAY_EXPORT_DAYS) === 7 ? 7 : 1;
  const targetDate = (process.env.ALIPAY_TARGET_DATE || '').trim() || undefined;
  const rangeLabel =
    daysToDownload === 7
      ? '近7日（基线）'
      : targetDate
      ? `指定日（${targetDate}）`
      : '1日（昨天）';
  console.log('=== 支付宝经营数据全量抓取 ===');
  console.log(
    `模式: ${headless ? '无头（自动化）' : '有界面（可手动登录）'} | 日期范围: ${rangeLabel}\n`
  );

  const result = await exportAlipayData({
    headless,
    slowMo: headless ? 0 : 400,
    daysToDownload,
    targetDate,
  });

  if (result.success) {
    console.log('\n✅ 抓取成功！');
    console.log('平台:', result.platform);
    console.log('时间:', result.timestamp);
    if (result.rawFile) {
      console.log('数据文件:', result.rawFile);

      // 上传到云端看板：长重试，失败最终非零退出以触发飞书告警。
      // 可用环境变量调整：UPLOAD_MAX_ATTEMPTS（默认30）、UPLOAD_RETRY_INTERVAL_MS（默认120000=2分钟）
      const maxAttempts = Math.max(1, Number(process.env.UPLOAD_MAX_ATTEMPTS) || 30);
      const retryIntervalMs = Math.max(5000, Number(process.env.UPLOAD_RETRY_INTERVAL_MS) || 120000);

      const dataDate = todayShanghai();
      const fileName = path.basename(result.rawFile);
      const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
      const uploadDate = match ? match[1] : dataDate;

      let lastErr: unknown;
      let uploaded = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          console.log(`\n☁️  正在上传到云端看板（第 ${attempt}/${maxAttempts} 次）...`);
          const upload = await uploadSnapshot({
            platform: 'alipay',
            dataDate: uploadDate,
            rawFile: result.rawFile,
            source: 'local-mac',
          });
          console.log('✅ 已上传到云端看板:', upload.body);
          uploaded = true;
          break;
        } catch (uploadErr) {
          lastErr = uploadErr;
          const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          console.warn(`⚠️  第 ${attempt} 次上传失败:`, msg);
          if (attempt < maxAttempts) {
            console.log(`   ${retryIntervalMs / 1000} 秒后重试...（本地数据已保存，不影响下载）`);
            await new Promise((r) => setTimeout(r, retryIntervalMs));
          }
        }
      }

      if (!uploaded) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        console.error(`\n❌ 上传到云端看板失败，已重试 ${maxAttempts} 次: ${msg}`);
        console.error(
          `   本地数据已保留，可手动补传：\n   npx tsx src/exporters/re-upload.ts ${result.rawFile} alipay ${uploadDate}`
        );
        // 非零退出，让 launchd/飞书告警感知到失败（不要静默漏数）
        setTimeout(() => process.exit(1), 300);
        return;
      }
    }
  } else {
    console.error('\n❌ 抓取失败:', result.error);
    process.exit(1);
  }

  // 显式退出：Playwright/网络/stdin 可能残留句柄导致事件循环不退出
  // （尤其 launchd 定时任务，必须保证进程结束）。
  // 延迟 1500ms：给 Chrome 持久化 profile 的 Cookie 磁盘 flush 留出时间，
  // 避免刚保存的登录态还没落盘就被强杀。
  setTimeout(() => process.exit(0), 1500);
}

main().catch((err: unknown) => {
  console.error('未捕获的异常:', err);
  process.exit(1);
});
