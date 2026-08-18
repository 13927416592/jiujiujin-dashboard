/**
 * 仅上传本地已有的导出 JSON（不重新跑浏览器下载）。
 *
 * 用途：数据已下载到本地，但上传失败（如 413）时，单独重传。
 *
 * 用法：
 *   npx tsx src/exporters/re-upload.ts <json文件路径> [platform] [dataDate]
 *
 * 示例：
 *   npx tsx src/exporters/re-upload.ts src/exporters/output/meituan_full_2026-08-17.json meituan 2026-08-17
 *   npx tsx src/exporters/re-upload.ts src/exporters/output/meituan_full_2026-08-17.json
 *     （platform 默认从文件名推断，dataDate 默认昨天-上海时区）
 *
 * 读取 .env 中的 DASHBOARD_UPLOAD_URL / DASHBOARD_INGEST_TOKEN。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { uploadSnapshot } from './upload-to-cloud';
import { pruneMeituanPayload, MEITUAN_KEEP_COLUMNS } from './meituan-columns';

type Platform = 'alipay' | 'meituan' | 'douyin';

function yesterdayShanghai(): string {
  const now = new Date();
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return shanghai.toISOString().slice(0, 10);
}

function inferPlatform(filePath: string): Platform {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('alipay') || name.includes('支付宝')) return 'alipay';
  if (name.includes('douyin') || name.includes('抖音')) return 'douyin';
  return 'meituan';
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('用法: npx tsx src/exporters/re-upload.ts <json文件路径> [platform] [dataDate]');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error(`文件不存在: ${abs}`);
    process.exit(1);
  }

  const platform = (process.argv[3] as Platform) || inferPlatform(abs);
  const dataDate = process.argv[4] || yesterdayShanghai();

  if (!['alipay', 'meituan', 'douyin'].includes(platform)) {
    console.error(`platform 非法: ${platform}（需 alipay/meituan/douyin）`);
    process.exit(1);
  }

  const stat = fs.statSync(abs);
  console.log('=== 仅上传已有导出文件 ===');
  console.log('文件:', abs);
  console.log('平台:', platform);
  console.log('数据日期:', dataDate);
  console.log('文件大小:', (stat.size / 1024 / 1024).toFixed(2), 'MB\n');

  // 美团数据裁剪到看板所需列，避免 30 天全量字段（~64MB）超过数据库写入上限
  let uploadFile = abs;
  let tempFile: string | null = null;
  if (platform === 'meituan') {
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
    const pruned = pruneMeituanPayload(raw);
    const prunedJson = JSON.stringify(pruned);
    const original = JSON.stringify(raw);
    console.log(
      `✂️  列裁剪：原始 ${(original.length / 1024 / 1024).toFixed(2)}MB → 裁剪后 ${(
        prunedJson.length /
        1024 /
        1024
      ).toFixed(2)}MB（只保留看板需要的 ${MEITUAN_KEEP_COLUMNS.length} 列）`
    );
    tempFile = path.join(os.tmpdir(), `meituan-upload-${Date.now()}.json`);
    fs.writeFileSync(tempFile, prunedJson, 'utf-8');
    uploadFile = tempFile;
  }

  try {
    const result = await uploadSnapshot({
      platform,
      dataDate,
      rawFile: uploadFile,
      source: 'local-mac',
    });

    console.log('\n✅ 上传成功:', result.body);
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('❌ 上传失败:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
