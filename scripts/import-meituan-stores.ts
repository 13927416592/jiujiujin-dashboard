/**
 * 导入美团门店台账（经营宝"我的门店"导出）
 *
 * 该 xlsx 的 worksheet dimension 被错误标记为 A1:O2（实际 2377 行），
 * 标准 sheet_to_json 只会读到 2 行。xlsx 库其实已解析全部单元格，
 * 这里扫描所有单元格地址确定真实最大行，重写 !ref 后再转 JSON。
 *
 * 用法：npx tsx scripts/import-meituan-stores.ts <xlsx路径>
 */
import * as path from 'path';
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { getSupabaseClient } from '../src/storage/database/supabase-client';

interface RawRow {
  门店名?: string;
  品牌?: string;
  门店ID?: string | number;
  组织?: string;
  类目?: string;
  城市?: string;
  地址?: string;
  认领状态?: string;
  营业状态?: string;
  营执状态?: string;
  资质类型?: string;
  资质号码?: string;
  资质主体名?: string;
  身份资质?: string;
  三方门店编码?: string;
  [k: string]: unknown;
}

interface StoreRecord {
  store_id: string;
  name: string;
  brand: string | null;
  organization: string | null;
  category: string | null;
  city: string | null;
  address: string | null;
  claim_status: string | null;
  business_status: string | null;
  license_status: string | null;
  qualification_type: string | null;
  qualification_no: string | null;
  qualification_entity: string | null;
  third_party_code: string | null;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * xlsx 库会按 dimension 设置 ws['!ref']，错误的 dimension 会截断数据。
 * 这里扫描所有键（如 A1/C2377）找出真实最大行，重写 !ref。
 */
function fixSheetRange(ws: XLSX.WorkSheet): void {
  let maxRow = 0;
  let maxCol = 0;
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const m = key.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    const row = parseInt(m[2], 10);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  if (maxRow > 0 && maxCol > 0) {
    const colLetter = (n: number): string => {
      let s = '';
      while (n > 0) {
        const rem = (n - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };
    ws['!ref'] = `A1:${colLetter(maxCol)}${maxRow}`;
  }
}

function parseXlsx(filePath: string): StoreRecord[] {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  fixSheetRange(ws);
  const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '' });

  const records: StoreRecord[] = [];
  for (const row of rows) {
    const storeId = str(row['门店ID']);
    const name = str(row['门店名']);
    // 跳过表头重复行和空行
    if (!storeId || !name || storeId === '门店ID' || name === '门店名') continue;

    records.push({
      store_id: storeId,
      name,
      brand: str(row['品牌']),
      organization: str(row['组织']),
      category: str(row['类目']),
      city: str(row['城市']),
      address: str(row['地址']),
      claim_status: str(row['认领状态']),
      business_status: str(row['营业状态']),
      license_status: str(row['营执状态']),
      qualification_type: str(row['资质类型']),
      qualification_no: str(row['资质号码']),
      qualification_entity: str(row['资质主体名']),
      third_party_code: str(row['三方门店编码']),
    });
  }
  return records;
}

async function main() {
  const xlsxPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : '/tmp/my-stores.xlsx';

  console.log(`📖 解析门店台账: ${xlsxPath}`);
  const records = parseXlsx(xlsxPath);
  console.log(`✅ 解析到 ${records.length} 家门店`);

  // 状态统计
  const statusCount: Record<string, number> = {};
  const claimCount: Record<string, number> = {};
  const cities = new Set<string>();
  for (const r of records) {
    const bs = r.business_status ?? '未知';
    statusCount[bs] = (statusCount[bs] ?? 0) + 1;
    const cs = r.claim_status ?? '未知';
    claimCount[cs] = (claimCount[cs] ?? 0) + 1;
    if (r.city) cities.add(r.city);
  }
  console.log('营业状态分布:', statusCount);
  console.log('认领状态分布:', claimCount);
  console.log(`覆盖城市: ${cities.size}`);

  const client = getSupabaseClient();

  // 批量 upsert（每批 200）
  const BATCH = 200;
  let upserted = 0;
  const totalBatches = Math.ceil(records.length / BATCH);
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const { data, error } = await client
      .from('meituan_stores')
      .upsert(batch, { onConflict: 'store_id' })
      .select('store_id');
    if (error) {
      console.error(`❌ 批次 ${Math.floor(i / BATCH) + 1} 写入失败:`, error.message);
      throw error;
    }
    upserted += data?.length ?? 0;
    if (totalBatches > 1) {
      console.log(`  批次 ${Math.floor(i / BATCH) + 1}/${totalBatches}: 累计 ${upserted}`);
    }
  }

  console.log(`\n🎉 导入完成：upsert ${upserted} 家门店到 meituan_stores`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
