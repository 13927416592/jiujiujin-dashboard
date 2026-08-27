'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  Receipt,
  Scale,
  TrendingUp,
  Laptop,
  Store,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '../meituan/kpi-card';
import { OrderTrendChart, GroupBarChart, ShareList } from './charts';
import { deltaRatio, type OrderAggregate } from '@/lib/order-agg';

type RangeKey = '1d' | '7d' | '30d';

interface OrdersFullResponse {
  success: boolean;
  error?: string;
  range: RangeKey;
  latestDate: string | null;
  coverage: { totalDays: number; minDate: string | null; maxDate: string | null };
  data: OrderAggregate | null;
  previous: {
    orderCount: number;
    amount: number;
    netWeight: number;
    avgOrderAmount: number;
  } | null;
}

interface UploadState {
  loading: boolean;
  message: string;
  ok: boolean;
}

function money(n: number): string {
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

function weight(n: number): string {
  return `${n.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}g`;
}

const RANGE_LABEL: Record<RangeKey, string> = { '1d': '近1日', '7d': '近7日', '30d': '近30日' };

export default function OrdersPage() {
  const [range, setRange] = useState<RangeKey>('7d');
  const [resp, setResp] = useState<OrdersFullResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [upload, setUpload] = useState<UploadState>({ loading: false, message: '', ok: false });

  const fetchData = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/orders/full?days=${r}`, { cache: 'no-store' });
      const json = (await res.json()) as OrdersFullResponse;
      setResp(json);
      if (!json.success && json.error) setError(json.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  const onUpload = useCallback(
    async (file: File, date: string) => {
      setUpload({ loading: true, message: `正在上传 ${file.name}...`, ok: false });
      try {
        const fd = new FormData();
        fd.append('file', file);
        if (date) fd.append('date', date);
        const res = await fetch('/api/orders/upload', { method: 'POST', body: fd });
        const json = (await res.json()) as {
          success: boolean;
          error?: string;
          lines?: number;
          uniqueOrders?: number;
          inserted?: number;
          deleted?: number;
        };
        if (!res.ok || !json.success) {
          throw new Error(json.error || '上传失败');
        }
        setUpload({
          loading: false,
          ok: true,
          message: `导入成功：${json.lines} 行 / ${json.uniqueOrders} 单，写入 ${json.inserted} 条${
            json.deleted ? `（替换旧 ${json.deleted} 条）` : ''
          }`,
        });
        fetchData(range);
      } catch (e) {
        setUpload({ loading: false, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    },
    [fetchData, range]
  );

  const kpi = resp?.data?.kpi ?? null;
  const prev = resp?.previous ?? null;

  const deltas = useMemo(() => {
    if (!kpi || !prev) {
      return { orderCount: null, amount: null, netWeight: null, avgOrderAmount: null };
    }
    return {
      orderCount: deltaRatio(kpi.orderCount, prev.orderCount),
      amount: deltaRatio(kpi.amount, prev.amount),
      netWeight: deltaRatio(kpi.netWeight, prev.netWeight),
      avgOrderAmount: deltaRatio(kpi.avgOrderAmount, prev.avgOrderAmount),
    };
  }, [kpi, prev]);

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 背景极光 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 top-0 h-[500px] w-[500px] rounded-full bg-[#7C5CFF]/20 blur-[120px]" />
        <div className="absolute right-0 top-40 h-[400px] w-[400px] rounded-full bg-[#62FAD3]/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-8">
        {/* 标题 */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">客户回收 · 完成订单</h1>
            <p className="mt-1 text-sm text-[#9AA7C7]">
              来自 SmartBI 的门店每日完成订单，打通「流量 → 客资 → 成交」闭环
              {resp?.latestDate && <span className="ml-2 text-[#69E7FF]">· 最新完成日 {resp.latestDate}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white/5 p-1">
            {(['1d', '7d', '30d'] as RangeKey[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-lg px-4 py-1.5 text-sm transition-all ${
                  range === r
                    ? 'bg-[#7C5CFF] text-white shadow-[0_0_16px_rgba(124,92,255,0.5)]'
                    : 'text-[#9AA7C7] hover:text-white'
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        {/* 日期口径提示 */}
        {resp?.data?.dateBasisNote && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>{resp.data.dateBasisNote}</span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="完成订单数"
            value={loading || !kpi ? '—' : kpi.orderCount.toLocaleString()}
            delta={deltas.orderCount}
            icon={Receipt}
            accent="cyan"
            sub="唯一订单编号"
          />
          <KpiCard
            label="实收金额"
            value={loading || !kpi ? '—' : money(kpi.amount)}
            delta={deltas.amount}
            icon={Wallet}
            accent="violet"
            sub="回收付款合计"
          />
          <KpiCard
            label="回收净重"
            value={loading || !kpi ? '—' : weight(kpi.netWeight)}
            delta={deltas.netWeight}
            icon={Scale}
            accent="emerald"
            sub={`毛重 ${kpi ? weight(kpi.grossWeight) : '—'}`}
          />
          <KpiCard
            label="客单价"
            value={loading || !kpi ? '—' : money(kpi.avgOrderAmount)}
            delta={deltas.avgOrderAmount}
            icon={TrendingUp}
            accent="amber"
            sub={
              kpi
                ? `线上 ${kpi.onlineOrderCount.toLocaleString()} 单 / ${money(kpi.onlineAmount)}`
                : undefined
            }
          />
        </div>

        {/* 线上/线下拆分条 */}
        {kpi && (
          <Card className="mt-4 border-white/10 bg-white/[0.05] backdrop-blur-xl">
            <CardContent className="flex flex-wrap items-center gap-6 p-4 text-sm">
              <span className="flex items-center gap-2 text-[#F7FAFF]">
                <Laptop className="h-4 w-4 text-[#69E7FF]" />
                线上成交
                <span className="tabular-nums text-white">
                  {kpi.onlineOrderCount.toLocaleString()} 单 / {money(kpi.onlineAmount)}
                </span>
                <span className="text-[#9AA7C7]">
                  {kpi.orderCount > 0 ? ((kpi.onlineAmount / kpi.amount) * 100).toFixed(1) : 0}%
                </span>
              </span>
              <span className="flex items-center gap-2 text-[#F7FAFF]">
                <Store className="h-4 w-4 text-[#7C5CFF]" />
                门店成交
                <span className="tabular-nums text-white">
                  {(kpi.orderCount - kpi.onlineOrderCount).toLocaleString()} 单 /{' '}
                  {money(kpi.amount - kpi.onlineAmount)}
                </span>
              </span>
              <span className="ml-auto text-xs text-[#9AA7C7]">
                共 {kpi.lineCount.toLocaleString()} 条明细 · {resp?.coverage.totalDays ?? 0} 天数据 ·{' '}
                {resp?.coverage.minDate ?? '-'} ~ {resp?.coverage.maxDate ?? '-'}
              </span>
            </CardContent>
          </Card>
        )}

        {/* 趋势 */}
        <Card className="mt-6 border-white/10 bg-white/[0.05] backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white">每日成交趋势</CardTitle>
          </CardHeader>
          <CardContent>
            {resp?.data?.trend && resp.data.trend.length > 0 ? (
              <OrderTrendChart data={resp.data.trend} />
            ) : (
              <div className="py-16 text-center text-sm text-[#9AA7C7]">
                {loading ? '加载中...' : '暂无趋势数据'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 平台 / 来源 */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">按成交平台（小程序）</CardTitle>
            </CardHeader>
            <CardContent>
              {resp?.data?.byPlatform ? (
                <ShareList data={resp.data.byPlatform} colorBy="platform" />
              ) : (
                <div className="py-10 text-center text-sm text-[#9AA7C7]">暂无数据</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">按获客来源（归因）</CardTitle>
            </CardHeader>
            <CardContent>
              {resp?.data?.bySource ? (
                <ShareList data={resp.data.bySource} />
              ) : (
                <div className="py-10 text-center text-sm text-[#9AA7C7]">暂无数据</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 门店排行 + 来源金额条形 */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">门店成交排行 TOP12</CardTitle>
            </CardHeader>
            <CardContent>
              {resp?.data?.topStores ? (
                <GroupBarChart data={resp.data.topStores} />
              ) : (
                <div className="py-10 text-center text-sm text-[#9AA7C7]">暂无数据</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.05] backdrop-blur-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">获客来源金额对比</CardTitle>
            </CardHeader>
            <CardContent>
              {resp?.data?.bySource ? (
                <GroupBarChart data={resp.data.bySource.slice(0, 10)} />
              ) : (
                <div className="py-10 text-center text-sm text-[#9AA7C7]">暂无数据</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 上传区 */}
        <Card className="mt-6 border-white/10 bg-white/[0.05] backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <UploadCloud className="h-4 w-4 text-[#69E7FF]" /> 导入 BI 报表
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DailyUploader loading={upload.loading} onUpload={onUpload} />
            {upload.message && (
              <div
                className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  upload.ok
                    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
                    : 'border-rose-400/25 bg-rose-400/10 text-rose-100'
                }`}
              >
                {upload.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{upload.message}</span>
              </div>
            )}
            <p className="mt-3 text-xs leading-relaxed text-[#9AA7C7]">
              日度：选择 SmartBI 导出的「门店每日完成订单统计」xlsx，并填写完成日期（YYYY-MM-DD），将整日替换入库（可重复上传）。
              留空日期则按订单号建单日做历史回填。自动每日同步由 Python 导出脚本调用本页上传接口完成。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DailyUploader({
  loading,
  onUpload,
}: {
  loading: boolean;
  onUpload: (file: File, date: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/20 bg-white/5 px-4 py-2 text-sm text-[#9AA7C7] hover:border-[#7C5CFF]/60 hover:text-white">
        <UploadCloud className="h-4 w-4" />
        {file ? file.name : '选择 xlsx 文件'}
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white [color-scheme:dark]"
      />
      <button
        disabled={!file || loading}
        onClick={() => file && onUpload(file, date)}
        className="inline-flex items-center gap-2 rounded-lg bg-[#7C5CFF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6b4df5] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? '导入中...' : '上传并导入'}
      </button>
    </div>
  );
}
