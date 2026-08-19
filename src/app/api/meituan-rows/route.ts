import { NextResponse } from 'next/server';
import {
  COL,
  collectAllRows,
  matchFilter,
  rowStoreName,
  toNumber,
  type MeituanFilter,
  type MeituanRow,
} from '@/lib/meituan-agg';
import { getMeituanSnapshots } from '@/lib/meituan-cache';

export const dynamic = 'force-dynamic';

// 允许排序的字段白名单（防止任意列名注入）
const SORTABLE: Record<string, string> = {
  date: COL.date,
  store: COL.storeName,
  city: COL.city,
  province: COL.province,
  exposure: COL.exposurePeople,
  visits: COL.visitPeople,
  orders: COL.orderPeople,
  sales: COL.redeemAmount,
  coupons: COL.redeemCoupons,
  reviews: COL.reviewNew,
  adSpend: COL.adSpend,
};

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * 美团明细分页接口。
 *
 * 查询参数：
 *   from/to/province/city/store  同主聚合接口（store 为门店名关键字）
 *   page        页码，从 1 开始（默认 1）
 *   pageSize    每页条数（默认 20，最大 100）
 *   sort        排序字段，见 SORTABLE（默认 date）
 *   order       asc | desc（默认 desc）
 *
 * 返回当前页行数据 + 总数与分页信息。只取需要展示的列，避免 payload 过大。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const province = searchParams.get('province') || '';
    const city = searchParams.get('city') || '';
    const store = searchParams.get('store') || '';

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE)
    );
    const sortKey = SORTABLE[searchParams.get('sort') || 'date'] ?? COL.date;
    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';

    const snapshots = await getMeituanSnapshots();
    if (snapshots.length === 0) {
      return NextResponse.json({ success: false, error: '暂无美团数据' }, { status: 404 });
    }

    const allRows = collectAllRows(snapshots);
    const filter: MeituanFilter = {
      from: from || undefined,
      to: to || undefined,
      province: province || undefined,
      city: city || undefined,
      store: store || undefined,
    };
    let filtered = allRows.filter((r) => matchFilter(r, filter));

    // 数值列按数字排序，其余（日期/省/市/门店名）按字符串排序
    const NUMERIC_SORT_COLS = new Set<string>([
      COL.exposurePeople,
      COL.visitPeople,
      COL.orderPeople,
      COL.redeemAmount,
      COL.redeemCoupons,
      COL.reviewNew,
      COL.adSpend,
    ]);

    filtered.sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      if (sortKey === COL.storeName) {
        va = rowStoreName(a);
        vb = rowStoreName(b);
      } else if (NUMERIC_SORT_COLS.has(sortKey)) {
        va = toNumber(a[sortKey]);
        vb = toNumber(b[sortKey]);
      } else {
        va = String(a[sortKey] ?? '');
        vb = String(b[sortKey] ?? '');
      }
      if (va < vb) return order === 'asc' ? -1 : 1;
      if (va > vb) return order === 'asc' ? 1 : -1;
      return 0;
    });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize).map((r) => ({
      date: String(r[COL.date] ?? ''),
      province: String(r[COL.province] ?? ''),
      city: String(r[COL.city] ?? ''),
      store: rowStoreName(r),
      storeId: String(r[COL.storeId] ?? ''),
      exposure: toNumber(r[COL.exposurePeople]),
      visits: toNumber(r[COL.visitPeople]),
      orders: toNumber(r[COL.orderPeople]),
      sales: toNumber(r[COL.redeemAmount]),
      coupons: toNumber(r[COL.redeemCoupons]),
      reviews: toNumber(r[COL.reviewNew]),
      adSpend: toNumber(r[COL.adSpend]),
      redeemOrders: toNumber(r[COL.redeemOrders]),
      stayDuration: toNumber(r[COL.stayDuration]),
    }));

    return NextResponse.json({
      success: true,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      rows: pageRows,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[meituan-rows] 读取失败:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
