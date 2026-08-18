/**
 * 支付宝全量数据抓取测试入口
 *
 * 运行：npx tsx src/exporters/test-alipay-full.ts
 *
 * - 首次运行会弹出浏览器，请手动登录，登录后回到终端按回车
 * - 登录成功后 Cookie 会保存到 src/exporters/cookies/alipay.json（约 7 天有效）
 * - 后续运行自动复用 Cookie，无需重复登录
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
  console.log('=== 支付宝经营数据全量抓取 ===\n');

  const result = await exportAlipayData({
    headless: false, // 显示浏览器，方便首次登录和观察
    slowMo: 400,
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
}

main().catch((err: unknown) => {
  console.error('未捕获的异常:', err);
  process.exit(1);
});
