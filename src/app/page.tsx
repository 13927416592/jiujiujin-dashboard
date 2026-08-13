"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  LayoutDashboard, 
  ShoppingBag, 
  CreditCard, 
  FileText, 
  Users, 
  Workflow, 
  Target 
} from "lucide-react";

const navItems = [
  { href: "/alipay", label: "支付宝运营", icon: CreditCard, color: "#7C5CFF" },
  { href: "/meituan", label: "美团运营", icon: ShoppingBag, color: "#69E7FF" },
  { href: "/content", label: "内容矩阵", icon: FileText, color: "#62FAD3" },
  { href: "/private-domain", label: "私域运营", icon: Users, color: "#FFB86B" },
  { href: "/collaboration", label: "跨部门协同", icon: Workflow, color: "#FF6B6B" },
  { href: "/actions", label: "行动计划", icon: Target, color: "#7C5CFF" },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#070A14] text-[#F7FAFF]">
      {/* 页面标题 */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#F7FAFF]">运营数据看板</h1>
            <p className="text-sm text-[#9AA7C7] mt-1">久久金集团运营管理系统</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <LayoutDashboard className="w-4 h-4 text-[#7C5CFF]" />
            <span className="text-xs text-[#9AA7C7]">数据更新：2026-08-13 09:00</span>
          </div>
        </div>
      </div>

      {/* 导航卡片 */}
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-all duration-300"
              >
                <div className="flex items-start justify-between">
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${item.color}20` }}
                  >
                    <Icon className="w-6 h-6" style={{ color: item.color }} />
                  </div>
                  <div className="text-[#9AA7C7] group-hover:text-[#F7FAFF] transition-colors">
                    →
                  </div>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-semibold text-[#F7FAFF] group-hover:text-white transition-colors">
                    {item.label}
                  </h3>
                  <p className="text-sm text-[#9AA7C7] mt-1">
                    查看 {item.label} 数据详情
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
