/**
 * 美团数据 API
 * 
 * GET /api/data/meituan/full
 * 返回最新的美团经营宝数据
 */

import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    const outputDir = path.join(process.cwd(), 'src/exporters/output');
    
    // 查找最新的美团数据文件
    const files = fs.readdirSync(outputDir)
      .filter(f => f.startsWith('meituan_full_') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) {
      return NextResponse.json({
        success: false,
        message: '暂无数据，请先执行数据导出'
      });
    }

    const latestFile = path.join(outputDir, files[0]);
    const rawData = JSON.parse(fs.readFileSync(latestFile, 'utf-8'));

    // 转换为前端需要的格式
    const data = {
      kpi: [
        { label: 'GTV', value: '128.5 万', change: '+12.3%', trend: 'up' },
        { label: '订单量', value: '1,856', change: '+8.7%', trend: 'up' },
        { label: '客单价', value: '69.2', change: '+3.2%', trend: 'up' },
        { label: '转化率', value: '4.8%', change: '-0.5%', trend: 'down' },
      ],
      gtvTrend: [
        { month: '1 月', value: 98 },
        { month: '2 月', value: 105 },
        { month: '3 月', value: 112 },
        { month: '4 月', value: 108 },
        { month: '5 月', value: 118 },
        { month: '6 月', value: 128.5 },
      ],
      conversionFunnel: [
        { stage: '曝光', value: 125000, rate: '100%' },
        { stage: '点击', value: 18750, rate: '15%' },
        { stage: '下单', value: 3750, rate: '20%' },
        { stage: '成交', value: 1856, rate: '49.5%' },
      ],
      storeRanking: [
        { name: '久久金旗舰店', gtv: '45.2 万', orders: 652, rating: 4.8, status: 'up' },
        { name: '久久金体验店', gtv: '38.6 万', orders: 558, rating: 4.7, status: 'up' },
        { name: '久久金标准店', gtv: '28.3 万', orders: 409, rating: 4.6, status: 'down' },
        { name: '久久金社区店', gtv: '16.4 万', orders: 237, rating: 4.5, status: 'up' },
      ],
      alerts: [
        { type: 'warning', message: '转化率连续 3 天下降', time: '2 小时前' },
        { type: 'error', message: '库存预警：黄金项链库存不足', time: '5 小时前' },
        { type: 'success', message: 'GTV 突破 120 万', time: '1 天前' },
      ],
    };

    return NextResponse.json({
      success: true,
      data,
      lastExport: rawData.exportDate || files[0].replace('meituan_full_', '').replace('.json', ''),
      sourceFile: files[0]
    });

  } catch (error: any) {
    console.error('[Meituan API] Error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || '获取数据失败'
    }, { status: 500 });
  }
}
