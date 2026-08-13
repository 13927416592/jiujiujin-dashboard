"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Users,
  Play,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
} from "lucide-react";

const mockData = {
  platforms: [
    { name: "抖音", followers: "12.5 万", videos: 156, views: "285 万", engagement: "4.8%" },
    { name: "快手", followers: "8.3 万", videos: 128, views: "156 万", engagement: "3.9%" },
    { name: "小红书", followers: "5.6 万", videos: 89, views: "98 万", engagement: "5.2%" },
    { name: "视频号", followers: "3.2 万", videos: 67, views: "52 万", engagement: "4.1%" },
  ],
  contentPerformance: [
    { title: "黄金回收流程详解", platform: "抖音", views: "12.5 万", likes: "8,562", comments: "1,256", shares: "2,341" },
    { title: "今日金价播报", platform: "抖音", views: "9.8 万", likes: "6,234", comments: "892", shares: "1,567" },
    { title: "黄金保养小技巧", platform: "小红书", views: "5.6 万", likes: "4,123", comments: "567", shares: "892" },
    { title: "黄金回收避坑指南", platform: "快手", views: "4.2 万", likes: "3,456", comments: "445", shares: "678" },
  ],
  monthlyTrend: [
    { month: "3 月", views: 180, engagement: 4.2 },
    { month: "4 月", views: 210, engagement: 4.5 },
    { month: "5 月", views: 245, engagement: 4.7 },
    { month: "6 月", views: 268, engagement: 4.8 },
    { month: "7 月", views: 285, engagement: 4.8 },
  ],
};

export default function ContentPage() {
  const [data, setData] = useState(mockData);
  const [selectedPlatform, setSelectedPlatform] = useState("全部");

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 页面标题 */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#F7FAFF]">内容矩阵</h1>
            <p className="text-sm text-[#9AA7C7] mt-1">多平台内容运营数据监控</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <Clock className="w-4 h-4 text-[#9AA7C7]" />
            <span className="text-xs text-[#9AA7C7]">数据更新：2026-08-13 09:00</span>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-6 space-y-6">
        {/* 平台概览 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.platforms.map((platform, index) => (
            <div
              key={index}
              className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5 hover:bg-white/8 transition-all duration-200 hover:shadow-[0_0_16px_rgba(124,92,255,0.12)]"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[#F7FAFF]">{platform.name}</span>
                <Play className="w-4 h-4 text-[#7C5CFF]" />
              </div>
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-[#9AA7C7]">粉丝数</div>
                  <div className="text-lg font-bold text-[#F7FAFF]">{platform.followers}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                  <div>
                    <div className="text-xs text-[#9AA7C7]">视频数</div>
                    <div className="text-sm font-medium text-[#F7FAFF]">{platform.videos}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#9AA7C7]">播放量</div>
                    <div className="text-sm font-medium text-[#F7FAFF]">{platform.views}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 内容表现 + 月度趋势 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 内容表现 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">热门内容 TOP4</h3>
            <div className="space-y-3">
              {data.contentPerformance.map((content, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 p-3 bg-white/5 rounded-lg hover:bg-white/8 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#7C5CFF]/20 flex items-center justify-center text-sm font-bold text-[#7C5CFF]">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#F7FAFF]">{content.title}</div>
                    <div className="text-xs text-[#9AA7C7] mt-0.5">{content.platform}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-[#F7FAFF]">{content.views}</div>
                    <div className="text-xs text-[#9AA7C7] mt-0.5">播放</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 月度趋势 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">播放量趋势（近 5 月）</h3>
            <div className="space-y-3">
              {data.monthlyTrend.map((item, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-xs text-[#9AA7C7] w-12">{item.month}</span>
                  <div className="flex-1 h-8 bg-white/5 rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#7C5CFF] to-[#69E7FF] rounded-lg flex items-center justify-end px-2"
                      style={{ width: `${(item.views / 300) * 100}%` }}
                    >
                      <span className="text-xs font-medium text-white">{item.views}万</span>
                    </div>
                  </div>
                  <span className="text-xs text-[#9AA7C7] w-12 text-right">{item.engagement}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
