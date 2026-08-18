'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, TrendingDown, Minus, Store, Users, ShoppingCart, DollarSign, Star, Calendar } from 'lucide-react';

interface MeituanData {
  日期: string;
  省份: string;
  城市: string;
  点评门店ID: string;
  门店名称: string;
  [key: string]: string | number;
}

interface MeituanSummary {
  exposure: number;
  visits: number;
  orders: number;
  sales: number;
  coupons: number;
  reviews: number;
  storeCount: number;
  recordCount: number;
}

interface MeituanResponse {
  success: boolean;
  data?: {
    summary: MeituanSummary;
    trend: unknown[];
    stores: string[];
    raw: MeituanData[];
  };
  data_date?: string;
  fetched_at?: string;
  source?: string;
  error?: string;
}

export default function MeituanPage() {
  const [data, setData] = useState<MeituanData[]>([]);
  const [summary, setSummary] = useState<MeituanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStore, setSelectedStore] = useState('all');
  const [selectedDate, setSelectedDate] = useState('all');
  const [dataDate, setDataDate] = useState('');
  const [fetchedAt, setFetchedAt] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const res = await fetch('/api/meituan-data');
      const result: MeituanResponse = await res.json();

      if (result.success && result.data) {
        setData(result.data.raw ?? []);
        setSummary(result.data.summary ?? null);
        setDataDate(result.data_date ?? '');
        setFetchedAt(result.fetched_at ?? '');
      } else {
        setError(result.error || '数据加载失败');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 获取筛选选项
  const stores = [...new Set(data.map(item => item.门店名称))];
  const dates = [...new Set(data.map(item => item.日期))].sort();

  // 筛选数据
  const filteredData = data.filter(item => {
    if (selectedStore !== 'all' && item.门店名称 !== selectedStore) return false;
    if (selectedDate !== 'all' && item.日期 !== selectedDate) return false;
    return true;
  });

  // 筛选后按明细重算汇总（接口 summary 为全量，这里反映筛选结果）
  const filteredSummary = {
    totalExposure: filteredData.reduce((sum, item) => sum + (Number(item['客流分析']) || 0), 0),
    totalVisitors: filteredData.reduce((sum, item) => sum + (Number(item['客流分析_4']) || 0), 0),
    totalOrders: filteredData.reduce((sum, item) => sum + (Number(item['客流分析_10']) || 0), 0),
    totalRedeemAmount: filteredData.reduce((sum, item) => sum + (Number(item['交易分析']) || 0), 0),
    totalRedeemCount: filteredData.reduce((sum, item) => sum + (Number(item['交易分析_4']) || 0), 0),
    newReviews: filteredData.reduce((sum, item) => sum + (Number(item['评价分析']) || 0), 0),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#070A14]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#7C5CFF] mx-auto mb-4"></div>
          <p className="text-[#9AA7C7]">加载美团数据中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#070A14]">
        <div className="text-center">
          <p className="text-[#FF6B6B] mb-4">加载失败：{error}</p>
          <button onClick={loadData} className="px-4 py-2 bg-[#7C5CFF] text-white rounded-lg hover:bg-[#7C5CFF]/80">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">美团经营数据看板</h1>
          <p className="text-gray-400">
            {summary
              ? `共 ${summary.storeCount} 家门店 · ${summary.recordCount} 条记录`
              : '实时监控美团平台运营数据'}
          </p>
        </div>

        {/* 筛选器 */}
        <Card className="mb-6 bg-gray-800/50 backdrop-blur border-gray-700">
          <CardContent className="p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">门店筛选</label>
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500"
                >
                  <option value="all">全部门店</option>
                  {stores.map(store => (
                    <option key={store} value={store}>{store}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">日期筛选</label>
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500"
                >
                  <option value="all">全部日期</option>
                  {dates.map(date => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 汇总卡片 */}
        <div className="grid grid-cols-3 gap-6 mb-6">
          <Card className="bg-gradient-to-br from-blue-500/20 to-blue-600/20 backdrop-blur border-blue-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-300 flex items-center gap-2">
                <Users className="w-4 h-4" />
                总曝光人数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{filteredSummary.totalExposure.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/20 to-green-600/20 backdrop-blur border-green-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-300 flex items-center gap-2">
                <Users className="w-4 h-4" />
                总访问人数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{filteredSummary.totalVisitors.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/20 to-purple-600/20 backdrop-blur border-purple-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-purple-300 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                总下单人数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{filteredSummary.totalOrders.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-500/20 to-orange-600/20 backdrop-blur border-orange-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-300 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                总核销金额
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">¥{filteredSummary.totalRedeemAmount.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-500/20 to-red-600/20 backdrop-blur border-red-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-300 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                总核销券数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{filteredSummary.totalRedeemCount.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 backdrop-blur border-yellow-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-300 flex items-center gap-2">
                <Star className="w-4 h-4" />
                新增评价数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{filteredSummary.newReviews.toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>

        {/* 数据表格 */}
        <Card className="bg-gray-800/50 backdrop-blur border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Store className="w-5 h-5" />
              门店数据明细
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-700 hover:bg-gray-700/50">
                    <TableHead className="text-gray-300">日期</TableHead>
                    <TableHead className="text-gray-300">门店</TableHead>
                    <TableHead className="text-gray-300">曝光人数</TableHead>
                    <TableHead className="text-gray-300">访问人数</TableHead>
                    <TableHead className="text-gray-300">下单人数</TableHead>
                    <TableHead className="text-gray-300">核销金额</TableHead>
                    <TableHead className="text-gray-300">核销券数</TableHead>
                    <TableHead className="text-gray-300">新增评价</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((item, index) => (
                    <TableRow key={index} className="border-gray-700 hover:bg-gray-700/50">
                      <TableCell className="text-gray-300">{item.日期}</TableCell>
                      <TableCell className="text-gray-300">{item.门店名称}</TableCell>
                      <TableCell className="text-gray-300">{item['客流分析'] || 0}</TableCell>
                      <TableCell className="text-gray-300">{item['客流分析_4'] || 0}</TableCell>
                      <TableCell className="text-gray-300">{item['客流分析_10'] || 0}</TableCell>
                      <TableCell className="text-gray-300">¥{item['交易分析'] || 0}</TableCell>
                      <TableCell className="text-gray-300">{item['交易分析_4'] || 0}</TableCell>
                      <TableCell className="text-gray-300">{item['评价分析'] || 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {filteredData.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                暂无数据
              </div>
            )}
          </CardContent>
        </Card>

        {/* 数据说明 */}
        <div className="mt-6 text-center text-gray-400 text-sm">
          <p>
            数据日期：{dataDate || '—'}
            {fetchedAt && ` · 入库时间：${new Date(fetchedAt).toLocaleString('zh-CN')}`}
          </p>
          <p className="mt-1">共 {filteredData.length} 条记录 | 门店数：{stores.length}</p>
        </div>
      </div>
    </div>
  );
}
