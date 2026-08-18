/**
 * 手动补传某天的支付宝数据到云端看板
 *
 * 用法：
 *   npx tsx scripts/upload-alipay.ts              # 补传今天
 *   npx tsx scripts/upload-alipay.ts 2026-08-18   # 补传指定日期
 */

import * as fs from 'fs';
import * as path from 'path';
import { uploadSnapshot } from '../src/exporters/upload-to-cloud';

function todayShanghai(): string {
  const now = new Date();
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shanghai.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const date = process.argv[2] || todayShanghai();
  const file = path.join(
    process.cwd(),
    'src',
    'exporters',
    'output',
    `alipay_full_${date}.json`
  );

  if (!fs.existsSync(file)) {
    console.error('找不到数据文件:', file);
    process.exit(1);
  }

  console.log(`正在上传 ${date} 的支付宝数据...`);
  const result = await uploadSnapshot({
    platform: 'alipay',
    dataDate: date,
    rawFile: file,
    source: 'local-mac-manual',
  });

  console.log('✅ 上传成功:', result.body);
}

main().catch((err: unknown) => {
  console.error('❌ 上传失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
