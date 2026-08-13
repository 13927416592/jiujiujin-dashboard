'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Users, DollarSign, ShoppingCart, Activity } from 'lucide-react';

interface AlipayData {
  date: string;
  overview: Record<string, string>;
  traffic: {
    overview: {
      metrics: Record<string, { value: string; change?: string }>;
      tables: Array<{ headers: string[]; rows: Array<Record<string, string>> }>;
    };
    miniProgramTraffic: any;
    lifeAccountTraffic: any;
    fanGroupTraffic: any;
  };
  miniPrograms: Array<{
    id: string;
    name: string;
    tabs: Record<string, {
      metrics: Record<string, { value: string; change?: string }>;
      tables: Array<{ headers: string[]; rows: Array<Record<string, string>> }>;
    }>;
  }>;
  lifeAccount: {
    metrics: Record<string, { value: string; change?: string }>;
    tables: Array<{ headers: string[]; rows: Array<Record<string, string>> }>;
  };
  fanGroup: {
    metrics: Record<string, { value: string; change?: string }>;
    tables: Array<{ headers: string[]; rows: Array<Record<string, string>> }>;
  };
}

function formatChange(change?: string): { text: string; isPositive: boolean } {
  if (!change) return { text: '-', isPositive: true };
  const isPositive = change.startsWith('+');
  return { text: change, isPositive };
}

function MetricCard({ title, value, change, icon: Icon }: {
  title: string;
  value: string;
  change?: string;
  icon: any;
}) {
  const { text, isPositive } = formatChange(change);
  
  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {change && (
              <div className={`flex items-center text-xs ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                较前7日 {text}
              </div>
            )}
          </div>
          <Icon className="w-8 h-8 text-primary/50" />
        </div>
      </CardContent>
    </Card>
  );
}

function DataTable({ headers, rows, title }: {
  headers: string[];
  rows: Array<Record<string, string>>;
  title: string;
}) {
  if (!headers.length || !rows.length) return null;
  
  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                {headers.map((h, i) => (
                  <th key={i} className="text-left py-2 px-3 text-muted-foreground font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  {headers.map((h, j) => (
                    <td key={j} className="py-2 px-3">
                      {row[h] || '-'}
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

export default function AlipayPage() {
  const [data, setData] = useState<AlipayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/data/alipay/full')
      .then(res => res.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">加载支付宝数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="bg-red-500/10 border-red-500/20">
          <CardContent className="p-6">
            <p className="text-red-400">加载失败: {error}</p>
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
          <h1 className="text-3xl font-bold">支付宝数据</h1>
          <p className="text-muted-foreground mt-1">数据日期: {data.date}</p>
        </div>
        <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20">
          数据已同步
        </Badge>
      </div>

      {/* 经营总览 */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">经营总览</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="7日交易金额"
            value={data.overview['7日交易金额'] || '-'}
            icon={DollarSign}
          />
          <MetricCard
            title="7日交易用户数"
            value={data.overview['7日交易用户数'] || '-'}
            icon={Users}
          />
          <MetricCard
            title="7日交易笔数"
            value={data.overview['7日交易笔数'] || '-'}
            icon={ShoppingCart}
          />
          <MetricCard
            title="7日活跃用户数"
            value={data.overview['7日活跃用户数'] || '-'}
            icon={Activity}
          />
        </div>
      </section>

      {/* 流量分析 */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">流量分析</h2>
        <Tabs defaultValue="overview">
          <TabsList className="bg-white/5 border-white/10">
            <TabsTrigger value="overview">流量概览</TabsTrigger>
            <TabsTrigger value="miniProgram">小程序流量</TabsTrigger>
            <TabsTrigger value="lifeAccount">生活号+流量</TabsTrigger>
            <TabsTrigger value="fanGroup">商家粉丝群流量</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(data.traffic.overview.metrics || {}).slice(0, 8).map(([key, val]) => (
                <MetricCard
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
          
          <TabsContent value="miniProgram">
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardContent className="p-6">
                <p className="text-muted-foreground">小程序流量数据</p>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="lifeAccount">
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardContent className="p-6">
                <p className="text-muted-foreground">生活号+流量数据</p>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="fanGroup">
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardContent className="p-6">
                <p className="text-muted-foreground">商家粉丝群流量数据</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      {/* 小程序分析 */}
      {data.miniPrograms?.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">小程序分析</h2>
          {data.miniPrograms.map((mp) => (
            <Card key={mp.id} className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>{mp.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Tabs defaultValue="overview">
                  <TabsList className="bg-white/5 border-white/10">
                    {Object.keys(mp.tabs || {}).map(tab => (
                      <TabsTrigger key={tab} value={tab}>{tab}</TabsTrigger>
                    ))}
                  </TabsList>
                  {Object.entries(mp.tabs || {}).map(([tabName, tabData]) => (
                    <TabsContent key={tabName} value={tabName} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {Object.entries(tabData.metrics || {}).slice(0, 8).map(([key, val]) => (
                          <MetricCard
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
          ))}
        </section>
      )}

      {/* 生活号+分析 */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">生活号+分析</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(data.lifeAccount?.metrics || {}).slice(0, 8).map(([key, val]) => (
            <MetricCard
              key={key}
              title={key}
              value={val.value}
              change={val.change}
              icon={Activity}
            />
          ))}
        </div>
        {data.lifeAccount?.tables?.map((table, i) => (
          <DataTable
            key={i}
            headers={table.headers}
            rows={table.rows}
            title={`生活号+数据 ${i + 1}`}
          />
        ))}
      </section>

      {/* 商家粉丝群 */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">商家粉丝群</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(data.fanGroup?.metrics || {}).slice(0, 8).map(([key, val]) => (
            <MetricCard
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
      </section>
    </div>
  );
}
