/**
 * 美团经营数据服务端聚合。
 *
 * 数据来源：platform_snapshots 表中 platform='meituan' 的日快照，
 * 每条 raw_data.rows 是当天全部门店的 1:1 明细（双行表头语义化列名）。
 *
 * 本模块只做"读快照 → 行筛选 → 聚合"，不直接访问数据库；
 * API 路由负责取快照与解析查询参数。这样聚合逻辑可被主看板接口与分页明细接口复用。
 */

// 美团 Excel 语义化列名
export const COL = {
  date: '日期',
  province: '省份',
  city: '城市',
  storeName: '门店名称',
  l1: '1级组织名',
  l2: '2级组织名',
  storeId: '点评门店ID',
  // 流量获客
  exposurePeople: '曝光人数(人)',
  exposureTimes: '曝光次数(次)',
  visitPeople: '访问人数(人)',
  visitTimes: '访问次数(次)',
  favoriteNew: '新增收藏人数(人)',
  favoriteTotal: '累计收藏人数(人)',
  leadsPeople: '留资人数(人)',
  onlineConsult: '在线咨询人数(人)',
  leadsConvertPeople: '意向转化人数(人)',
  stayDuration: '页面有效平均停留时长(秒)',
  // 交易转化
  orderPeople: '下单人数(人)',
  orderCoupons: '下单券数(张)',
  orderAmount: '下单售价金额(元)',
  redeemAmount: '核销售价金额(元)',
  redeemAfterDiscount: '商家优惠后核销额(元)',
  redeemCoupons: '核销券数(张)',
  redeemPeopleTimes: '核销人次(人次)',
  redeemOrders: '核销订单量(单)',
  redeemNewCustomer: '核销新客人数(人)',
  // 营销成本
  adSpend: '推广通消耗金额(元)',
  adExposure: '推广通曝光次数(次)',
  adClicks: '推广通点击次数(次)',
  merchantPublish: '商户通发布额(元)',
  // 服务质量
  avgResponse: '平均响应时长(秒)',
  reply30s: '30秒内回复率',
  reply5min: '5分钟内回复率',
  badReplyRate: '差评回复率',
  consultLeadsRate: '咨询留资转化率',
  // 口碑评价
  reviewNew: '新增评价数(条)',
  reviewGood: '新增好评数(条)',
  reviewMid: '新增中评数(条)',
  reviewBad: '新增差评数(条)',
  reviewTotal: '累计评价数(条)',
  reviewBadTotal: '累计差评数(条)',
  intentConvertRate: '意向转化率',
  exposureVisitRate: '曝光访问转化率',
  onlineLeads: '在线咨询留资数(人)',
} as const;

export type MeituanRow = Record<string, string | number | null | undefined>;

export interface MeituanFilter {
  from?: string; // YYYY-MM-DD
  to?: string;
  province?: string;
  city?: string;
  store?: string; // 门店名称关键字
}

/** 把带逗号、单位(元%张人次单条()（）)的单元格转成数字；空值返回 0 */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(
    String(v)
      .replace(/,/g, '')
      .replace(/[元%张人次单条()（）]/g, '')
      .trim()
  );
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** 百分比单元格（如 "83.33%"）转 0~1 的小数 */
export function toRate(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  const s = String(v).trim();
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1).replace(/,/g, ''));
    return Number.isFinite(n) ? n / 100 : 0;
  }
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

export function rowDate(r: MeituanRow): string {
  return String(r[COL.date] ?? '').slice(0, 10);
}

/** 门店名优先取"门店名称"，回退到 2级/1级组织名 */
export function rowStoreName(r: MeituanRow): string {
  return String(r[COL.storeName] ?? r[COL.l2] ?? r[COL.l1] ?? '').trim();
}

