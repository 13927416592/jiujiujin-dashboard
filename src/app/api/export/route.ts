/**
 * 数据导出 API 路由
 * 
 * POST /api/export/run - 执行数据导出
 * GET /api/export/status - 查询导出状态
 */

import { NextRequest, NextResponse } from 'next/server';
import { exportPlatform, exportAllPlatforms, getRegisteredPlatforms } from '@/exporters';
import { Platform } from '@/exporters/types';

/**
 * POST /api/export/run
 * 执行数据导出
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform, all = false } = body;
    
    let results;
    
    if (all) {
      // 导出所有平台
      results = await exportAllPlatforms();
    } else if (platform) {
      // 导出单个平台
      const result = await exportPlatform(platform as Platform);
      results = [result];
    } else {
      return NextResponse.json(
        { error: '请指定 platform 或设置 all=true' },
        { status: 400 }
      );
    }
    
    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    return NextResponse.json({
      success: true,
      total: results.length,
      successCount,
      failCount,
      results
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/export/status
 * 查询导出状态
 */
export async function GET() {
  try {
    const platforms = getRegisteredPlatforms();
    
    return NextResponse.json({
      success: true,
      platforms,
      platformCount: platforms.length
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
