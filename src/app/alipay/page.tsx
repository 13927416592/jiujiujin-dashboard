"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  Users,
  ShoppingCart,
  Activity,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Smartphone,
  MessageSquare,
  Clock,
} from "lucide-react";

interface MetricData {
  value: string;
  change?: string;
}

type MetricMap = Record<string, MetricData>;

interface MiniProgramData {
  id: string;
  name: string;
  tabs: Record<string, MetricMap>;
}

interface TrendPoint {
  date: string;
  values: Record<string, number | null>;
}

interface AlipayData {
  range: "1d" | "7d" | "30d";
  availableDays: number;
  date: string | null;
  dates: string[];
  overview: MetricMap;
  traffic: {
    overview: MetricMap;
    miniProgramTraffic: MetricMap;
    lifeAccountTraffic: MetricMap;
    fanGroupTraffic: MetricMap;
  };
  miniPrograms?: MiniProgramData[];
  lifeAccountTraffic: MetricMap;
  fanGroupTraffic: MetricMap;
  trend: {
    overview: TrendPoint[];
    trafficOverview: TrendPoint[];
  };
}

type RangeKey = "1d" | "7d" | "30d";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "1d", label: "近1日" },
  { key: "7d", label: "近7日" },
  { key: "30d", label: "近30日" },
];

function rangeLabel(range: RangeKey): string {
  return RANGE_OPTIONS.find((r) => r.key === range)?.label ?? "近7日";
}

// KPI 指标卡组件
function KPICard({
  title,
  value,
  change,
  icon: Icon,
}: {
  title: string;
  value: string;
  change?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  const isPositive = change?.startsWith("+");
  const isNegative = change?.startsWith("-");

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all duration-300">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-[#7C5CFF]/20 flex items-center justify-center">
          <Icon className="w-4 h-4 text-[#7C5CFF]" />
        </div>
        <span className="text-sm text-[#9AA7C7]">{title}</span>
      </div>
      <div className="text-2xl font-bold text-[#F7FAFF]">{value}</div>
      {change && (
        <div
          className={`flex items-center gap-1 mt-2 text-xs ${
            isPositive
              ? "text-[#62FAD3]"
              : isNegative
              ? "text-[#FF6B6B]"
              : "text-[#9AA7C7]"
          }`}
        >
          {isPositive && <ArrowUpRight className="w-3 h-3" />}
          {isNegative && <ArrowDownRight className="w-3 h-3" />}
          {!isPositive && !isNegative && <Minus className="w-3 h-3" />}
          <span>{change}</span>
        </div>
      )}
    </div>
  );
}