export function isValidDateRow(r: MeituanRow): boolean {
  const d = rowDate(r);
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/** 从快照 raw_data 中取出 rows 数组（兼容包装对象与裸数组） */
export function extractRows(raw: unknown): MeituanRow[] {
  if (Array.isArray(raw)) return raw as MeituanRow[];
  if (raw && typeof raw === 'object') {
    const rows = (raw as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as MeituanRow[];
  }
  return [];
}

/** 判断单行是否满足筛选条件 */
export function matchFilter(r: MeituanRow, f: MeituanFilter): boolean {
  const d = rowDate(r);
  if (f.from && d < f.from) return false;
  if (f.to && d > f.to) return false;
  if (f.province && String(r[COL.province] ?? '') !== f.province) return false;
  if (f.city && String(r[COL.city] ?? '') !== f.city) return false;
  if (f.store && !rowStoreName(r).toLowerCase().includes(f.store.toLowerCase())) return false;
  return true;
}

/** 从一批快照中取出全部有效明细行 */
export function collectAllRows(snapshots: { raw_data: unknown }[]): MeituanRow[] {
  const out: MeituanRow[] = [];
  for (const snap of snapshots) {
    for (const r of extractRows(snap.raw_data)) {
      if (r && isValidDateRow(r)) out.push(r);
    }
  }
  return out;
}

export interface KpiSet {
  exposure: number;
  visits: number;
  orders: number;
  sales: number; // 核销售价金额
  redeemOrders: number;
  reviews: number;
  adSpend: number;
  adClicks: number;
  adExposure: number;
  redeemCoupons: number;
}

const emptyKpi = (): KpiSet => ({
  exposure: 0,
  visits: 0,
  orders: 0,
  sales: 0,
  redeemOrders: 0,
  reviews: 0,
  adSpend: 0,
  adClicks: 0,
  adExposure: 0,
  redeemCoupons: 0,
});

export function sumKpi(rows: MeituanRow[]): KpiSet {
  const k = emptyKpi();
  for (const r of rows) {
    k.exposure += toNumber(r[COL.exposurePeople]);
    k.visits += toNumber(r[COL.visitPeople]);
    k.orders += toNumber(r[COL.orderPeople]);
    k.sales += toNumber(r[COL.redeemAmount]);
    k.redeemOrders += toNumber(r[COL.redeemOrders]);
    k.reviews += toNumber(r[COL.reviewNew]);
    k.adSpend += toNumber(r[COL.adSpend]);
    k.adClicks += toNumber(r[COL.adClicks]);
    k.adExposure += toNumber(r[COL.adExposure]);
    k.redeemCoupons += toNumber(r[COL.redeemCoupons]);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  k.sales = round(k.sales);
  k.adSpend = round(k.adSpend);
  return k;
}

/** 环比：(本期 - 上期) / 上期；上期为 0 返回 null */
export function deltaRate(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 1000;
}

export interface KpiWithDelta {
  value: number;
  prev: number;
  delta: number | null; // 环比百分比，如 0.123 表示 +12.3%
}

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  rate: number | null; // 相对上一级的转化率
}

export interface TrendPoint {
  date: string;
  exposure: number;
  visits: number;
  orders: number;
  sales: number;
  redeemOrders: number;
  reviews: number;
  adSpend: number;
}

export interface RankItem {
  name: string;
  city?: string;
  province?: string;
  sales: number;
  orders: number;
  exposure: number;
  visits: number;
  reviews: number;
}

export interface CitySummary {
  name: string;
  stores: number;
  sales: number;
  orders: number;
  exposure: number;
}

export interface ServiceQuality {
  avgResponse: number; // 秒（按行均值）
  reply30s: number; // 0~1（按行均值）
  reply5min: number;
  badReplyRate: number;
  goodRate: number; // 新增好评 / 新增评价
  newBad: number;
  newReviews: number;
}

export interface RegionHierarchy {
  /** 省份 -> 城市 -> 门店名列表 */
  tree: Record<string, Record<string, string[]>>;
}

export interface MeituanAggregate {
  kpi: {
    sales: KpiWithDelta;
    redeemOrders: KpiWithDelta;
    exposure: KpiWithDelta;
    visits: KpiWithDelta;
    orders: KpiWithDelta;
    reviews: KpiWithDelta;
  };
  funnel: FunnelStage[];
  trend: TrendPoint[];
  roi: {
    adSpend: number;
    sales: number;
    roi: number | null; // sales / adSpend
    cpc: number | null; // adSpend / adClicks
    ctr: number | null; // adClicks / adExposure
  };
  topStores: RankItem[];
  bottomStores: RankItem[];
  cities: CitySummary[];
  service: ServiceQuality;
  meta: {
    rowCount: number;
    storeCount: number;
    dateRange: { from: string; to: string };
    prevRange: { from: string; to: string } | null;
    provinces: string[];
    cities: string[];
    /** 省->市->门店名 三级层级，用于前端级联下拉 */
    regionTree: Record<string, Record<string, string[]>>;
  };
}

/** 把日期往前推 n 天 */
function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function kpiDelta(curr: KpiSet, prev: KpiSet, key: keyof KpiSet): KpiWithDelta {
  return {
    value: curr[key],
    prev: prev[key],
    delta: deltaRate(curr[key], prev[key]),
  };
}

/**
 * 对一组"已按本期筛选"的行做完整聚合。
 * prevRows 为"上一周期"的行（同样已按上期筛选），用于算环比；可为空。
 */
export function aggregate(
  rows: MeituanRow[],
  prevRows: MeituanRow[],
  range: { from: string; to: string },
  prevRange: { from: string; to: string } | null,
  regionTree: Record<string, Record<string, string[]>> = {}
): MeituanAggregate {
  const kpi = sumKpi(rows);
  const prevKpi = sumKpi(prevRows);

  // 漏斗：曝光 -> 访问 -> 下单（同口径逐级收窄）。
  // 核销订单含"历史下单今日核销"，可能大于当日下单人数，不放进漏斗以免出现 >100% 的伪转化率；
  // 核销数据在 KPI 卡与趋势中单独呈现。
  const funnel: FunnelStage[] = [
    { key: 'exposure', label: '曝光人数', value: kpi.exposure, rate: null },
    {
      key: 'visits',
      label: '访问人数',
      value: kpi.visits,
      rate: kpi.exposure ? kpi.visits / kpi.exposure : null,
    },
    {
      key: 'orders',
      label: '下单人数',
      value: kpi.orders,
      rate: kpi.visits ? kpi.orders / kpi.visits : null,
    },
  ];

  // 按日趋势
  const byDate = new Map<string, KpiSet>();
  for (const r of rows) {
    const d = rowDate(r);
    const cur = byDate.get(d) ?? emptyKpi();
    cur.exposure += toNumber(r[COL.exposurePeople]);
    cur.visits += toNumber(r[COL.visitPeople]);
    cur.orders += toNumber(r[COL.orderPeople]);
    cur.sales += toNumber(r[COL.redeemAmount]);
    cur.redeemOrders += toNumber(r[COL.redeemOrders]);
    cur.reviews += toNumber(r[COL.reviewNew]);
    cur.adSpend += toNumber(r[COL.adSpend]);
    byDate.set(d, cur);
  }
  const trend: TrendPoint[] = [...byDate.entries()]
    .map(([date, k]) => ({
      date,
      exposure: k.exposure,
      visits: k.visits,
      orders: k.orders,
      sales: Math.round(k.sales * 100) / 100,
      redeemOrders: k.redeemOrders,
      reviews: k.reviews,
      adSpend: Math.round(k.adSpend * 100) / 100,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ROI
  const roi: MeituanAggregate['roi'] = {
    adSpend: kpi.adSpend,
    sales: kpi.sales,
    roi: kpi.adSpend > 0 ? Math.round((kpi.sales / kpi.adSpend) * 100) / 100 : null,
    cpc: kpi.adClicks > 0 ? Math.round((kpi.adSpend / kpi.adClicks) * 100) / 100 : null,
    ctr: kpi.adExposure > 0 ? kpi.adClicks / kpi.adExposure : null,
  };

  // 门店排行
  const byStore = new Map<string, RankItem>();
  for (const r of rows) {
    const name = rowStoreName(r);
    if (!name) continue;
    const cur =
      byStore.get(name) ??
      ({
        name,
        city: String(r[COL.city] ?? ''),
        province: String(r[COL.province] ?? ''),
        sales: 0,
        orders: 0,
        exposure: 0,
        visits: 0,
        reviews: 0,
      } as RankItem);
    cur.sales += toNumber(r[COL.redeemAmount]);
    cur.orders += toNumber(r[COL.redeemOrders]);
    cur.exposure += toNumber(r[COL.exposurePeople]);
    cur.visits += toNumber(r[COL.visitPeople]);
    cur.reviews += toNumber(r[COL.reviewNew]);
    byStore.set(name, cur);
  }
  const storeList = [...byStore.values()].map((s) => ({
    ...s,
    sales: Math.round(s.sales * 100) / 100,
  }));
  const topStores = [...storeList]
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);
  const bottomStores = [...storeList]
    .sort((a, b) => a.sales - b.sales)
    .slice(0, 10);

  // 城市汇总
  const byCity = new Map<string, CitySummary>();
  const storeSetByCity = new Map<string, Set<string>>();
  for (const r of rows) {
    const city = String(r[COL.city] ?? '').trim();
    if (!city) continue;
    const cur =
      byCity.get(city) ??
      ({ name: city, stores: 0, sales: 0, orders: 0, exposure: 0 } as CitySummary);
    cur.sales += toNumber(r[COL.redeemAmount]);
    cur.orders += toNumber(r[COL.redeemOrders]);
    cur.exposure += toNumber(r[COL.exposurePeople]);
    byCity.set(city, cur);
    const set = storeSetByCity.get(city) ?? new Set<string>();
    const sn = rowStoreName(r);
    if (sn) set.add(sn);
    storeSetByCity.set(city, set);
  }
  const cities = [...byCity.values()]
    .map((c) => ({
      ...c,
      stores: storeSetByCity.get(c.name)?.size ?? 0,
      sales: Math.round(c.sales * 100) / 100,
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 15);

  // 服务质量（按行均值，避免被零值行稀释时也保持简单口径）
  let sumResp = 0;
  let respCnt = 0;
  let sum30 = 0;
  let sum5 = 0;
  let sumBad = 0;
  let rateCnt = 0;
  let goodCnt = 0;
  let newBad = 0;
  let newReviews = 0;
  for (const r of rows) {
    const resp = toNumber(r[COL.avgResponse]);
    if (resp > 0) {
      sumResp += resp;
      respCnt++;
    }
    const r30 = toRate(r[COL.reply30s]);
    const r5 = toRate(r[COL.reply5min]);
    const rb = toRate(r[COL.badReplyRate]);
    if (r30 || r5 || rb) {
      sum30 += r30;
      sum5 += r5;
      sumBad += rb;
      rateCnt++;
    }
    const good = toNumber(r[COL.reviewGood]);
    const bad = toNumber(r[COL.reviewBad]);
    const total = toNumber(r[COL.reviewNew]);
    if (total > 0) {
      goodCnt += good;
      newBad += bad;
      newReviews += total;
    }
  }
  const service: ServiceQuality = {
    avgResponse: respCnt ? Math.round((sumResp / respCnt) * 10) / 10 : 0,
    reply30s: rateCnt ? sum30 / rateCnt : 0,
    reply5min: rateCnt ? sum5 / rateCnt : 0,
    badReplyRate: rateCnt ? sumBad / rateCnt : 0,
    goodRate: newReviews ? goodCnt / newReviews : 0,
    newBad,
    newReviews,
  };

  // 元信息
  const storeSet = new Set<string>();
  const provSet = new Set<string>();
  const citySet = new Set<string>();
  for (const r of rows) {
    const sn = rowStoreName(r);
    if (sn) storeSet.add(sn);
    const p = String(r[COL.province] ?? '').trim();
    if (p) provSet.add(p);
    const c = String(r[COL.city] ?? '').trim();
    if (c) citySet.add(c);
  }

  return {
    kpi: {
      sales: kpiDelta(kpi, prevKpi, 'sales'),
      redeemOrders: kpiDelta(kpi, prevKpi, 'redeemOrders'),
      exposure: kpiDelta(kpi, prevKpi, 'exposure'),
      visits: kpiDelta(kpi, prevKpi, 'visits'),
      orders: kpiDelta(kpi, prevKpi, 'orders'),
      reviews: kpiDelta(kpi, prevKpi, 'reviews'),
    },
    funnel,
    trend,
    roi,
    topStores,
    bottomStores,
    cities,
    service,
    meta: {
      rowCount: rows.length,
      storeCount: storeSet.size,
      dateRange: range,
      prevRange,
      provinces: [...provSet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      cities: [...citySet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      regionTree,
    },
  };
}

/**
 * 构建 省 -> 市 -> 门店名列表 的行政区划层级，用于前端三级联动下拉。
 * 应基于"未按省/市/门店筛选"的全量行调用，保证下拉选项完整。
 */
export function buildRegionTree(rows: MeituanRow[]): Record<string, Record<string, string[]>> {
  const tree: Record<string, Record<string, Set<string>>> = {};
  for (const r of rows) {
    const p = String(r[COL.province] ?? '').trim();
    const c = String(r[COL.city] ?? '').trim();
    const s = rowStoreName(r);
    if (!p || !c || !s) continue;
    if (!tree[p]) tree[p] = {};
    if (!tree[p][c]) tree[p][c] = new Set<string>();
    tree[p][c].add(s);
  }
  // Set -> sorted array
  const result: Record<string, Record<string, string[]>> = {};
  for (const p of Object.keys(tree).sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    result[p] = {};
    for (const c of Object.keys(tree[p]).sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
      result[p][c] = [...tree[p][c]].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }
  }
  return result;
}

/**
 * 根据"本期天数"推导上一周期的日期范围（向前平移同样天数）。
 * 用于环比：近7天 vs 前7天。
 */
export function computePrevRange(from: string, to: string): {
  from: string;
  to: string;
} {
  // 含首尾天数
  const days =
    Math.round(
      (new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) /
        86400000
    ) + 1;
  return { from: shiftDate(from, -days), to: shiftDate(to, -days) };
}
