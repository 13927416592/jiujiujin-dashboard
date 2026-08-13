"use client";

import { useState } from "react";
import { Users, Clock, CheckCircle, AlertCircle, ArrowUpRight, ArrowDownRight } from "lucide-react";

const mockData = {
  departments: [
    {
      name: "客服部",
      kpi: [
        { label: "响应时长", value: "2.3 分钟", target: "≤3 分钟", status: "达标" },
        { label: "解决率", value: "92%", target: "≥90%", status: "达标" },
        { label: "满意度", value: "4.6/5", target: "≥4.5", status: "达标" },
        { label: "投诉率", value: "1.2%", target: "≤2%", status: "达标" },
      ],
      issues: [
        { title: "高峰期响应慢", severity: "中", date: "08-12" },
        { title: "退货流程咨询多", severity: "低", date: "08-11" },
      ],
    },
    {
      name: "门店管理部",
      kpi: [
        { label: "巡检完成率", value: "88%", target: "≥95%", status: "未达标" },
        { label: "问题整改率", value: "76%", target: "≥90%", status: "未达标" },
        { label: "培训完成率", value: "95%", target: "≥90%", status: "达标" },
        { label: "客诉处理", value: "24 小时", target: "≤48 小时", status: "达标" },
      ],
      issues: [
        { title: "3 家门店巡检逾期", severity: "高", date: "08-13" },
        { title: "陈列标准不统一", severity: "中", date: "08-10" },
      ],
    },
  ],
  collaborationMetrics: {
    totalTasks: 156,
    completedTasks: 128,
    pendingTasks: 28,
    overdueTasks: 5,
  },
};

export default function CollaborationPage() {
  const [selectedDept, setSelectedDept] = useState(0);
  const [data] = useState(mockData);
  const dept = data.departments[selectedDept];

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 页面标题 */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#F7FAFF]">跨部门协同</h1>
            <p className="text-sm text-[#9AA7C7] mt-1">部门绩效与协同效率监控</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <Clock className="w-4 h-4 text-[#9AA7C7]" />
            <span className="text-xs text-[#9AA7C7]">数据更新：2026-08-13 09:00</span>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-6 space-y-6">
        {/* 协同指标 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="text-sm text-[#9AA7C7] mb-2">总任务数</div>
            <div className="text-2xl font-bold text-[#F7FAFF]">{data.collaborationMetrics.totalTasks}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="text-sm text-[#9AA7C7] mb-2">已完成</div>
            <div className="text-2xl font-bold text-[#62FAD3]">{data.collaborationMetrics.completedTasks}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="text-sm text-[#9AA7C7] mb-2">进行中</div>
            <div className="text-2xl font-bold text-[#69E7FF]">{data.collaborationMetrics.pendingTasks}</div>
          </div>
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-5">
            <div className="text-sm text-[#9AA7C7] mb-2">已逾期</div>
            <div className="text-2xl font-bold text-[#FF6B6B]">{data.collaborationMetrics.overdueTasks}</div>
          </div>
        </div>

        {/* 部门切换 */}
        <div className="flex gap-2">
          {data.departments.map((dept, index) => (
            <button
              key={index}
              onClick={() => setSelectedDept(index)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                selectedDept === index
                  ? "bg-[#7C5CFF] text-white"
                  : "bg-white/5 text-[#9AA7C7] hover:bg-white/10"
              }`}
            >
              {dept.name}
            </button>
          ))}
        </div>

        {/* 部门 KPI + 问题清单 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* KPI 指标 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">{dept.name} - KPI 指标</h3>
            <div className="space-y-3">
              {dept.kpi.map((kpi, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                  <div>
                    <div className="text-sm font-medium text-[#F7FAFF]">{kpi.label}</div>
                    <div className="text-xs text-[#9AA7C7] mt-0.5">目标：{kpi.target}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-[#F7FAFF]">{kpi.value}</div>
                    <div
                      className={`text-xs mt-0.5 ${
                        kpi.status === "达标" ? "text-[#62FAD3]" : "text-[#FF6B6B]"
                      }`}
                    >
                      {kpi.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 问题清单 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">待解决问题</h3>
            <div className="space-y-3">
              {dept.issues.map((issue, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                  <AlertCircle
                    className={`w-5 h-5 ${
                      issue.severity === "高"
                        ? "text-[#FF6B6B]"
                        : issue.severity === "中"
                        ? "text-[#FFB86B]"
                        : "text-[#69E7FF]"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#F7FAFF]">{issue.title}</div>
                    <div className="text-xs text-[#9AA7C7] mt-0.5">{issue.date}</div>
                  </div>
                  <div
                    className={`px-2 py-1 rounded text-xs ${
                      issue.severity === "高"
                        ? "bg-[#FF6B6B]/20 text-[#FF6B6B]"
                        : issue.severity === "中"
                        ? "bg-[#FFB86B]/20 text-[#FFB86B]"
                        : "bg-[#69E7FF]/20 text-[#69E7FF]"
                    }`}
                  >
                    {issue.severity}
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
