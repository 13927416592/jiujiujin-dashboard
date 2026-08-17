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

export default function MeituanPage() {
  const [data, setData] = useState<MeituanData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStore, setSelectedStore] = useState('all');
  const [selectedDate, setSelectedDate] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const res = await fetch('/api/meituan-data');
      const result = await res.json();
      
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message);
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

  // 计算汇总指标
  const summary = {
    totalExposure: filteredData.reduce((sum, item) => sum + (Number(item['客流分析']) || 0), 0),
    totalVisitors: filteredData.reduce((sum, item) => sum + (Number(item['客流分析_4']) || 0), 0),
    totalOrders: filteredData.reduce((sum, item) => sum + (Number(item['客流分析_10']) || 0), 0),
    totalRedeemAmount: filteredData.reduce((sum, item) => sum + (Number(item['交易分析']) || 0), 0),
    totalRedeemCount: filteredData.reduce((sum, item) => sum + (Number(item['交易分析_4']) || 0), 0),
    newReviews: filteredData.reduce((sum, item) => sum + (Number(item['评价分析']) || 0), 0),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-gray-400">加载美团数据中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-400 mb-4">加载失败：{error}</p>
          <button onClick={loadData} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
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
          <p className="text-gray-400">实时监控美团平台运营数据</p>
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
              <div className="text-3xl font-bold text-white">{summary.totalExposure.toLocaleString()}</div>
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
              <div className="text-3xl font-bold text-white">{summary.totalVisitors.toLocaleString()}</div>
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
              <div className="text-3xl font-bold text-white">{summary.totalOrders.toLocaleString()}</div>
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
              <div className="text-3xl font-bold text-white">¥{summary.totalRedeemAmount.toLocaleString()}</div>
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
              <div className="text-3xl font-bold text-white">{summary.totalRedeemCount.toLocaleString()}</div>
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
              <div className="text-3xl font-bold text-white">{summary.newReviews.toLocaleString()}</div>
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
          <p>数据更新时间：{new Date().toLocaleString('zh-CN')}</p>
          <p className="mt-1">共 {filteredData.length} 条记录 | 门店数：{stores.length}</p>
        </div>
      </div>
    </div>
  );
}
