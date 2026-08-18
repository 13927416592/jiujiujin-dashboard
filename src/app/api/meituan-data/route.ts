import { NextResponse } from 'next/server';
import { getLatestSnapshot } from '@/storage/database/snapshot-repo';

// 美团 Excel 列名 → 业务含义（与前端展示、docs/meituan-report-config.md 对齐）
const COL = {
  date: '日期',
  province: '省份',
  city: '城市',
  storeId: '点评门店ID',
  storeName: '门店名称',
  exposure: '客流分析', // 曝光人数(人)
  visits: '客流分析_4', // 访问人数(人)
  orders: '客流分析_10', // 下单人数(人)
  redeemAmount: '交易分析', // 核销售价金额(元)
  redeemCoupons: '交易分析_4', // 核销券数(张)
  reviews: '评价分析', // 新增评价数(条)
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').replace(/[元%张人次单条]/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  // 金额类字段统一保留两位小数，避免浮点累加误差（如 249.94000000000003）
  return Math.round(n * 100) / 100;
}

/**
 * 从数据库读取最新美团快照，聚合为看板需要的 summary/trend/stores/raw。
 */
export async function GET() {
  try {
    const snapshot = await getLatestSnapshot('meituan');

    if (!snapshot) {
      return NextResponse.json(
        { success: false, error: '暂无美团数据，请先在本地运行导出并上传' },
        { status: 404 }
      );
    }

    // 上传时包装结构：{ platform, exportDate, rowCount, rows: [...] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = snapshot.raw_data as any;
    const rowsAll: Row[] = Array.isArray(raw?.rows)
      ? raw.rows
      : Array.isArray(raw)
        ? raw
        : [];

    // xlsx 解析会把中文表头也作为第一行数据（各字段值等于列名本身），过滤掉
    const data = rowsAll.filter((r) => r && r[COL.date] && r[COL.date] !== COL.date);

    // 门店列表（去重 + 排序）
    const stores = [...new Set(data.map((r) => r[COL.storeName]).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), 'zh-CN')
    );

    // 汇总
    const sum = (key: string): number =>
      Math.round(data.reduce((s, r) => s + toNumber(r[key]), 0) * 100) / 100;
    const summary = {
      exposure: sum(COL.exposure),
      visits: sum(COL.visits),
      orders: sum(COL.orders),
      sales: sum(COL.redeemAmount),
      coupons: sum(COL.redeemCoupons),
      reviews: sum(COL.reviews),
      storeCount: stores.length,
      recordCount: data.length,
    };

    // 按日期分组趋势
    const byDate = new Map<
      string,
      { exposure: number; visits: number; orders: number; sales: number; coupons: number; reviews: number }
    >();
    for (const r of data) {
      const date = String(r[COL.date] || '').slice(0, 10);
      if (!date) continue;
      const cur = byDate.get(date) ?? {
        exposure: 0,
        visits: 0,
        orders: 0,
        sales: 0,
        coupons: 0,
        reviews: 0,
      };
      cur.exposure += toNumber(r[COL.exposure]);
      cur.visits += toNumber(r[COL.visits]);
      cur.orders += toNumber(r[COL.orders]);
      cur.sales += toNumber(r[COL.redeemAmount]);
      cur.coupons += toNumber(r[COL.redeemCoupons]);
      cur.reviews += toNumber(r[COL.reviews]);
      byDate.set(date, cur);
    }
    const trend = [...byDate.entries()]
      .map(([date, stats]) => ({
        date,
        exposure: Math.round(stats.exposure * 100) / 100,
        visits: Math.round(stats.visits * 100) / 100,
        orders: Math.round(stats.orders * 100) / 100,
        sales: Math.round(stats.sales * 100) / 100,
        coupons: Math.round(stats.coupons * 100) / 100,
        reviews: Math.round(stats.reviews * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 明细按日期降序（最近在前），再取前 500 条，避免 30 天全量（约 6 万行）payload 过大
    const sortedRows = [...data].sort((a, b) =>
      String(b[COL.date] || '').localeCompare(String(a[COL.date] || ''))
    );

    return NextResponse.json({
      success: true,
      data: {
        summary,
        trend,
        stores,
        raw: sortedRows.slice(0, 500),
      },
      data_date: snapshot.data_date,
      fetched_at: snapshot.fetched_at,
      source: snapshot.source,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[meituan-data] 读取失败:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
