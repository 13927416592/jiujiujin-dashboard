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
    if (result.rawFile) console.log('数据文件:', result.rawFile);
  } else {
    console.error('\n❌ 抓取失败:', result.error);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('未捕获的异常:', err);
  process.exit(1);
});
