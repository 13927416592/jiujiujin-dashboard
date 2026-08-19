/**
 * 美团看板前后端共享的纯类型定义。
 * 与 src/lib/meituan-agg.ts 的返回结构保持一致，但不引入任何服务端依赖，
 * 可安全被 'use client' 组件导入。
 */

export interface KpiWithDelta {
  value: number;
  prev: number;
  delta: number | null;
}

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  rate: number | null;
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
  status?: string | null;
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
  avgResponse: number;
  reply30s: number;
  reply5min: number;
  badReplyRate: number;
  goodRate: number;
  newBad: number;
  newReviews: number;
}

/** 门店营业状态分布（基于台账中"有数据的门店"统计） */
export interface StoreStatusStat {
  /** 营业状态文案，如 "正常营业" / "永久关闭" / "暂停营业" / "未匹配台账" */
  status: string;
  /** 该状态下有经营数据的门店数 */
  stores: number;
  /** 该状态门店的核销金额 */
  sales: number;
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
    roi: number | null;
    cpc: number | null;
    ctr: number | null;
  };
  topStores: RankItem[];
  bottomStores: RankItem[];
  cities: CitySummary[];
  service: ServiceQuality;
  /** 按门店营业状态的分布统计 */
  storeStatus: StoreStatusStat[];
  meta: {
    rowCount: number;
    storeCount: number;
    dateRange: { from: string; to: string };
    prevRange: { from: string; to: string } | null;
    provinces: string[];
    cities: string[];
    regionTree: Record<string, Record<string, string[]>>;
  };
}

export interface MeituanDataResponse {
  success: boolean;
  data?: MeituanAggregate;
  latest_date?: string;
  available_dates?: string[];
  /** true 表示上游不可用，返回的是旧缓存数据（可能不是最新） */
  stale?: boolean;
  error?: string;
}

export interface MeituanRowLite {
  date: string;
  province: string;
  city: string;
  store: string;
  storeId: string;
  status: string;
  exposure: number;
  visits: number;
  orders: number;
  sales: number;
  coupons: number;
  reviews: number;
  adSpend: number;
  redeemOrders: number;
  stayDuration: number;
}

export interface MeituanRowsResponse {
  success: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rows: MeituanRowLite[];
  error?: string;
}
