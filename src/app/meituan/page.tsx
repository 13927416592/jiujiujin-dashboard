"use client";

import { useEffect, useState } from "react";
import {
  Store,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  ShoppingCart,
  Star,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Download,
  RefreshCw,
} from "lucide-react";

// 模拟数据
const mockData = {
  kpi: [
    { label: "GTV", value: "128.5 万", change: "+12.3%", trend: "up" },
    { label: "订单量", value: "1,856", change: "+8.7%", trend: "up" },
    { label: "客单价", value: "69.2", change: "+3.2%", trend: "up" },
    { label: "转化率", value: "4.8%", change: "-0.5%", trend: "down" },
  ],
  gtvTrend: [
    { month: "1 月", value: 98 },
    { month: "2 月", value: 105 },
    { month: "3 月", value: 112 },
    { month: "4 月", value: 108 },
    { month: "5 月", value: 118 },
    { month: "6 月", value: 128.5 },
  ],
  conversionFunnel: [
    { stage: "曝光", value: 125000, rate: "100%" },
    { stage: "点击", value: 18750, rate: "15%" },
    { stage: "下单", value: 3750, rate: "20%" },
    { stage: "成交", value: 1856, rate: "49.5%" },
  ],
  storeRanking: [
    { name: "久久金旗舰店", gtv: "45.2 万", orders: 652, rating: 4.8, status: "up" },
    { name: "久久金体验店", gtv: "38.6 万", orders: 558, rating: 4.7, status: "up" },
    { name: "久久金标准店", gtv: "28.3 万", orders: 409, rating: 4.6, status: "down" },
    { name: "久久金社区店", gtv: "16.4 万", orders: 237, rating: 4.5, status: "up" },
  ],
  alerts: [
    { type: "warning", message: "转化率连续 3 天下降", time: "2 小时前" },
    { type: "error", message: "库存预警：黄金项链库存不足", time: "5 小时前" },
    { type: "success", message: "GTV 突破 120 万", time: "1 天前" },
  ],
};

export default function MeituanPage() {
  const [data, setData] = useState<any>(mockData);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      setExporting(true);
      const response = await fetch('/api/data/meituan/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceLogin: false })
      });
      
      const result = await response.json();
      
      if (result.success) {
        alert('数据导出成功！');
        setLastExport(result.timestamp);
      } else if (result.action === 'login') {
        alert('需要手动登录美团后台，请在浏览器中完成登录');
        window.open('/api/data/meituan/login', '_blank');
      } else {
        alert('导出失败：' + result.message);
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 页面标题 */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#F7FAFF]">美团运营</h1>
            <p className="text-sm text-[#9AA7C7] mt-1">美团平台运营数据监控与分析</p>
          </div>
          <div className="flex items-center gap-3">
            {lastExport && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                <Clock className="w-4 h-4 text-[#9AA7C7]" />
                <span className="text-xs text-[#9AA7C7]">上次导出：{new Date(lastExport).toLocaleString('zh-CN')}</span>
              </div>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#7C5CFF] to-[#69E7FF] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${exporting ? 'animate-spin' : ''}`} />
              <span>{exporting ? '导出中...' : '导出数据'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-6 space-y-6">
        {/* KPI 指标卡 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.kpi.map((item: any, index: number) => (
            <div
              key={index}
              className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5 hover:bg-white/8 transition-all duration-200 hover:shadow-[0_0_16px_rgba(124,92,255,0.12)]"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-[#9AA7C7]">{item.label}</span>
                {item.trend === "up" ? (
                  <TrendingUp className="w-4 h-4 text-[#62FAD3]" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-[#FF6B6B]" />
                )}
              </div>
              <div className="text-2xl font-bold text-[#F7FAFF] mb-2">{item.value}</div>
              <div
                className={`flex items-center gap-1 text-xs ${
                  item.trend === "up" ? "text-[#62FAD3]" : "text-[#FF6B6B]"
                }`}
              >
                {item.trend === "up" ? (
                  <ArrowUpRight className="w-3 h-3" />
                ) : (
                  <ArrowDownRight className="w-3 h-3" />
                )}
                <span>{item.change}</span>
                <span className="text-[#9AA7C7] ml-1">较上月</span>
              </div>
            </div>
          ))}
        </div>

        {/* GTV 趋势 + 转化漏斗 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* GTV 趋势 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">GTV 趋势（近 6 个月）</h3>
            <div className="space-y-3">
              {data.gtvTrend.map((item: any, index: number) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-xs text-[#9AA7C7] w-12">{item.month}</span>
                  <div className="flex-1 h-8 bg-white/5 rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#7C5CFF] to-[#69E7FF] rounded-lg flex items-center justify-end px-2"
                      style={{ width: `${(item.value / 130) * 100}%` }}
                    >
                      <span className="text-xs font-medium text-white">{item.value}万</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 转化漏斗 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">转化漏斗</h3>
            <div className="space-y-4">
              {data.conversionFunnel.map((item: any, index: number) => (
                <div key={index} className="flex items-center gap-4">
                  <span className="text-sm text-[#9AA7C7] w-16">{item.stage}</span>
                  <div className="flex-1">
                    <div className="h-10 bg-white/5 rounded-lg overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-[#7C5CFF]/80 to-[#69E7FF]/80 rounded-lg flex items-center px-3"
                        style={{ width: `${(item.value / 125000) * 100}%` }}
                      >
                        <span className="text-xs font-medium text-white">
                          {item.value.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-[#9AA7C7] w-12 text-right">{item.rate}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 门店排名 + 预警 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 门店排名 */}
          <div className="lg:col-span-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">门店 GTV 排名</h3>
            <div className="space-y-3">
              {data.storeRanking.map((store: any, index: number) => (
                <div
                  key={index}
                  className="flex items-center gap-4 p-3 bg-white/5 rounded-lg hover:bg-white/8 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#7C5CFF]/20 flex items-center justify-center text-sm font-bold text-[#7C5CFF]">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#F7FAFF]">{store.name}</div>
                    <div className="text-xs text-[#9AA7C7] mt-0.5">
                      {store.orders} 单 · 评分 {store.rating}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-[#F7FAFF]">{store.gtv}</div>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      {store.status === "up" ? (
                        <TrendingUp className="w-3 h-3 text-[#62FAD3]" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-[#FF6B6B]" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 预警 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">预警通知</h3>
            <div className="space-y-3">
              {data.alerts.map((alert: any, index: number) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 bg-white/5 rounded-lg"
                >
                  {alert.type === "warning" ? (
                    <AlertCircle className="w-4 h-4 text-[#FFB84D] mt-0.5 shrink-0" />
                  ) : alert.type === "error" ? (
                    <AlertCircle className="w-4 h-4 text-[#FF6B6B] mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[#62FAD3] mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1">
                    <div className="text-xs text-[#F7FAFF]">{alert.message}</div>
                    <div className="text-xs text-[#9AA7C7] mt-1">{alert.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
