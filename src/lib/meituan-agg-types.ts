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
  meta: {
    rowCount: number;
    storeCount: number;
    dateRange: { from: string; to: string };
    prevRange: { from: string; to: string } | null;
    provinces: string[];
    cities: string[];
  };
}

export interface MeituanDataResponse {
  success: boolean;
  data?: MeituanAggregate;
  latest_date?: string;
  available_dates?: string[];
  error?: string;
}

export interface MeituanRowLite {
  date: string;
  province: string;
  city: string;
  store: string;
  storeId: string;
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
