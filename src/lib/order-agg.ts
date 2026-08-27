/**
 * 完成订单聚合引擎（纯函数，无 IO，可被 'use client' 组件导入）。
 *
 * 输入：bi_orders 的明细行（一段日期范围）。
 * 输出：KPI、按平台/来源/门店的拆解、每日趋势、漏斗。
 *
 * 重要口径：
 *  - 一单多行：订单数 = count(distinct order_no)；金额/克重 = sum(行级)。
 *  - 客单价 = Σ金额 / Σ唯一订单数（不是行数）。
 *  - "线上"单（is_online=1）与实体门店分开统计。
 *  - 趋势按 data_date（完成日期）聚合。
 */

import type { OrderPlatform, SourceGroup } from '../exporters/bi-order-parser';
import { PLATFORM_LABELS, SOURCE_GROUP_LABELS } from '../exporters/bi-order-parser';

/** 聚合层使用的明细行形状（与 repo.BiOrderRow 兼容，amount 可能是 string）。 */
export interface OrderLineLike {
  order_no: string;
  data_date: string;
  date_basis?: string;
  store_name: string | null;
  store_code: string | null;
  is_online: number | boolean;
  mini_app: string | null;
  platform: OrderPlatform;
  source_name: string | null;
  source_group: SourceGroup;
  amount: number | string;
  gross_weight: number | string | null;
  net_weight: number | string | null;
  created_date: string | null;
}

export interface KpiSummary {
  orderCount: number; // 完成订单数（distinct 订单号）
  lineCount: number; // 明细行数
  amount: number; // 实收金额（元）
  grossWeight: number; // 回收毛重（克）
  netWeight: number; // 回收净重（克）
  avgOrderAmount: number; // 客单价 = 金额 / 订单数
  onlineOrderCount: number; // 线上订单数
  onlineAmount: number; // 线上金额
}

export interface GroupMetric {
  key: string;
  label: string;
  orderCount: number;
  amount: number;
  netWeight: number;
  amountShare: number; // 金额占比 0~1
}

export interface TrendPoint {
  date: string;
  orderCount: number;
  amount: number;
  netWeight: number;
}

export interface OrderAggregate {
  kpi: KpiSummary;
  byPlatform: GroupMetric[];
  bySource: GroupMetric[];
  topStores: GroupMetric[];
  trend: TrendPoint[];
  dates: string[];
  dateBasisNote: string | null; // 数据日期口径说明（月度回填时提示）
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

interface Acc {
  orders: Set<string>;
  lineCount: number;
  amount: number;
  grossWeight: number;
  netWeight: number;
  onlineOrders: Set<string>;
  onlineAmount: number;
}

function newAcc(): Acc {
  return {
    orders: new Set<string>(),
    lineCount: 0,
    amount: 0,
    grossWeight: 0,
    netWeight: 0,
    onlineOrders: new Set<string>(),
    onlineAmount: 0,
  };
}

function fold(acc: Acc, l: OrderLineLike): void {
  const amt = toNum(l.amount);
  const gw = toNum(l.gross_weight);
  const nw = toNum(l.net_weight);
  acc.orders.add(l.order_no);
  acc.lineCount += 1;
  acc.amount += amt;
  acc.grossWeight += gw;
  acc.netWeight += nw;
  if (Number(l.is_online) === 1) {
    acc.onlineOrders.add(l.order_no);
    acc.onlineAmount += amt;
  }
}

function finalize(acc: Acc): KpiSummary {
  const orderCount = acc.orders.size;
  return {
    orderCount,
    lineCount: acc.lineCount,
    amount: acc.amount,
    grossWeight: acc.grossWeight,
    netWeight: acc.netWeight,
    avgOrderAmount: orderCount > 0 ? acc.amount / orderCount : 0,
    onlineOrderCount: acc.onlineOrders.size,
    onlineAmount: acc.onlineAmount,
  };
}

/** 按某个 key 分组聚合成 GroupMetric 列表（按金额降序）。 */
function groupBy(
  lines: OrderLineLike[],
  keyFn: (l: OrderLineLike) => string,
  labelFn: (key: string) => string,
  totalAmount: number,
  limit?: number
): GroupMetric[] {
  const map = new Map<string, Acc>();
  for (const l of lines) {
    const key = keyFn(l);
    let a = map.get(key);
    if (!a) {
      a = newAcc();
      map.set(key, a);
    }
    fold(a, l);
  }
  const out: GroupMetric[] = [];
  for (const [key, acc] of map) {
    out.push({
      key,
      label: labelFn(key),
      orderCount: acc.orders.size,
      amount: acc.amount,
      netWeight: acc.netWeight,
      amountShare: totalAmount > 0 ? acc.amount / totalAmount : 0,
    });
  }
  out.sort((a, b) => b.amount - a.amount);
  return limit ? out.slice(0, limit) : out;
}

function platformLabel(key: string): string {
  return PLATFORM_LABELS[key as OrderPlatform] ?? key;
}

function sourceLabel(key: string): string {
  return SOURCE_GROUP_LABELS[key as SourceGroup] ?? key;
}

/**
 * 聚合订单明细。
 * @param lines 明细行
 * @param topStoreLimit 门店排行返回条数（默认 12）
 */
export function aggregateOrders(
  lines: OrderLineLike[],
  topStoreLimit = 12
): OrderAggregate {
  const overall = newAcc();
  const dateSet = new Set<string>();
  let hasSeed = false;
  let hasCompleted = false;

  // 趋势按日期
  const trendMap = new Map<string, Acc>();
  for (const l of lines) {
    fold(overall, l);
    dateSet.add(l.data_date);
    if (l.date_basis === 'created-seed') hasSeed = true;
    if (l.date_basis === 'completed') hasCompleted = true;

    let da = trendMap.get(l.data_date);
    if (!da) {
      da = newAcc();
      trendMap.set(l.data_date, da);
    }
    fold(da, l);
  }

  const kpi = finalize(overall);

  const byPlatform = groupBy(lines, (l) => l.platform, platformLabel, kpi.amount);
  const bySource = groupBy(lines, (l) => l.source_group, sourceLabel, kpi.amount);

  // 门店排行：按 store_code 归并（没有 code 的按店名）；线上单不进实体门店排行
  const storeLines = lines.filter((l) => Number(l.is_online) !== 1 && (l.store_name || l.store_code));
  const topStores = groupBy(
    storeLines,
    (l) => l.store_code || l.store_name || '未知',
    (key) => {
      const found = storeLines.find(
        (l) => (l.store_code || l.store_name) === key
      );
      return found?.store_name || key;
    },
    kpi.amount,
    topStoreLimit
  );

  const dates = [...dateSet].sort();
  const trend: TrendPoint[] = dates.map((date) => {
    const acc = trendMap.get(date)!;
    return {
      date,
      orderCount: acc.orders.size,
      amount: acc.amount,
      netWeight: acc.netWeight,
    };
  });

  let dateBasisNote: string | null = null;
  if (hasSeed && !hasCompleted) {
    dateBasisNote = '当前为历史月度回填数据，按订单建单日近似归属日期；日度自动同步后将切换为完成日期。';
  } else if (hasSeed && hasCompleted) {
    dateBasisNote = '部分历史数据按建单日近似，日度数据为精确完成日期。';
  }

  return { kpi, byPlatform, bySource, topStores, trend, dates, dateBasisNote };
}

/** 把"近 N 天"的聚合与"上一周期"做环比，返回每个 KPI 的相对变化（0~1+）。 */
export function deltaRatio(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}
