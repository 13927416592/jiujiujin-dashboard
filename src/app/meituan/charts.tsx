'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FunnelStage, TrendPoint } from '@/lib/meituan-agg-types';

function pct(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

const FUNNEL_COLORS = ['#7C5CFF', '#69E7FF', '#62FAD3', '#FFB347'];

export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const max = stages[0]?.value || 1;

  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const widthPct = Math.max(4, (s.value / max) * 100);
        return (
          <div key={s.key}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-[#F7FAFF]">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: FUNNEL_COLORS[i] }}
                />
                {s.label}
              </span>
              <span className="tabular-nums text-[#9AA7C7]">
                {s.value.toLocaleString()}
                {i > 0 && (
                  <span className="ml-2 text-xs text-[#69E7FF]">转化 {pct(s.rate)}</span>
                )}
              </span>
            </div>
            <div className="h-7 w-full overflow-hidden rounded-lg bg-white/5">
              <div
                className="h-full rounded-lg transition-all duration-700"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${FUNNEL_COLORS[i]}cc, ${FUNNEL_COLORS[i]}55)`,
                  boxShadow: `0 0 16px ${FUNNEL_COLORS[i]}55`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface TrendChartProps {
  data: TrendPoint[];
}

export function TrendChart({ data }: TrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="g-sales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C5CFF" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#7C5CFF" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="g-orders" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#69E7FF" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#69E7FF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
        <XAxis
          dataKey="date"
          stroke="#9AA7C7"
          tick={{ fill: '#9AA7C7', fontSize: 11 }}
          tickFormatter={(v: string) => v.slice(5)}
          minTickGap={24}
        />
        <YAxis
          stroke="#9AA7C7"
          tick={{ fill: '#9AA7C7', fontSize: 11 }}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: 'rgba(10,14,28,0.92)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12,
            color: '#F7FAFF',
            backdropFilter: 'blur(8px)',
          }}
          labelStyle={{ color: '#9AA7C7' }}
          formatter={(value: number, name: string) => [
            typeof value === 'number' ? value.toLocaleString() : value,
            name === 'sales' ? '核销金额(元)' : '核销订单',
          ]}
        />
        <Area
          type="monotone"
          dataKey="sales"
          stroke="#7C5CFF"
          strokeWidth={2}
          fill="url(#g-sales)"
        />
        <Area
          type="monotone"
          dataKey="redeemOrders"
          stroke="#69E7FF"
          strokeWidth={2}
          fill="url(#g-orders)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
