import { NextResponse } from 'next/server';
import { getLatestSnapshots } from '@/storage/database/snapshot-repo';

// 美团 Excel 语义化列名 → 业务含义（由 meituan-parser 双行表头生成）
const COL = {
  date: '日期',
  l1: '1级组织名',
  l2: '2级组织名',
  exposure: '曝光人数(人)',
  visits: '访问人数(人)',
  orders: '下单人数(人)',
  redeemAmount: '核销售价金额(元)',
  redeemCoupons: '核销券数(张)',
  reviews: '新增评价数(条)',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').replace(/[元%张人次单条()（）]/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** 从一个快照的 raw_data 中提取 rows 数组（兼容包装对象与裸数组） */
function extractRows(raw: unknown): Row[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as Row).rows)) {
    return (raw as Row).rows as Row[];
  }
  return [];
}

export const dynamic = 'force-dynamic';

/**
 * 读取美团最近 30 个日快照，按行聚合为看板 summary/trend/stores/raw。
 * 数据由本地脚本按日拆分上传（每天一条快照，避免单条 jsonb 过大）。
 */
export async function GET() {
  try {
    const snapshots = await getLatestSnapshots('meituan', 30);

    if (snapshots.length === 0) {
      return NextResponse.json(
        { success: false, error: '暂无美团数据，请先在本地运行导出并上传' },
        { status: 404 }
      );
    }

    // 合并所有快照的行；每行带"日期"列（快照可能含多日，按行内日期聚合）
    const allRows: Row[] = [];
    let latestFetchedAt = '';
    let latestDataDate = '';
    for (const snap of snapshots) {
      for (const r of extractRows(snap.raw_data)) {
        if (r && r[COL.date] && String(r[COL.date]) !== COL.date) allRows.push(r);
      }
      if (snap.fetched_at > latestFetchedAt) {
        latestFetchedAt = snap.fetched_at;
        latestDataDate = snap.data_date;
      }
    }

    if (allRows.length === 0) {
      return NextResponse.json(
        { success: false, error: '美团快照存在但未解析到有效数据行' },
        { status: 404 }
      );
    }

    // 门店列表
    const storeKey = (r: Row): string =>
      String(r['门店名称'] ?? r[COL.l2] ?? r[COL.l1] ?? '').trim();
    const stores = [...new Set(allRows.map(storeKey).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN')
    );

    const sum = (key: string): number =>
      Math.round(allRows.reduce((s, r) => s + toNumber(r[key]), 0) * 100) / 100;
    const summary = {
      exposure: sum(COL.exposure),
      visits: sum(COL.visits),
      orders: sum(COL.orders),
      sales: sum(COL.redeemAmount),
      coupons: sum(COL.redeemCoupons),
      reviews: sum(COL.reviews),
      storeCount: stores.length,
      recordCount: allRows.length,
      dateRange: {
        from: snapshots[0].data_date,
        to: snapshots[snapshots.length - 1].data_date,
      },
    };

    // 按行内日期聚合趋势
    const byDate = new Map<string, Row>();
    for (const r of allRows) {
      const date = String(r[COL.date] || '').slice(0, 10);
      if (!date) continue;
      const cur =
        byDate.get(date) ??
        { exposure: 0, visits: 0, orders: 0, sales: 0, coupons: 0, reviews: 0 };
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

    // 明细按日期降序取最近 500 条（30天约6万行，避免 payload 过大）
    const sortedRows = [...allRows].sort((a, b) =>
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
      data_date: latestDataDate,
      data_dates: snapshots.map((s) => s.data_date),
      fetched_at: latestFetchedAt,
      source: snapshots[0].source,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[meituan-data] 读取失败:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
