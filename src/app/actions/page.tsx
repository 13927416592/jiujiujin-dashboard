"use client";

import { useState } from "react";
import { Calendar, Clock, CheckCircle, Circle, AlertCircle, Users } from "lucide-react";

const mockData = {
  milestones: [
    { date: "2026-08-15", title: "完成 Q3 运营方案", status: "进行中", owner: "运营部" },
    { date: "2026-08-20", title: "上线新会员体系", status: "待开始", owner: "产品部" },
    { date: "2026-08-25", title: "支付宝数据接入", status: "已完成", owner: "技术部" },
    { date: "2026-09-01", title: "启动秋季营销", status: "待开始", owner: "市场部" },
  ],
  tasks: [
    {
      category: "数据接入",
      items: [
        { title: "支付宝数据抓取脚本", status: "已完成", owner: "技术部", priority: "高" },
        { title: "美团 API 对接", status: "进行中", owner: "技术部", priority: "高" },
        { title: "抖音数据更新", status: "已完成", owner: "技术部", priority: "中" },
      ],
    },
    {
      category: "运营优化",
      items: [
        { title: "私域用户分层", status: "进行中", owner: "运营部", priority: "中" },
        { title: "内容矩阵扩展", status: "待开始", owner: "内容部", priority: "中" },
        { title: "客服流程优化", status: "待开始", owner: "客服部", priority: "低" },
      ],
    },
    {
      category: "系统建设",
      items: [
        { title: "飞书告警配置", status: "已完成", owner: "技术部", priority: "中" },
        { title: "定时任务部署", status: "已完成", owner: "技术部", priority: "高" },
        { title: "Supabase 迁移", status: "待开始", owner: "技术部", priority: "低" },
      ],
    },
  ],
  ownerDistribution: [
    { name: "技术部", count: 6, color: "#7C5CFF" },
    { name: "运营部", count: 3, color: "#69E7FF" },
    { name: "内容部", count: 2, color: "#62FAD3" },
    { name: "客服部", count: 1, color: "#FFB86B" },
  ],
};

export default function ActionsPage() {
  const [data] = useState(mockData);
  const [expandedCategory, setExpandedCategory] = useState<string | null>("数据接入");

  const getStatusIcon = (status: string) => {
    if (status === "已完成") return <CheckCircle className="w-4 h-4 text-[#62FAD3]" />;
    if (status === "进行中") return <Circle className="w-4 h-4 text-[#69E7FF] fill-[#69E7FF]/20" />;
    return <Circle className="w-4 h-4 text-[#9AA7C7]" />;
  };

  const getPriorityColor = (priority: string) => {
    if (priority === "高") return "text-[#FF6B6B] bg-[#FF6B6B]/10";
    if (priority === "中") return "text-[#FFB86B] bg-[#FFB86B]/10";
    return "text-[#69E7FF] bg-[#69E7FF]/10";
  };

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 页面标题 */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#F7FAFF]">行动计划</h1>
            <p className="text-sm text-[#9AA7C7] mt-1">任务管理与进度跟踪</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <Clock className="w-4 h-4 text-[#9AA7C7]" />
            <span className="text-xs text-[#9AA7C7]">数据更新：2026-08-13 09:00</span>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-6 space-y-6">
        {/* 里程碑时间线 */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
          <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">里程碑</h3>
          <div className="space-y-3">
            {data.milestones.map((milestone, index) => (
              <div key={index} className="flex items-center gap-4 p-3 bg-white/5 rounded-lg">
                <Calendar className="w-4 h-4 text-[#7C5CFF]" />
                <div className="w-24 text-sm text-[#9AA7C7]">{milestone.date}</div>
                <div className="flex-1 text-sm font-medium text-[#F7FAFF]">{milestone.title}</div>
                <div className="flex items-center gap-2">
                  <Users className="w-3 h-3 text-[#9AA7C7]" />
                  <span className="text-xs text-[#9AA7C7]">{milestone.owner}</span>
                </div>
                <div
                  className={`px-2 py-1 rounded text-xs ${
                    milestone.status === "已完成"
                      ? "bg-[#62FAD3]/20 text-[#62FAD3]"
                      : milestone.status === "进行中"
                      ? "bg-[#69E7FF]/20 text-[#69E7FF]"
                      : "bg-white/10 text-[#9AA7C7]"
                  }`}
                >
                  {milestone.status}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 任务列表 + 责任人分布 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 任务列表 */}
          <div className="lg:col-span-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">任务清单</h3>
            <div className="space-y-4">
              {data.tasks.map((category, index) => (
                <div key={index}>
                  <button
                    onClick={() => setExpandedCategory(expandedCategory === category.category ? null : category.category)}
                    className="w-full flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-[#7C5CFF]" />
                      <span className="text-sm font-medium text-[#F7FAFF]">{category.category}</span>
                      <span className="text-xs text-[#9AA7C7]">({category.items.length})</span>
                    </div>
                    <div className="text-xs text-[#9AA7C7]">
                      {expandedCategory === category.category ? "收起" : "展开"}
                    </div>
                  </button>
                  {expandedCategory === category.category && (
                    <div className="mt-2 ml-4 space-y-2">
                      {category.items.map((task, taskIndex) => (
                        <div key={taskIndex} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                          {getStatusIcon(task.status)}
                          <div className="flex-1">
                            <div className="text-sm text-[#F7FAFF]">{task.title}</div>
                            <div className="text-xs text-[#9AA7C7] mt-0.5">{task.owner}</div>
                          </div>
                          <div className={`px-2 py-1 rounded text-xs ${getPriorityColor(task.priority)}`}>
                            {task.priority}
                          </div>
                          <div className="text-xs text-[#9AA7C7] w-16 text-right">{task.status}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 责任人分布 */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
            <h3 className="text-base font-semibold text-[#F7FAFF] mb-4">责任人分布</h3>
            <div className="space-y-3">
              {data.ownerDistribution.map((owner, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: owner.color }} />
                  <div className="flex-1 text-sm text-[#F7FAFF]">{owner.name}</div>
                  <div className="text-sm font-medium text-[#F7FAFF]">{owner.count} 项</div>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-4 border-t border-white/10">
              <div className="text-xs text-[#9AA7C7] mb-2">完成进度</div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#7C5CFF] to-[#62FAD3] rounded-full" style={{ width: "60%" }} />
              </div>
              <div className="text-xs text-[#9AA7C7] mt-2">6/10 任务已完成</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
