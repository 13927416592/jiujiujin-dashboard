/**
 * 美团看板使用的列白名单与裁剪逻辑。
 *
 * 美团报表 xlsx 每行带 30+ 个指标列（约 1KB/行），近 30 天约 6 万行原始 JSON 达 64MB，
 * 写入数据库 jsonb 会被上游拒绝。看板实际只用到下列 11 列，裁剪后约 1/6 体积。
 *
 * 与 src/app/api/meituan-data/route.ts 的 COL 映射保持一致。
 */

export const MEITUAN_KEEP_COLUMNS = [
  '日期',
  '省份',
  '城市',
  '点评门店ID',
  '门店名称',
  '客流分析', // 曝光人数(人)
  '客流分析_4', // 访问人数(人)
  '客流分析_10', // 下单人数(人)
  '交易分析', // 核销售价金额(元)
  '交易分析_4', // 核销券数(张)
  '评价分析', // 新增评价数(条)
] as const;

type Row = Record<string, unknown>;

/**
 * 裁剪美团 rows，只保留看板需要的列。
 * 接受包装对象 { rows: [...] } 或裸数组，返回同样结构。
 */
export function pruneMeituanPayload<T extends Row | Row[]>(
  raw: T
): T {
  const keep = new Set<string>(MEITUAN_KEEP_COLUMNS);
  const pruneRow = (row: Row): Row => {
    const out: Row = {};
    for (const k of keep) {
      if (k in row) out[k] = row[k];
    }
    return out;
  };

  if (Array.isArray(raw)) {
    return raw.map(pruneRow) as T;
  }

  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  return {
    ...raw,
    rowCount: rows.length,
    rows: rows.map(pruneRow),
    pruned: true,
  } as T;
}
