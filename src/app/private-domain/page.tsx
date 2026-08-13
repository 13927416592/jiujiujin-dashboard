"use client";

import { useState } from "react";
import { Users, TrendingUp, Target, Bell, ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";

const mockData = {
  userScale: { total: "8.5 万", monthlyGrowth: "+12.5%", weeklyActive: "2.3 万", retention: "68%" },
  conversionFunnel: [
    { stage: "访问用户", count: "6.66 万", rate: "100%" },
    { stage: "留资用户", count: "1,256", rate: "1.9%" },
    { stage: "成交用户", count: "870", rate: "69.3%" },
  ],
  tagSystem: [
    { name: "高价值客户", count: 1256, color: "#7C5CFF" },
    { name: "活跃用户", count: 2341, color: "#69E7FF" },
    { name: "沉睡用户", count: 892, color: "#FF6B6B" },
    { name: "新客户", count: 567, color: "#62FAD3" },
  ],
  activationTimeline: [
    { date: "08-10", event: "推送金价提醒", users: "1,256" },
    { date: "08-11", event: "发送优惠券", users: "892" },
    { date: "08-12", event: "会员日活动", users: "2,341" },
    { date: "08-13", event: "推送回收服务", users: "567" },
  ],
};

export default function PrivateDomainPage() {
  const [data] = useState(mockData);

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 页面标题 */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#F7FAFF]">私域运营</h1>
            <p className="text-sm text-[#9AA7C7] mt-1">用户规模与转化漏斗分析</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <Clock className="w-4 h-4 text-[#9AA7C7]" />
            <span className="text-xs text-[#9AA7C7]">数据更新：2026-08-13 09:00</span>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-6 space-y-6">
        {/* 用户规模指标 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-[#7C5CFF]" />
              <span className="text-sm text-[#9AA7C7]">总用户数</span>
            </div>
            <div className="text-2xl font-bold text-[#F7FAFF]">{data.userScale.total}</div>
            <div className="flex items-center gap-1 mt-2 text-xs text-[#62FAD3]">
              <ArrowUpRight className="w-3 h-3" />
              <span>月增长 {data.userScale.monthlyGrowth}</span>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-[#69E7FF]" />
              <span className="text-sm text-[#9AA7C7]">周活跃</span>
            </div>
            <div className="text-2xl font-bold text-[#F7FAFF]">{data.userScale.weeklyActive}</div>
            <div className="text-xs text-[#9AA7C7] mt-2">活跃率 27%</div>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-[#62FAD3]" />
              <span className="text-sm text-[#9AA7C7]">留存率</span>
            </div>
            <div className="text-2xl font-bold text-[#F7FAFF]">{data.userScale.retention}</div>
            <div className="text-xs text-[#9AA7C7] mt-2">7 日留存</div>
          </div>

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-[#FFB86B]" />
              <span className="text-sm text-[#9AA7C7]">待激活</span>
            </div>
            <div className="text-2xl font-bold text-[#F7FAFF]">892</div>
            <div className="text-xs text-[#FFB86B] mt-2">沉睡用户</div>
          </div>
        </div>

        {/* 转化漏斗 + 标签体系 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 转化漏斗 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">转化漏斗</h3>
            <div className="space-y-4">
              {data.conversionFunnel.map((stage, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="w-24 text-sm text-[#9AA7C7]">{stage.stage}</div>
                  <div className="flex-1">
                    <div className="h-8 bg-white/5 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#7C5CFF] to-[#69E7FF] rounded-lg flex items-center px-3"
                        style={{ width: stage.rate }}
                      >
                        <span className="text-xs font-medium text-white">{stage.count}</span>
                      </div>
                    </div>
                  </div>
                  <div className="w-16 text-right text-sm font-medium text-[#F7FAFF]">{stage.rate}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 标签体系 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">用户标签分布</h3>
            <div className="grid grid-cols-2 gap-3">
              {data.tagSystem.map((tag, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#F7FAFF]">{tag.name}</div>
                    <div className="text-xs text-[#9AA7C7]">{tag.count} 人</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 激活时间线 */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">用户激活时间线</h3>
          <div className="space-y-3">
            {data.activationTimeline.map((item, index) => (
              <div key={index} className="flex items-center gap-4 p-3 bg-white/5 rounded-lg">
                <div className="w-16 text-xs text-[#9AA7C7]">{item.date}</div>
                <div className="w-2 h-2 rounded-full bg-[#7C5CFF]" />
                <div className="flex-1 text-sm text-[#F7FAFF]">{item.event}</div>
                <div className="text-sm font-medium text-[#69E7FF]">{item.users} 人</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
