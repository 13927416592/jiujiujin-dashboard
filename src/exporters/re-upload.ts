/**
 * 上传本地已有的美团/支付宝数据（不重新跑浏览器下载）。
 *
 * 美团用法（推荐传 xlsx，会按双行表头语义化解析并按日期拆分入库）：
 *   npx tsx src/exporters/re-upload.ts <xlsx或json路径> meituan [选项]
 *
 * 选项：
 *   --drop-huanbi   剔除所有"环比"列（首次导入近30天历史数据时建议加，每日全量不加）
 *
 * 示例：
 *   # 首次30天历史（去环比）
 *   npx tsx src/exporters/re-upload.ts src/exporters/output/meituan_report_2026-07-19.xlsx meituan --drop-huanbi
 *   # 每日补传（全量含环比）
 *   npx tsx src/exporters/re-upload.ts src/exporters/output/meituan_report_2026-08-17.xlsx meituan
 *
 * 支付宝（兼容旧逻辑，单文件单快照）：
 *   npx tsx src/exporters/re-upload.ts <json路径> alipay [dataDate]
 */

import * as fs from 'fs';
import * as path from 'path';
import { uploadSnapshot, uploadSnapshotItems } from './upload-to-cloud';
import { parseMeituanWorkbook, isHuanbiColumn, type MeituanRow } from './meituan-parser';

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

/** 把多行按"日期"列分组，并在分组时剔除环比列（如指定） */
function groupRowsByDate(
  rows: MeituanRow[],
  dropHuanbi: boolean
): Map<string, MeituanRow[]> {
  const byDate = new Map<string, MeituanRow[]>();
  for (const row of rows) {
    const date = String(row['日期'] ?? '').slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let out = row;
    if (dropHuanbi) {
      out = {};
      for (const [k, v] of Object.entries(row)) {
        if (!isHuanbiColumn(k)) out[k] = v;
      }
    }
    const arr = byDate.get(date) ?? [];
    arr.push(out);
    byDate.set(date, arr);
  }
  return byDate;
}

async function uploadMeituan(
  absPath: string,
  ext: string,
  dropHuanbi: boolean
): Promise<void> {
  let rows: MeituanRow[];
  if (ext === '.xlsx') {
    console.log(`📖 解析 Excel（双行表头语义化）...`);
    rows = parseMeituanWorkbook(absPath, { dropHuanbi });
  } else {
    const raw = JSON.parse(fs.readFileSync(absPath, 'utf-8')) as Record<string, unknown>;
    const rawRows = Array.isArray(raw) ? raw : Array.isArray(raw.rows) ? raw.rows : [];
    rows = rawRows as MeituanRow[];
    if (dropHuanbi) {
      rows = rows.map((r) => {
        const out: MeituanRow = {};
        for (const [k, v] of Object.entries(r)) if (!isHuanbiColumn(k)) out[k] = v;
        return out;
      });
    }
  }

  console.log(`📊 解析到 ${rows.length} 行`);
  const byDate = groupRowsByDate(rows, false); // 已在解析/上方处理过环比
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) {
    throw new Error('未从数据中识别到任何有效日期（需要"日期"列，格式 YYYY-MM-DD）');
  }
  console.log(`📅 覆盖 ${dates.length} 天：${dates[0]} ~ ${dates[dates.length - 1]}`);

  // 按日构造快照并批量上传
  const exportedAt = new Date().toISOString();
  const items = dates.map((date) => ({
    dataDate: date,
    rawData: {
      platform: 'meituan',
      exportDate: date,
      exportedAt,
      accountId: 'jiujiujin',
      rowCount: byDate.get(date)!.length,
      dropHuanbi,
      rows: byDate.get(date)!,
    },
  }));

  const result = await uploadSnapshotItems('meituan', items);
  console.log('\n✅ 上传成功:', result.body);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filePath = args[0];
  if (!filePath) {
    console.error('用法: npx tsx src/exporters/re-upload.ts <xlsx或json路径> [platform] [--drop-huanbi]');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error(`文件不存在: ${abs}`);
    process.exit(1);
  }

  const platform = (args.find((a) => ['alipay', 'meituan', 'douyin'].includes(a)) as Platform) || inferPlatform(abs);
  const dropHuanbi = args.includes('--drop-huanbi');
  const ext = path.extname(abs).toLowerCase();

  const stat = fs.statSync(abs);
  console.log('=== 上传已有导出数据 ===');
  console.log('文件:', abs);
  console.log('平台:', platform, '| 去环比:', dropHuanbi ? '是' : '否');
  console.log('文件大小:', (stat.size / 1024 / 1024).toFixed(2), 'MB\n');

  if (platform === 'meituan') {
    if (ext !== '.xlsx' && ext !== '.json') {
      console.error('美团请传 .xlsx 或 .json 文件');
      process.exit(1);
    }
    await uploadMeituan(abs, ext, dropHuanbi);
  } else {
    // 支付宝等：保持单文件单快照逻辑
    const dataDate = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || yesterdayShanghai();
    const result = await uploadSnapshot({ platform, dataDate, rawFile: abs, source: 'local-mac' });
    console.log('\n✅ 上传成功:', result.body);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('❌ 上传失败:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
