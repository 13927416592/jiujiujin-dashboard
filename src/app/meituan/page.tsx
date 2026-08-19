'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Store,
  Users,
  ShoppingCart,
  DollarSign,
  Star,
  Eye,
  FilterX,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Gauge,
  MessageCircle,
  Trophy,
  TrendingDown as TrendDownIcon,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { KpiCard } from './kpi-card';
import { FunnelChart, TrendChart } from './charts';
import type {
  MeituanAggregate,
  MeituanDataResponse,
  MeituanRowLite,
  MeituanRowsResponse,
} from '@/lib/meituan-agg-types';

const RANGE_PRESETS = [
  { key: '7', label: '近7天' },
  { key: '30', label: '近30天' },
  { key: 'all', label: '全部' },
] as const;

const DEFAULT_PAGE_SIZE = 20;

type RangeKey = (typeof RANGE_PRESETS)[number]['key'];

interface Filters {
  range: RangeKey;
  from: string;
  to: string;
  province: string;
  city: string;
  store: string;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function money(n: number): string {
  if (n >= 10000) return `¥${(n / 10000).toFixed(2)}万`;
  return `¥${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function num(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function MeituanPage() {
  const [agg, setAgg] = useState<MeituanAggregate | null>(null);
  const [latestDate, setLatestDate] = useState('');
  const [loadingAgg, setLoadingAgg] = useState(true);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState<Filters>({
    range: '30',
    from: '',
    to: '',
    province: '',
    city: '',
    store: '',
  });

  // 明细表格状态
  const [rows, setRows] = useState<MeituanRowLite[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loadingRows, setLoadingRows] = useState(false);

  // 初始挂载标志：首次无参请求由接口默认给近30天，返回后再回填日期范围，避免"要日期才请求、要请求才有日期"的死锁
  const initialized = useRef(false);

  const buildQuery = useCallback(
    (extra?: Record<string, string>): string => {
      const params = new URLSearchParams();
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.province) params.set('province', filters.province);
      if (filters.city) params.set('city', filters.city);
      if (filters.store) params.set('store', filters.store);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) params.set(k, v);
      }
      const s = params.toString();
      return s ? `?${s}` : '';
    },
    [filters]
  );

  const loadAgg = useCallback(async () => {
    setLoadingAgg(true);
    setError('');
    try {
      const res = await fetch(`/api/meituan-data${buildQuery()}`);
      const result: MeituanDataResponse = await res.json();
      if (result.success && result.data) {
        setAgg(result.data);
        setLatestDate(result.latest_date ?? '');
      } else {
        setError(result.error || '数据加载失败');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAgg(false);
    }
  }, [buildQuery]);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const qs = buildQuery({ page: String(page), pageSize: String(pageSize), sort: 'date', order: 'desc' });
      const res = await fetch(`/api/meituan-rows${qs}`);
      const result: MeituanRowsResponse = await res.json();
      if (result.success) {
        setRows(result.rows);
        setTotalRows(result.total);
      }
    } catch {
      // 明细加载失败不影响主看板
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, [buildQuery, page, pageSize]);

  // 首次挂载：直接无参请求，接口默认返回近30天；拿到后回填日期范围，避免死锁
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setLoadingAgg(true);
    (async () => {
      try {
        const [aggRes, rowsRes] = await Promise.all([
          fetch('/api/meituan-data').then((r) => r.json() as Promise<MeituanDataResponse>),
          fetch(
            `/api/meituan-rows?page=1&pageSize=${DEFAULT_PAGE_SIZE}&sort=date&order=desc`
          ).then((r) => r.json() as Promise<MeituanRowsResponse>),
        ]);
        if (aggRes.success && aggRes.data) {
          setAgg(aggRes.data);
          const latest = aggRes.latest_date ?? aggRes.data.meta.dateRange.to;
          setLatestDate(latest);
          // 用接口实际采用的范围回填筛选器
          setFilters((f) => ({
            ...f,
            range: '30',
            from: aggRes.data!.meta.dateRange.from,
            to: aggRes.data!.meta.dateRange.to,
          }));
        } else {
          setError(aggRes.error || '数据加载失败');
        }
        if (rowsRes.success) {
          setRows(rowsRes.rows);
          setTotalRows(rowsRes.total);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingAgg(false);
        setLoadingRows(false);
      }
    })();
  }, []);

  // 筛选变化重新加载聚合（首次由挂载 effect 处理，跳过一次避免重复请求）
  useEffect(() => {
    if (!initialized.current || !filters.from || !filters.to) return;
    loadAgg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.province, filters.city, filters.store]);

  // 筛选/分页变化重新加载明细
  useEffect(() => {
    if (!initialized.current || !filters.from || !filters.to) return;
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.province, filters.city, filters.store, page]);

  const applyRange = (range: RangeKey) => {
    if (!latestDate) return;
    if (range === 'all') {
      // 全部：from 取很早以前，to 取最新
      setFilters((f) => ({ ...f, range, from: '2000-01-01', to: latestDate }));
    } else {
      const days = Number(range);
      setFilters((f) => ({ ...f, range, from: shiftDate(latestDate, -(days - 1)), to: latestDate }));
    }
    setPage(1);
  };

  const resetFilters = () => {
    if (!latestDate) return;
    setFilters({
      range: '30',
      from: shiftDate(latestDate, -29),
      to: latestDate,
      province: '',
      city: '',
      store: '',
    });
    setPage(1);
  };

  const totalPages = Math.ceil(totalRows / pageSize);

  // 三级级联：省 -> 市 -> 门店，选项来自全量 regionTree（不受筛选影响）
  const regionTree = agg?.meta.regionTree ?? {};
  const provinceOptions = useMemo(
    () => Object.keys(regionTree).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [regionTree]
  );
  const cityOptions = useMemo(() => {
    if (!filters.province) return [];
    return Object.keys(regionTree[filters.province] ?? {}).sort((a, b) =>
      a.localeCompare(b, 'zh-CN')
    );
  }, [regionTree, filters.province]);
  const storeOptions = useMemo(() => {
    if (!filters.province || !filters.city) return [];
    return regionTree[filters.province]?.[filters.city] ?? [];
  }, [regionTree, filters.province, filters.city]);

  const selectClass =
    'h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-[#7C5CFF] max-w-[180px]';

  const rangeLabel = useMemo(() => {
    if (!agg) return '';
    return `${agg.meta.dateRange.from} ~ ${agg.meta.dateRange.to}`;
  }, [agg]);

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 背景光晕 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 top-0 h-[500px] w-[500px] rounded-full bg-[#7C5CFF]/20 blur-[120px]" />
        <div className="absolute right-0 top-40 h-[400px] w-[400px] rounded-full bg-[#69E7FF]/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-8">
        {/* 标题 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">美团经营数据看板</h1>
          <p className="mt-1 text-sm text-[#9AA7C7]">
            {agg
              ? `${rangeLabel} · ${agg.meta.storeCount} 家门店 · ${num(agg.meta.rowCount)} 条明细`
              : '实时监控美团平台运营数据'}
          </p>
        </div>

        {/* 筛选栏 */}
        <Card className="mb-6 border-white/10 bg-white/[0.05] backdrop-blur-xl">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => applyRange(p.key)}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      filters.range === p.key
                        ? 'bg-[#7C5CFF] text-white'
                        : 'text-[#9AA7C7] hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <Input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((f) => ({ ...f, range: 'all', from: e.target.value }))}
                className="h-9 w-40 border-white/10 bg-white/5 text-sm text-white [color-scheme:dark]"
              />
              <span className="text-[#9AA7C7]">至</span>
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, range: 'all', to: e.target.value }))}
                className="h-9 w-40 border-white/10 bg-white/5 text-sm text-white [color-scheme:dark]"
              />

              <select
                value={filters.province}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, province: e.target.value, city: '', store: '' }));
                  setPage(1);
                }}
                className={selectClass}
              >
                <option value="">全部省份</option>
                {provinceOptions.map((p) => (
                  <option key={p} value={p} className="bg-[#0e1326]">
                    {p}
                  </option>
                ))}
              </select>

              <select
                value={filters.city}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, city: e.target.value, store: '' }));
                  setPage(1);
                }}
                disabled={!filters.province}
                className={`${selectClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <option value="">{filters.province ? '全部城市' : '请先选省份'}</option>
                {cityOptions.map((c) => (
                  <option key={c} value={c} className="bg-[#0e1326]">
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={filters.store}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, store: e.target.value }));
                  setPage(1);
                }}
                disabled={!filters.city}
                className={`${selectClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <option value="">{filters.city ? '全部门店' : '请先选城市'}</option>
                {storeOptions.map((s) => (
                  <option key={s} value={s} className="bg-[#0e1326]">
                    {s}
                  </option>
                ))}
              </select>

              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-9 gap-1.5 text-[#9AA7C7] hover:text-white"
              >
                <FilterX className="h-4 w-4" />
                重置
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300">
            加载失败：{error}
          </div>
        )}

        {loadingAgg && !agg ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#7C5CFF]" />
          </div>
        ) : agg ? (
          <>
            <KpiSection agg={agg} />
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
              <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base text-white">
                    <Gauge className="h-4 w-4 text-[#69E7FF]" />
                    转化漏斗
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <FunnelChart stages={agg.funnel} />
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base text-white">
                    <DollarSign className="h-4 w-4 text-[#7C5CFF]" />
                    核销金额与订单趋势
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TrendChart data={agg.trend} />
                  <div className="mt-2 flex items-center justify-end gap-4 text-xs text-[#9AA7C7]">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#7C5CFF]" />核销金额(元)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#69E7FF]" />核销订单
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <RoiCard agg={agg} />
              <ServiceCard agg={agg} />
              <CityCard agg={agg} />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RankCard title="核销金额 TOP 10 门店" icon={<Trophy className="h-4 w-4 text-amber-400" />} items={agg.topStores} />
              <RankCard title="待提升门店（核销金额后 10）" icon={<TrendDownIcon className="h-4 w-4 text-rose-400" />} items={agg.bottomStores} />
            </div>

            {/* 明细表 */}
            <Card className="mt-6 border-white/10 bg-white/[0.05] backdrop-blur-xl">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-white">
                  <Store className="h-4 w-4 text-[#9AA7C7]" />
                  门店明细
                  <span className="ml-2 text-xs font-normal text-[#9AA7C7]">
                    共 {num(totalRows)} 条
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10 hover:bg-transparent">
                        <TableHead className="text-[#9AA7C7]">日期</TableHead>
                        <TableHead className="text-[#9AA7C7]">门店</TableHead>
                        <TableHead className="text-[#9AA7C7]">城市</TableHead>
                        <TableHead className="text-right text-[#9AA7C7]">曝光</TableHead>
                        <TableHead className="text-right text-[#9AA7C7]">访问</TableHead>
                        <TableHead className="text-right text-[#9AA7C7]">下单</TableHead>
                        <TableHead className="text-right text-[#9AA7C7]">核销金额</TableHead>
                        <TableHead className="text-right text-[#9AA7C7]">核销订单</TableHead>
                        <TableHead className="text-right text-[#9AA7C7]">评价</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingRows ? (
                        <TableRow>
                          <TableCell colSpan={9} className="py-10 text-center text-[#9AA7C7]">
                            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                          </TableCell>
                        </TableRow>
                      ) : rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="py-10 text-center text-[#9AA7C7]">
                            暂无数据
                          </TableCell>
                        </TableRow>
                      ) : (
                        rows.map((r, i) => (
                          <TableRow key={`${r.date}-${r.storeId}-${i}`} className="border-white/5 hover:bg-white/5">
                            <TableCell className="text-sm text-[#9AA7C7]">{r.date}</TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm text-white">{r.store}</TableCell>
                            <TableCell className="text-sm text-[#9AA7C7]">{r.city}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-[#F7FAFF]">{num(r.exposure)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-[#F7FAFF]">{num(r.visits)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-[#F7FAFF]">{num(r.orders)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-[#62FAD3]">{money(r.sales)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-[#F7FAFF]">{num(r.redeemOrders)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-[#F7FAFF]">{num(r.reviews)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* 分页 */}
                <div className="mt-4 flex items-center justify-between text-sm text-[#9AA7C7]">
                  <span>
                    第 {page} / {totalPages || 1} 页
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || loadingRows}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="h-8 border-white/10 bg-white/5 text-[#F7FAFF] hover:bg-white/10"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages || loadingRows}
                      onClick={() => setPage((p) => p + 1)}
                      className="h-8 border-white/10 bg-white/5 text-[#F7FAFF] hover:bg-white/10"
                    >
                      下一页
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}

function KpiSection({ agg }: { agg: MeituanAggregate }) {
  const k = agg.kpi;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard label="核销金额" value={money(k.sales.value)} delta={k.sales.delta} icon={DollarSign} accent="violet" />
      <KpiCard label="核销订单" value={num(k.redeemOrders.value)} delta={k.redeemOrders.delta} icon={ShoppingCart} accent="emerald" />
      <KpiCard label="曝光人数" value={num(k.exposure.value)} delta={k.exposure.delta} icon={Eye} accent="cyan" />
      <KpiCard label="访问人数" value={num(k.visits.value)} delta={k.visits.delta} icon={Users} accent="sky" />
      <KpiCard label="下单人数" value={num(k.orders.value)} delta={k.orders.delta} icon={Store} accent="amber" />
      <KpiCard label="新增评价" value={num(k.reviews.value)} delta={k.reviews.delta} icon={Star} accent="rose" />
    </div>
  );
}

function RoiCard({ agg }: { agg: MeituanAggregate }) {
  const { roi } = agg;
  return (
    <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-white">
          <Megaphone className="h-4 w-4 text-[#7C5CFF]" />
          推广通 ROI
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[#9AA7C7]">推广消耗</p>
            <p className="mt-1 text-xl font-bold text-white tabular-nums">{money(roi.adSpend)}</p>
          </div>
          <div>
            <p className="text-xs text-[#9AA7C7]">带动核销</p>
            <p className="mt-1 text-xl font-bold text-[#62FAD3] tabular-nums">{money(roi.sales)}</p>
          </div>
          <div>
            <p className="text-xs text-[#9AA7C7]">ROI（核销/消耗）</p>
            <p className="mt-1 text-xl font-bold text-white tabular-nums">
              {roi.roi === null ? '—' : `${roi.roi}×`}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#9AA7C7]">单次点击成本</p>
            <p className="mt-1 text-xl font-bold text-white tabular-nums">
              {roi.cpc === null ? '—' : `¥${roi.cpc}`}
            </p>
          </div>
        </div>
        {roi.adSpend === 0 && (
          <p className="mt-3 rounded-lg bg-white/5 p-2 text-xs text-[#9AA7C7]">
            当前筛选范围无推广通消耗数据。若已投放推广通，检查导出报表是否包含该列。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceCard({ agg }: { agg: MeituanAggregate }) {
  const s = agg.service;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-white">
          <MessageCircle className="h-4 w-4 text-[#69E7FF]" />
          服务与口碑
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[#9AA7C7]">平均响应时长</p>
            <p className="mt-1 text-xl font-bold text-white tabular-nums">
              {s.avgResponse ? `${s.avgResponse.toFixed(1)}秒` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#9AA7C7]">30秒内回复率</p>
            <p className="mt-1 text-xl font-bold text-[#62FAD3] tabular-nums">{pct(s.reply30s)}</p>
          </div>
          <div>
            <p className="text-xs text-[#9AA7C7]">5分钟内回复率</p>
            <p className="mt-1 text-xl font-bold text-white tabular-nums">{pct(s.reply5min)}</p>
          </div>
          <div>
            <p className="text-xs text-[#9AA7C7]">好评率</p>
            <p className="mt-1 text-xl font-bold text-[#62FAD3] tabular-nums">{pct(s.goodRate)}</p>
          </div>
          <div>
            <p className="text-xs text-[#9AA7C7]">新增差评</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${s.newBad > 0 ? 'text-rose-400' : 'text-white'}`}>
              {num(s.newBad)} 条
            </p>
          </div>
          <div>
            <p className="text-xs text-[#9AA7C7]">差评回复率</p>
            <p className="mt-1 text-xl font-bold text-white tabular-nums">{pct(s.badReplyRate)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CityCard({ agg }: { agg: MeituanAggregate }) {
  return (
    <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-white">
          <Store className="h-4 w-4 text-[#b8a8ff]" />
          城市 TOP 8（核销金额）
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {agg.cities.slice(0, 8).map((c, i) => {
            const max = agg.cities[0]?.sales || 1;
            return (
              <div key={c.name} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-xs tabular-nums text-[#9AA7C7]">{i + 1}</span>
                <span className="w-16 shrink-0 truncate text-sm text-white">{c.name}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-white/5">
                  <div
                    className="h-full rounded bg-gradient-to-r from-[#7C5CFF] to-[#69E7FF]"
                    style={{ width: `${Math.max(4, (c.sales / max) * 100)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-sm tabular-nums text-[#62FAD3]">
                  {money(c.sales)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RankCard({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: MeituanAggregate['topStores'];
}) {
  return (
    <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-white">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {items.map((s, i) => (
            <div
              key={s.name}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5"
            >
              <span className="w-5 shrink-0 text-xs tabular-nums text-[#9AA7C7]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{s.name}</p>
                <p className="text-xs text-[#9AA7C7]">
                  {s.city || '—'} · 订单 {num(s.orders)} · 曝光 {num(s.exposure)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-[#62FAD3]">
                {money(s.sales)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
