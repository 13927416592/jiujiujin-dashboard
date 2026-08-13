"use client";

import { useEffect, useState } from "react";
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
  UserCircle,
  Filter,
  Clock,
} from "lucide-react";

interface MetricData {
  value: string;
  change?: string;
}

interface TableData {
  headers: string[];
  rows: Record<string, string>[];
}

interface TrafficTabData {
  metrics: Record<string, MetricData>;
  tables: TableData[];
}

interface MiniProgramData {
  id: string;
  name: string;
  tabs: Record<string, TrafficTabData>;
}

interface AlipayData {
  date: string;
  overview: Record<string, MetricData>;
  traffic: {
    overview: TrafficTabData;
    miniProgram?: TrafficTabData;
    lifeAccount?: TrafficTabData;
    fanGroup?: TrafficTabData;
  };
  miniPrograms?: MiniProgramData[];
  lifeAccount?: TrafficTabData;
  fanGroup?: TrafficTabData;
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
        <div className={`flex items-center gap-1 mt-2 text-xs ${isPositive ? "text-[#62FAD3]" : isNegative ? "text-[#FF6B6B]" : "text-[#9AA7C7]"}`}>
          {isPositive && <ArrowUpRight className="w-3 h-3" />}
          {isNegative && <ArrowDownRight className="w-3 h-3" />}
          {!isPositive && !isNegative && <Minus className="w-3 h-3" />}
          <span>{change}</span>
        </div>
      )}
    </div>
  );
}

