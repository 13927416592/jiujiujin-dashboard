/**
 * 美团数据导出 API
 * 
 * 触发 Playwright 自动化抓取美团经营宝数据
 * 
 * POST /api/data/meituan/export
 * Body: { forceLogin?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { MeituanExporter, DEFAULT_MEITUAN_CONFIG } from '@/exporters/meituan';
import * as path from 'path';
import * as fs from 'fs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const forceLogin = body.forceLogin || false;

    const outputDir = path.join(process.cwd(), 'src/exporters/output');
    const cookieFile = path.join(process.cwd(), 'src/exporters/cookies/meituan.json');

    // 检查 Cookie 是否存在
    if (!fs.existsSync(cookieFile) || forceLogin) {
      return NextResponse.json({
        success: false,
        message: '需要手动登录',
        action: 'login',
        cookieFile
      }, { status: 401 });
    }

    // 创建导出器
    const exporter = new MeituanExporter({
      ...DEFAULT_MEITUAN_CONFIG,
      outputDir,
      cookieFile,
      headless: true
    });

    // 初始化并加载 Cookie
    await exporter.init();
    await exporter.loadCookies();

    // 执行导出
    const result = await exporter.export();

    return NextResponse.json({
      success: true,
      message: '数据导出成功',
      outputDir,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('[Meituan API] 导出失败:', error);
    return NextResponse.json({
      success: false,
      message: error.message || '导出失败'
    }, { status: 500 });
  }
}

/**
 * 获取美团数据状态
 * 
 * GET /api/data/meituan/status
 */
export async function GET() {
  try {
    const outputDir = path.join(process.cwd(), 'src/exporters/output');
    const cookieFile = path.join(process.cwd(), 'src/exporters/cookies/meituan.json');

    // 检查最新数据文件
    const files = fs.readdirSync(outputDir)
      .filter(f => f.startsWith('meituan_full_'))
      .sort()
      .reverse();

    const latestFile = files[0] || null;
    const hasCookie = fs.existsSync(cookieFile);

    return NextResponse.json({
      hasCookie,
      latestExport: latestFile,
      exportCount: files.length
    });

  } catch (error: any) {
    return NextResponse.json({
      hasCookie: false,
      latestExport: null,
      exportCount: 0
    });
  }
}
