'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GroupMetric, TrendPoint } from '@/lib/order-agg';

const PLATFORM_COLORS: Record<string, string> = {
  alipay: '#7C5CFF',
  wechat: '#62FAD3',
  meituan: '#69E7FF',
  xinsai: '#FFB86B',
  other: '#9AA7C7',
};

const SOURCE_COLORS = [
  '#7C5CFF',
  '#69E7FF',
  '#62FAD3',
  '#FFB86B',
  '#FF6B6B',
  '#b8a8ff',
  '#9feeff',
  '#9af5dc',
  '#ffd99a',
  '#ffb0b8',
  '#9AA7C7',
  '#5a6b8c',
];

const tooltipStyle = {
  background: 'rgba(10,14,28,0.92)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  color: '#F7FAFF',
  backdropFilter: 'blur(8px)',
} as const;

function money(v: number): string {
  return `¥${v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

/** 每日趋势：金额(左轴柱) + 订单数(右轴线)。 */
export function OrderTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="g-amount" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C5CFF" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#7C5CFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
        <XAxis
          dataKey="date"
          stroke="#9AA7C7"
          tick={{ fill: '#9AA7C7', fontSize: 11 }}
          tickFormatter={(v: string) => v.slice(5)}
          minTickGap={20}
        />
        <YAxis
          yAxisId="l"
          stroke="#9AA7C7"
          tick={{ fill: '#9AA7C7', fontSize: 11 }}
          width={56}
          tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}万`}
        />
        <YAxis
          yAxisId="r"
          orientation="right"
          stroke="#9AA7C7"
          tick={{ fill: '#9AA7C7', fontSize: 11 }}
          width={40}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: '#9AA7C7' }}
          formatter={(value: number, name: string) =>
            name === 'amount' ? [money(value), '实收金额'] : [value.toLocaleString(), '完成订单']
          }
        />
        <Area
          yAxisId="l"
          type="monotone"
          dataKey="amount"
          stroke="#7C5CFF"
          strokeWidth={2}
          fill="url(#g-amount)"
        />
        <Area
          yAxisId="r"
          type="monotone"
          dataKey="orderCount"
          stroke="#69E7FF"
          strokeWidth={2}
          fillOpacity={0}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** 横向条形：按维度（平台/来源/门店）的金额排行。 */
export function GroupBarChart({
  data,
  colorBy,
}: {
  data: GroupMetric[];
  colorBy?: 'platform';
}) {
  if (data.length === 0) {
    return <div className="py-10 text-center text-sm text-[#9AA7C7]">暂无数据</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
        <XAxis
          type="number"
          stroke="#9AA7C7"
          tick={{ fill: '#9AA7C7', fontSize: 11 }}
          tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}万`}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={88}
          stroke="#9AA7C7"
          tick={{ fill: '#F7FAFF', fontSize: 12 }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: '#9AA7C7' }}
          formatter={(value: number, _name: string, item: { payload?: GroupMetric }) => [
            <span key="v">
              {money(Number(value))} · {item.payload?.orderCount.toLocaleString()}单 ·{' '}
              {((item.payload?.amountShare ?? 0) * 100).toFixed(1)}%
            </span>,
            '成交',
          ]}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />
        <Bar dataKey="amount" radius={[0, 6, 6, 0]} barSize={18}>
          {data.map((entry, i) => (
            <Cell
              key={entry.key}
              fill={colorBy === 'platform' ? PLATFORM_COLORS[entry.key] ?? '#9AA7C7' : SOURCE_COLORS[i % SOURCE_COLORS.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 平台/来源占比的简洁胶囊列表（金额 + 占比）。 */
export function ShareList({ data, colorBy }: { data: GroupMetric[]; colorBy?: 'platform' }) {
  return (
    <div className="space-y-2.5">
      {data.map((g, i) => (
        <div key={g.key}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-[#F7FAFF]">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor:
                    colorBy === 'platform'
                      ? PLATFORM_COLORS[g.key] ?? '#9AA7C7'
                      : SOURCE_COLORS[i % SOURCE_COLORS.length],
                }}
              />
              {g.label}
            </span>
            <span className="tabular-nums text-[#9AA7C7]">
              {money(g.amount)}
              <span className="ml-2 text-xs text-[#69E7FF]">{(g.amountShare * 100).toFixed(1)}%</span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(2, g.amountShare * 100)}%`,
                background:
                  colorBy === 'platform'
                    ? PLATFORM_COLORS[g.key] ?? '#9AA7C7'
                    : SOURCE_COLORS[i % SOURCE_COLORS.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