// 数据表格组件
function DataTable({
  headers,
  rows,
  title,
}: {
  headers: string[];
  rows: Record<string, string>[];
  title?: string;
}) {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
      {title && <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">{title}</h3>}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              {headers.map((header, i) => (
                <th key={i} className="text-left py-3 px-4 text-sm font-medium text-[#9AA7C7]">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                {headers.map((header, j) => (
                  <td key={j} className="py-3 px-4 text-sm text-[#F7FAFF]">
                    {row[header] || "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 转化漏斗组件
function ConversionFunnel({ data }: { data: AlipayData }) {
  const trafficUsers = data.overview["7 日活跃用户数"]?.value || "6.66 万";
  const orderCount = data.overview["7 日交易笔数"]?.value || "870";
  const orderAmount = data.overview["7 日交易金额"]?.value || "685 万";

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
      <h3 className="text-base font-semibold text-[#F7FAFF] mb-2">转化漏斗</h3>
      <p className="text-sm text-[#9AA7C7] mb-4">流量 → 客资（待接入）→ 成交订单</p>
      <div className="space-y-4">
        {/* 流量层 */}
        <div className="relative">
          <div className="flex items-center justify-between p-4 rounded-lg bg-[#7C5CFF]/10 border border-[#7C5CFF]/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#7C5CFF]/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-[#7C5CFF]" />
              </div>
              <div>
                <p className="text-sm text-[#9AA7C7]">流量（访问用户）</p>
                <p className="text-xl font-bold text-[#F7FAFF]">{trafficUsers}</p>
              </div>
            </div>
            <div className="px-2 py-1 rounded text-xs bg-[#7C5CFF]/20 text-[#7C5CFF]">第 1 层</div>
          </div>
          <div className="absolute left-1/2 -bottom-4 w-px h-4 bg-white/20"></div>
        </div>

        {/* 客资层（预留） */}
        <div className="relative pt-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/20 border-dashed">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                <UserCircle className="w-5 h-5 text-[#9AA7C7]" />
              </div>
              <div>
                <p className="text-sm text-[#9AA7C7]">客资（留资用户）</p>
                <p className="text-xl font-bold text-[#9AA7C7]">待接入</p>
              </div>
            </div>
            <div className="px-2 py-1 rounded text-xs bg-white/10 text-[#9AA7C7]">第 2 层</div>
          </div>
          <div className="absolute left-1/2 -bottom-4 w-px h-4 bg-white/20"></div>
        </div>

        {/* 成交层 */}
        <div className="relative pt-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-[#62FAD3]/10 border border-[#62FAD3]/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#62FAD3]/20 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-[#62FAD3]" />
              </div>
              <div>
                <p className="text-sm text-[#9AA7C7]">成交订单</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-xl font-bold text-[#F7FAFF]">{orderCount}</p>
                  <p className="text-sm text-[#9AA7C7]">{orderAmount}</p>
                </div>
              </div>
            </div>
            <div className="px-2 py-1 rounded text-xs bg-[#62FAD3]/20 text-[#62FAD3]">第 3 层</div>
          </div>
        </div>

        {/* 数据漏斗说明 */}
        <div className="mt-6 p-4 rounded-lg bg-[#69E7FF]/5 border border-[#69E7FF]/20">
          <div className="flex items-start gap-3">
            <Filter className="w-5 h-5 text-[#69E7FF] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[#69E7FF]">数据漏斗说明</p>
              <p className="text-xs text-[#9AA7C7] mt-1">当前展示：流量（{trafficUsers}）→ 成交（{orderCount}笔）</p>
              <p className="text-xs text-[#9AA7C7] mt-1">待接入：客资数据（留资用户数、客资成本、渠道来源）</p>
              <p className="text-xs text-[#9AA7C7] mt-1">接入后可计算：流量→客资转化率、客资→成交转化率、整体 ROI</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AlipayPage() {
  const [data, setData] = useState<AlipayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [trafficSubTab, setTrafficSubTab] = useState("traffic-overview");
  const [miniProgramTab, setMiniProgramTab] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/data/alipay/full");
        if (!res.ok) throw new Error("数据加载失败");
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070A14] text-[#F7FAFF] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#7C5CFF] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#9AA7C7]">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#070A14] text-[#F7FAFF] p-6">
        <div className="bg-[#FF6B6B]/10 border border-[#FF6B6B]/20 rounded-xl p-6">
          <p className="text-[#FF6B6B]">加载失败：{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

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

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 页面标题 */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#F7FAFF]">支付宝运营</h1>
            <p className="text-sm text-[#9AA7C7] mt-1">支付宝商家平台数据分析</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <Clock className="w-4 h-4 text-[#9AA7C7]" />
              <span className="text-xs text-[#9AA7C7]">数据日期：{data.date}</span>
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
        {/* KPI 指标卡 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="7 日交易金额"
            value={data.overview["7 日交易金额"]?.value || "-"}
            change={data.overview["7 日交易金额"]?.change}
            icon={DollarSign}
          />
          <KPICard
            title="7 日活跃用户"
            value={data.overview["7 日活跃用户数"]?.value || "-"}
            change={data.overview["7 日活跃用户数"]?.change}
            icon={Users}
          />
          <KPICard
            title="7 日交易笔数"
            value={data.overview["7 日交易笔数"]?.value || "-"}
            change={data.overview["7 日交易笔数"]?.change}
            icon={ShoppingCart}
          />
          <KPICard
            title="累计用户资产"
            value={data.overview["累计用户资产"]?.value || "-"}
            change={data.overview["累计用户资产"]?.change}
            icon={TrendingUp}
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
            {Object.entries(data.overview).slice(0, 8).map(([key, val]) => (
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
                  {Object.entries(data.traffic.overview.metrics || {}).slice(0, 8).map(([key, val]) => (
                    <KPICard key={key} title={key} value={val.value} change={val.change} icon={Activity} />
                  ))}
                </div>
                {data.traffic.overview.tables?.map((table, i) => (
                  <DataTable key={i} headers={table.headers} rows={table.rows} title={`流量阵地分布 ${i + 1}`} />
                ))}
              </>
            )}

            {trafficSubTab === "traffic-mini" && (
              <>
                {data.traffic.miniProgram?.tables?.map((table, i) => (
                  <DataTable key={i} headers={table.headers} rows={table.rows} title={`小程序流量 ${i + 1}`} />
                )) || (
                  <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                    暂无数据
                  </div>
                )}
              </>
            )}

            {trafficSubTab === "traffic-life" && (
              <>
                {data.traffic.lifeAccount?.tables?.map((table, i) => (
                  <DataTable key={i} headers={table.headers} rows={table.rows} title={`生活号 + 流量 ${i + 1}`} />
                )) || (
                  <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                    暂无数据
                  </div>
                )}
              </>
            )}

            {trafficSubTab === "traffic-fan" && (
              <>
                {data.traffic.fanGroup?.tables?.map((table, i) => (
                  <DataTable key={i} headers={table.headers} rows={table.rows} title={`粉丝群流量 ${i + 1}`} />
                )) || (
                  <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6 text-[#9AA7C7]">
                    暂无数据
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 转化漏斗 Tab */}
        {activeTab === "funnel" && <ConversionFunnel data={data} />}

        {/* 小程序 Tab */}
        {activeTab === "miniProgram" && (
          <div className="space-y-4">
            {data.miniPrograms && data.miniPrograms.length > 0 ? (
              data.miniPrograms.map((mp) => (
                <div key={mp.id} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
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
                    const currentTab = miniProgramTab[mp.id] || Object.keys(mp.tabs || {})[0];
                    if (tabName !== currentTab) return null;
                    return (
                      <div key={tabName} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          {Object.entries(tabData.metrics || {}).slice(0, 8).map(([key, val]) => (
                            <KPICard key={key} title={key} value={val.value} change={val.change} icon={Activity} />
                          ))}
                        </div>
                        {tabData.tables?.map((table, i) => (
                          <DataTable key={i} headers={table.headers} rows={table.rows} title={`${tabName} 数据 ${i + 1}`} />
                        ))}
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
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(data.lifeAccount?.metrics || {}).slice(0, 8).map(([key, val]) => (
                <KPICard key={key} title={key} value={val.value} change={val.change} icon={MessageSquare} />
              ))}
            </div>
            {data.lifeAccount?.tables?.map((table, i) => (
              <DataTable key={i} headers={table.headers} rows={table.rows} title={`生活号 + 数据 ${i + 1}`} />
            ))}
          </div>
        )}

        {/* 粉丝群 Tab */}
        {activeTab === "fanGroup" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(data.fanGroup?.metrics || {}).slice(0, 8).map(([key, val]) => (
                <KPICard key={key} title={key} value={val.value} change={val.change} icon={Users} />
              ))}
            </div>
            {data.fanGroup?.tables?.map((table, i) => (
              <DataTable key={i} headers={table.headers} rows={table.rows} title={`粉丝群数据 ${i + 1}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
