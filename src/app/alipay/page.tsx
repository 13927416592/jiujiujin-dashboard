"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign,
  Users,
  ShoppingCart,
  Activity,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Smartphone,
  MessageSquare,
  UserCircle,
  Filter,
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
  icon: React.ComponentType<{ className?: string }>;
}) {
  const isPositive = change?.startsWith("+");
  const isNegative = change?.startsWith("-");

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm hover:bg-white/10 transition-all duration-300 hover:-translate-y-1">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Icon className="w-5 h-5 text-purple-400" />
          </div>
          {change && (
            <Badge
              variant="outline"
              className={`
                ${isPositive ? "bg-green-500/10 text-green-400 border-green-500/20" : ""}
                ${isNegative ? "bg-red-500/10 text-red-400 border-red-500/20" : ""}
                ${!isPositive && !isNegative ? "bg-gray-500/10 text-gray-400 border-gray-500/20" : ""}
              `}
            >
              {isPositive && <ArrowUpRight className="w-3 h-3 mr-1" />}
              {isNegative && <ArrowDownRight className="w-3 h-3 mr-1" />}
              {!isPositive && !isNegative && <Minus className="w-3 h-3 mr-1" />}
              {change}
            </Badge>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
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
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                {headers.map((header, i) => (
                  <th
                    key={i}
                    className="text-left py-3 px-4 text-sm font-medium text-muted-foreground"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  {headers.map((header, j) => (
                    <td key={j} className="py-3 px-4 text-sm text-white">
                      {row[header] || "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// 转化漏斗组件
function ConversionFunnel({ data }: { data: AlipayData }) {
  const trafficUsers = data.overview["7 日活跃用户数"]?.value || "6.66 万";
  const orderCount = data.overview["7 日交易笔数"]?.value || "870";
  const orderAmount = data.overview["7 日交易金额"]?.value || "685 万";

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">转化漏斗</CardTitle>
        <p className="text-sm text-muted-foreground">
          流量 → 客资（待接入）→ 成交订单
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* 流量层 */}
          <div className="relative">
            <div className="flex items-center justify-between p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <Activity className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">流量（访问用户）</p>
                  <p className="text-xl font-bold text-white">{trafficUsers}</p>
                </div>
              </div>
              <Badge className="bg-purple-500/20 text-purple-300">第 1 层</Badge>
            </div>
            <div className="absolute left-1/2 -bottom-4 w-px h-4 bg-white/20"></div>
          </div>

          {/* 客资层（预留） */}
          <div className="relative pt-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-gray-500/10 border border-gray-500/20 border-dashed">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gray-500/20">
                  <UserCircle className="w-5 h-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">客资（留资用户）</p>
                  <p className="text-xl font-bold text-gray-400">待接入</p>
                </div>
              </div>
              <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30">
                第 2 层
              </Badge>
            </div>
            <div className="absolute left-1/2 -bottom-4 w-px h-4 bg-white/20"></div>
          </div>

          {/* 成交层 */}
          <div className="relative pt-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/20">
                  <ShoppingCart className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">成交订单</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-xl font-bold text-white">{orderCount}</p>
                    <p className="text-sm text-muted-foreground">{orderAmount}</p>
                  </div>
                </div>
              </div>
              <Badge className="bg-green-500/20 text-green-300">第 3 层</Badge>
            </div>
          </div>

          {/* 转化率提示 */}
          <div className="mt-6 p-4 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
            <div className="flex items-start gap-3">
              <Filter className="w-5 h-5 text-cyan-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-cyan-300">数据漏斗说明</p>
                <p className="text-xs text-muted-foreground mt-1">
                  当前展示：流量（{trafficUsers}）→ 成交（{orderCount}笔）
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  待接入：客资数据（留资用户数、客资成本、渠道来源）
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  接入后可计算：流量→客资转化率、客资→成交转化率、整体 ROI
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AlipayPage() {
  const [data, setData] = useState<AlipayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div className="container mx-auto p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card className="bg-red-500/10 border-red-500/20">
          <CardContent className="p-6">
            <p className="text-red-400">加载失败：{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            支付宝运营数据
          </h1>
          <p className="text-muted-foreground mt-1">数据日期：{data.date}</p>
        </div>
        <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20">
          <div className="w-2 h-2 rounded-full bg-green-400 mr-2 animate-pulse"></div>
          数据已同步
        </Badge>
      </div>

      {/* KPI 指标卡 */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
      </section>

      {/* Tab 切换区 */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-white/5 border-white/10 backdrop-blur-sm">
          <TabsTrigger value="overview">经营总览</TabsTrigger>
          <TabsTrigger value="traffic">流量分析</TabsTrigger>
          <TabsTrigger value="funnel">转化漏斗</TabsTrigger>
          <TabsTrigger value="miniProgram">小程序</TabsTrigger>
          <TabsTrigger value="lifeAccount">生活号</TabsTrigger>
          <TabsTrigger value="fanGroup">粉丝群</TabsTrigger>
        </TabsList>

        {/* 经营总览 Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(data.overview).slice(0, 8).map(([key, val]) => (
              <KPICard
                key={key}
                title={key}
                value={val.value}
                change={val.change}
                icon={Activity}
              />
            ))}
          </div>
        </TabsContent>

        {/* 流量分析 Tab */}
        <TabsContent value="traffic" className="space-y-4">
          <Tabs defaultValue="traffic-overview">
            <TabsList className="bg-white/5 border-white/10">
              <TabsTrigger value="traffic-overview">流量概览</TabsTrigger>
              <TabsTrigger value="traffic-mini">小程序流量</TabsTrigger>
              <TabsTrigger value="traffic-life">生活号 + 流量</TabsTrigger>
              <TabsTrigger value="traffic-fan">粉丝群流量</TabsTrigger>
            </TabsList>

            <TabsContent value="traffic-overview" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(data.traffic.overview.metrics || {}).slice(0, 8).map(([key, val]) => (
                  <KPICard
                    key={key}
                    title={key}
                    value={val.value}
                    change={val.change}
                    icon={Activity}
                  />
                ))}
              </div>
              {data.traffic.overview.tables?.map((table, i) => (
                <DataTable
                  key={i}
                  headers={table.headers}
                  rows={table.rows}
                  title={`流量阵地分布 ${i + 1}`}
                />
              ))}
            </TabsContent>

            <TabsContent value="traffic-mini" className="mt-4">
              {data.traffic.miniProgram?.tables?.map((table, i) => (
                <DataTable
                  key={i}
                  headers={table.headers}
                  rows={table.rows}
                  title={`小程序流量 ${i + 1}`}
                />
              )) || <Card className="bg-white/5 border-white/10"><CardContent className="p-6 text-muted-foreground">暂无数据</CardContent></Card>}
            </TabsContent>

            <TabsContent value="traffic-life" className="mt-4">
              {data.traffic.lifeAccount?.tables?.map((table, i) => (
                <DataTable
                  key={i}
                  headers={table.headers}
                  rows={table.rows}
                  title={`生活号 + 流量 ${i + 1}`}
                />
              )) || <Card className="bg-white/5 border-white/10"><CardContent className="p-6 text-muted-foreground">暂无数据</CardContent></Card>}
            </TabsContent>

            <TabsContent value="traffic-fan" className="mt-4">
              {data.traffic.fanGroup?.tables?.map((table, i) => (
                <DataTable
                  key={i}
                  headers={table.headers}
                  rows={table.rows}
                  title={`粉丝群流量 ${i + 1}`}
                />
              )) || <Card className="bg-white/5 border-white/10"><CardContent className="p-6 text-muted-foreground">暂无数据</CardContent></Card>}
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* 转化漏斗 Tab */}
        <TabsContent value="funnel">
          <ConversionFunnel data={data} />
        </TabsContent>

        {/* 小程序 Tab */}
        <TabsContent value="miniProgram" className="space-y-4">
          {data.miniPrograms && data.miniPrograms.length > 0 ? (
            data.miniPrograms.map((mp) => (
              <Card key={mp.id} className="bg-white/5 border-white/10 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <Smartphone className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <CardTitle>{mp.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">ID: {mp.id}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue={Object.keys(mp.tabs || {})[0] || "overview"}>
                    <TabsList className="bg-white/5 border-white/10">
                      {Object.keys(mp.tabs || {}).map((tab) => (
                        <TabsTrigger key={tab} value={tab}>
                          {tab}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {Object.entries(mp.tabs || {}).map(([tabName, tabData]) => (
                      <TabsContent key={tabName} value={tabName} className="space-y-4 mt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          {Object.entries(tabData.metrics || {}).slice(0, 8).map(([key, val]) => (
                            <KPICard
                              key={key}
                              title={key}
                              value={val.value}
                              change={val.change}
                              icon={Activity}
                            />
                          ))}
                        </div>
                        {tabData.tables?.map((table, i) => (
                          <DataTable
                            key={i}
                            headers={table.headers}
                            rows={table.rows}
                            title={`${tabName} 数据 ${i + 1}`}
                          />
                        ))}
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card className="bg-white/5 border-white/10">
              <CardContent className="p-6 text-muted-foreground">暂无小程序数据</CardContent>
            </Card>
          )}
        </TabsContent>

        {/* 生活号 Tab */}
        <TabsContent value="lifeAccount" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(data.lifeAccount?.metrics || {}).slice(0, 8).map(([key, val]) => (
              <KPICard
                key={key}
                title={key}
                value={val.value}
                change={val.change}
                icon={MessageSquare}
              />
            ))}
          </div>
          {data.lifeAccount?.tables?.map((table, i) => (
            <DataTable
              key={i}
              headers={table.headers}
              rows={table.rows}
              title={`生活号 + 数据 ${i + 1}`}
            />
          ))}
        </TabsContent>

        {/* 粉丝群 Tab */}
        <TabsContent value="fanGroup" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(data.fanGroup?.metrics || {}).slice(0, 8).map(([key, val]) => (
              <KPICard
                key={key}
                title={key}
                value={val.value}
                change={val.change}
                icon={Users}
              />
            ))}
          </div>
          {data.fanGroup?.tables?.map((table, i) => (
            <DataTable
              key={i}
              headers={table.headers}
              rows={table.rows}
              title={`粉丝群数据 ${i + 1}`}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