// 轻量内联 SVG 趋势折线图（单序列）
function TrendLineChart({
  points,
  field,
  label,
  color = "#7C5CFF",
}: {
  points: TrendPoint[];
  field: string;
  label: string;
  color?: string;
}) {
  const data = useMemo(
    () =>
      points
        .map((p) => ({ date: p.date, v: p.values[field] }))
        .filter((p): p is { date: string; v: number } => p.v != null),
    [points, field]
  );

  if (data.length === 0) {
    return (
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6 text-[#9AA7C7] text-sm">
        暂无趋势数据
      </div>
    );
  }

  const w = 760;
  const h = 220;
  const pad = { top: 20, right: 16, bottom: 32, left: 48 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.v), 1);
  const min = 0;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const xy = data.map((d, i) => {
    const x = pad.left + i * stepX;
    const y = pad.top + innerH - ((d.v - min) / (max - min || 1)) * innerH;
    return { x, y, ...d };
  });

  const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area =
    `${path} L${xy[xy.length - 1].x.toFixed(1)},${(pad.top + innerH).toFixed(1)} ` +
    `L${xy[0].x.toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  const gridY = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = data.length > 12 ? Math.ceil(data.length / 6) : 1;

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
      <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">{label} · 每日趋势</h3>
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={`grad-${field}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridY.map((g, i) => {
            const y = pad.top + innerH - g * innerH;
            const val = max * g;
            return (
              <g key={i}>
                <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke="rgba(255,255,255,0.08)" />
                <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#9AA7C7">
                  {val >= 10000 ? `${(val / 10000).toFixed(0)}万` : val.toFixed(val % 1 ? 1 : 0)}
                </text>
              </g>
            );
          })}
          <path d={area} fill={`url(#grad-${field})`} />
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {xy.map((p, i) => (
            <g key={p.date}>
              <circle cx={p.x} cy={p.y} r="2.5" fill={color} />
              {i % labelEvery === 0 && (
                <text x={p.x} y={h - 10} textAnchor="middle" fontSize="10" fill="#9AA7C7">
                  {p.date.slice(5)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// 转化漏斗组件
function ConversionFunnel({ data, range }: { data: AlipayData; range: RangeKey }) {
  const trafficUsers = data.overview["7日活跃用户数"]?.value || "-";
  const orderCount = data.overview["7日交易笔数"]?.value || "-";
  const orderAmount = data.overview["7日交易金额"]?.value || "-";

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
      <h3 className="text-base font-semibold text-[#F7FAFF] mb-2">转化漏斗</h3>
      <p className="text-sm text-[#9AA7C7] mb-4">
        {rangeLabel(range)}汇总 · 流量 → 客资（待接入）→ 成交订单
      </p>
      <div className="space-y-4">
        <div className="relative">
          <div className="flex items-center justify-between p-4 rounded-lg bg-[#7C5CFF]/10 border border-[#7C5CFF]/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#7C5CFF]/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-[#7C5CFF]" />
              </div>
              <div>
                <p className="text-sm text-[#9AA7C7]">流量（活跃用户）</p>
                <p className="text-xl font-bold text-[#F7FAFF]">{trafficUsers}</p>
              </div>
            </div>
            <div className="px-2 py-1 rounded text-xs bg-[#7C5CFF]/20 text-[#7C5CFF]">第 1 层</div>
          </div>
          <div className="absolute left-1/2 -bottom-4 w-px h-4 bg-white/20"></div>
        </div>
        <div className="relative">
          <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#9AA7C7]/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-[#9AA7C7]" />
              </div>
              <div>
                <p className="text-sm text-[#9AA7C7]">客资（待接入）</p>
                <p className="text-xl font-bold text-[#9AA7C7]">-</p>
              </div>
            </div>
            <div className="px-2 py-1 rounded text-xs bg-white/10 text-[#9AA7C7]">第 2 层</div>
          </div>
          <div className="absolute left-1/2 -bottom-4 w-px h-4 bg-white/20"></div>
        </div>
        <div>
          <div className="flex items-center justify-between p-4 rounded-lg bg-[#62FAD3]/10 border border-[#62FAD3]/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#62FAD3]/20 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-[#62FAD3]" />
              </div>
              <div>
                <p className="text-sm text-[#9AA7C7]">成交（{orderCount} 笔）</p>
                <p className="text-xl font-bold text-[#F7FAFF]">{orderAmount}</p>
              </div>
            </div>
            <div className="px-2 py-1 rounded text-xs bg-[#62FAD3]/20 text-[#62FAD3]">第 3 层</div>
          </div>
        </div>
        <div className="mt-6 p-4 rounded-lg bg-white/5 border border-white/10">
          <div className="flex items-start gap-3">
            <TrendingUp className="w-5 h-5 text-[#69E7FF] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[#69E7FF]">数据漏斗说明</p>
              <p className="text-xs text-[#9AA7C7] mt-1">
                当前展示：流量（{trafficUsers}）→ 成交（{orderCount} 笔）
              </p>
              <p className="text-xs text-[#9AA7C7] mt-1">待接入：客资数据（留资用户数、客资成本、渠道来源）</p>
              <p className="text-xs text-[#9AA7C7] mt-1">
                接入后可计算：流量→客资转化率、客资→成交转化率、整体 ROI
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AlipayPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [data, setData] = useState<AlipayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [trafficSubTab, setTrafficSubTab] = useState("traffic-overview");
  const [miniProgramTab, setMiniProgramTab] = useState<Record<string, string>>({});

  const fetchData = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/data/alipay/full?days=${r}`, { cache: "no-store" });
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        setData(null);
        setError(body.error || "暂无支付宝数据");
        return;
      }
      if (!res.ok) throw new Error("数据加载失败");
      const result = (await res.json()) as AlipayData;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  const tabs = [
    { id: "overview", label: "经营总览" },
    { id: "traffic", label: "流量分析" },
    { id: "funnel", label: "转化漏斗" },
    { id: "miniProgram", label: "小程序" },
    { id: "lifeAccount", label: "生活号" },
    { id: "fanGroup", label: "粉丝群" },
  ];

  const trafficSubTabs = [
    { id: "traffic-overview", label: "流量概览" },
    { id: "traffic-mini", label: "小程序流量" },
    { id: "traffic-life", label: "生活号 + 流量" },
    { id: "traffic-fan", label: "粉丝群流量" },
  ];

  const dateRangeText = useMemo(() => {
    if (!data || data.dates.length === 0) return "-";
    if (data.dates.length === 1) return data.dates[0];
    return `${data.dates[0]} ~ ${data.dates[data.dates.length - 1]}`;
  }, [data]);

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 页面标题 */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F7FAFF]">支付宝运营</h1>
            <p className="text-sm text-[#9AA7C7] mt-1">支付宝商家平台数据分析 · 每日明细自动聚合</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* 时间范围切换 */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setRange(opt.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    range === opt.key
                      ? "bg-[#7C5CFF] text-white shadow"
                      : "text-[#9AA7C7] hover:bg-white/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <Clock className="w-4 h-4 text-[#9AA7C7]" />
              <span className="text-xs text-[#9AA7C7]">{dateRangeText}</span>
              {data && data.availableDays < (range === "1d" ? 1 : range === "7d" ? 7 : 30) && (
                <span className="text-xs text-[#69E7FF]">（仅 {data.availableDays} 天数据）</span>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#62FAD3]/10 border border-[#62FAD3]/20">
              <div className="w-2 h-2 rounded-full bg-[#62FAD3] animate-pulse"></div>
              <span className="text-xs text-[#62FAD3]">数据已同步</span>
            </div>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-6 space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-[#7C5CFF] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-[#9AA7C7]">加载中...</p>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="bg-[#FF6B6B]/10 border border-[#FF6B6B]/20 rounded-xl p-6">
            <p className="text-[#FF6B6B]">加载失败：{error}</p>
            <p className="text-xs text-[#9AA7C7] mt-2">
              请先在本地运行 <code className="text-[#69E7FF]">npx tsx src/exporters/test-alipay-full.ts</code>{" "}
              上传每日数据。
            </p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* KPI 指标卡 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="交易金额"
                value={data.overview["7日交易金额"]?.value || "-"}
                icon={DollarSign}
              />
              <KPICard
                title="活跃用户"
                value={
                  data.overview["7日活跃用户数"]?.value ||
                  data.overview["7日交易用户数"]?.value ||
                  "-"
                }
                icon={Users}
              />
              <KPICard
                title="交易笔数"
                value={data.overview["7日交易笔数"]?.value || "-"}
                icon={ShoppingCart}
              />
              <KPICard
                title="累计用户资产"
                value={data.overview["累计用户资产"]?.value || "-"}
                icon={TrendingUp}
              />
            </div>

            {/* 核心趋势图 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TrendLineChart
                points={data.trend.overview}
                field="7日交易金额"
                label="交易金额"
                color="#7C5CFF"
              />
              <TrendLineChart
                points={data.trend.overview}
                field="7日交易笔数"
                label="交易笔数"
                color="#69E7FF"
              />
            </div>

            {/* Tab 切换区 */}
            <div className="flex gap-2 flex-wrap">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? "bg-[#7C5CFF] text-white"
                      : "bg-white/5 text-[#9AA7C7] hover:bg-white/10"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 经营总览 Tab */}
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(data.overview).map(([key, val]) => (
                  <KPICard key={key} title={key} value={val.value} change={val.change} icon={Activity} />
                ))}
              </div>
            )}

            {/* 流量分析 Tab */}
            {activeTab === "traffic" && (
              <div className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                  {trafficSubTabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setTrafficSubTab(tab.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        trafficSubTab === tab.id
                          ? "bg-[#69E7FF] text-[#070A14]"
                          : "bg-white/5 text-[#9AA7C7] hover:bg-white/10"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {trafficSubTab === "traffic-overview" && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {Object.entries(data.traffic.overview || {}).map(([key, val]) => (
                        <KPICard key={key} title={key} value={val.value} change={val.change} icon={Activity} />
                      ))}
                    </div>
                    <TrendLineChart
                      points={data.trend.trafficOverview}
                      field="访问用户数"
                      label="访问用户数"
                      color="#62FAD3"
                    />
                  </>
                )}

                {trafficSubTab === "traffic-mini" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(data.traffic.miniProgramTraffic || {}).length > 0 ? (
                      Object.entries(data.traffic.miniProgramTraffic).map(([key, val]) => (
                        <KPICard key={key} title={key} value={val.value} change={val.change} icon={Smartphone} />
                      ))
                    ) : (
                      <div className="col-span-full bg-white/5 border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                        暂无数据
                      </div>
                    )}
                  </div>
                )}

                {trafficSubTab === "traffic-life" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(data.traffic.lifeAccountTraffic || {}).length > 0 ? (
                      Object.entries(data.traffic.lifeAccountTraffic).map(([key, val]) => (
                        <KPICard key={key} title={key} value={val.value} change={val.change} icon={MessageSquare} />
                      ))
                    ) : (
                      <div className="col-span-full bg-white/5 border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                        暂无数据
                      </div>
                    )}
                  </div>
                )}

                {trafficSubTab === "traffic-fan" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(data.traffic.fanGroupTraffic || {}).length > 0 ? (
                      Object.entries(data.traffic.fanGroupTraffic).map(([key, val]) => (
                        <KPICard key={key} title={key} value={val.value} change={val.change} icon={Users} />
                      ))
                    ) : (
                      <div className="col-span-full bg-white/5 border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                        暂无数据
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 转化漏斗 Tab */}
            {activeTab === "funnel" && <ConversionFunnel data={data} range={range} />}

            {/* 小程序 Tab */}
            {activeTab === "miniProgram" && (
              <div className="space-y-4">
                {data.miniPrograms && data.miniPrograms.length > 0 ? (
                  data.miniPrograms.map((mp) => (
                    <div
                      key={mp.id}
                      className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6"
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-lg bg-[#7C5CFF]/20 flex items-center justify-center">
                          <Smartphone className="w-5 h-5 text-[#7C5CFF]" />
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-[#F7FAFF]">{mp.name}</h3>
                          <p className="text-sm text-[#9AA7C7]">ID: {mp.id}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap mb-4">
                        {Object.keys(mp.tabs || {}).map((tab) => (
                          <button
                            key={tab}
                            onClick={() => setMiniProgramTab({ ...miniProgramTab, [mp.id]: tab })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              (miniProgramTab[mp.id] || Object.keys(mp.tabs || {})[0]) === tab
                                ? "bg-[#69E7FF] text-[#070A14]"
                                : "bg-white/5 text-[#9AA7C7] hover:bg-white/10"
                            }`}
                          >
                            {tab}
                          </button>
                        ))}
                      </div>
                      {Object.entries(mp.tabs || {}).map(([tabName, tabData]) => {
                        const currentTab =
                          miniProgramTab[mp.id] || Object.keys(mp.tabs || {})[0];
                        if (tabName !== currentTab) return null;
                        const hasMetrics = Object.keys(tabData || {}).length > 0;
                        return (
                          <div key={tabName} className="space-y-4">
                            {hasMetrics ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                {Object.entries(tabData).map(([key, val]) => (
                                  <KPICard
                                    key={key}
                                    title={key}
                                    value={val.value}
                                    change={val.change}
                                    icon={Activity}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                                <p className="text-sm">该 Tab 暂无数据</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
                ) : (
                  <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                    暂无小程序数据
                  </div>
                )}
              </div>
            )}

            {/* 生活号 Tab */}
            {activeTab === "lifeAccount" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(data.lifeAccountTraffic || {}).length > 0 ? (
                  Object.entries(data.lifeAccountTraffic).map(([key, val]) => (
                    <KPICard key={key} title={key} value={val.value} change={val.change} icon={MessageSquare} />
                  ))
                ) : (
                  <div className="col-span-full bg-white/5 border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                    暂无数据
                  </div>
                )}
              </div>
            )}

            {/* 粉丝群 Tab */}
            {activeTab === "fanGroup" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(data.fanGroupTraffic || {}).length > 0 ? (
                  Object.entries(data.fanGroupTraffic).map(([key, val]) => (
                    <KPICard key={key} title={key} value={val.value} change={val.change} icon={Users} />
                  ))
                ) : (
                  <div className="col-span-full bg-white/5 border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                    暂无数据
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
