/**
 * 支付宝全量数据抓取测试入口
 *
 * 运行：npx tsx src/exporters/test-alipay-full.ts
 *
 * - 首次运行会弹出浏览器，请手动登录，登录后脚本自动检测并继续
 * - 登录成功后 Cookie 会保存到 src/exporters/cookies/alipay.json（约 7 天有效）
 * - 后续运行自动复用 Cookie，无需重复登录
 *
 * 自动化 / 定时任务（无界面）：
 *   HEADLESS=1 npx tsx src/exporters/test-alipay-full.ts
 * - Cookie 有效时全程无弹窗、自动抓取并上传
 * - Cookie 过期时立即失败退出（exit 1），不会挂起等待回车，便于飞书告警
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
  console.log('=== 支付宝经营数据全量抓取 ===');
  console.log(`模式: ${headless ? '无头（自动化）' : '有界面（可手动登录）'}\n`);

  const result = await exportAlipayData({
    headless,
    slowMo: headless ? 0 : 400,
  });

  if (result.success) {
    console.log('\n✅ 抓取成功！');
    console.log('平台:', result.platform);
    console.log('时间:', result.timestamp);
    if (result.rawFile) {
      console.log('数据文件:', result.rawFile);

      // 自动上传到云端看板（未配置上传环境变量时给出提示但不影响抓取成功）
      try {
        const dataDate = todayShanghai();
        const fileName = path.basename(result.rawFile);
        const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
        const uploadDate = match ? match[1] : dataDate;

        console.log('\n☁️  正在上传到云端看板...');
        const upload = await uploadSnapshot({
          platform: 'alipay',
          dataDate: uploadDate,
          rawFile: result.rawFile,
          source: 'local-mac',
        });
        console.log('✅ 已上传到云端看板:', upload.body);
      } catch (uploadErr) {
        const msg =
          uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        console.warn('⚠️  上传到云端失败（本地数据已保存，不影响抓取）:', msg);
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
