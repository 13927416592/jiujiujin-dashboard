import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    const jsonPath = path.join(process.cwd(), 'src', 'exporters', 'output', 'meituan_report_2026-08-14.json');
    
    if (!fs.existsSync(jsonPath)) {
      return NextResponse.json({ error: '数据文件不存在，请先运行数据导出脚本' }, { status: 404 });
    }

    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(fileContent);

    // 计算汇总指标
    const totalExposure = data.reduce((sum: number, item: any) => sum + (Number(item['客流分析']) || 0), 0);
    const totalVisits = data.reduce((sum: number, item: any) => sum + (Number(item['客流分析_4']) || 0), 0);
    const totalOrders = data.reduce((sum: number, item: any) => sum + (Number(item['客流分析_10']) || 0), 0);
    const totalSales = data.reduce((sum: number, item: any) => sum + (Number(item['交易分析']) || 0), 0);
    const totalCoupons = data.reduce((sum: number, item: any) => sum + (Number(item['交易分析_4']) || 0), 0);
    const totalReviews = data.reduce((sum: number, item: any) => sum + (Number(item['评价分析']) || 0), 0);

    // 获取门店列表
    const stores = [...new Set(data.map((item: any) => item.门店名称))];

    // 按日期分组
    const byDate: any = {};
    data.forEach((item: any) => {
      if (!byDate[item.日期]) {
        byDate[item.日期] = {
          exposure: 0,
          visits: 0,
          orders: 0,
          sales: 0,
          coupons: 0,
          reviews: 0,
        };
      }
      byDate[item.日期].exposure += Number(item['客流分析']) || 0;
      byDate[item.日期].visits += Number(item['客流分析_4']) || 0;
      byDate[item.日期].orders += Number(item['客流分析_10']) || 0;
      byDate[item.日期].sales += Number(item['交易分析']) || 0;
      byDate[item.日期].coupons += Number(item['交易分析_4']) || 0;
      byDate[item.日期].reviews += Number(item['评价分析']) || 0;
    });

    const trendData = Object.entries(byDate)
      .map(([date, stats]: [string, any]) => ({
        date,
        ...stats,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          exposure: totalExposure,
          visits: totalVisits,
          orders: totalOrders,
          sales: totalSales,
          coupons: totalCoupons,
          reviews: totalReviews,
          storeCount: stores.length,
          recordCount: data.length,
        },
        trend: trendData,
        stores,
        raw: data.slice(0, 100), // 只返回前 100 条
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
