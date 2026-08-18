import { NextResponse } from 'next/server';
import {
  getLatestSnapshot,
  getRecentSnapshots,
  type Platform,
} from '@/storage/database/snapshot-repo';

const ALLOWED_PLATFORMS: Platform[] = ['alipay', 'meituan', 'douyin'];

/**
 * 读取平台最新快照（看板通用）
 *   GET /api/snapshots/latest?platform=alipay
 *
 * 可选参数：
 *   recent=30  同时返回最近 N 天的快照元信息（不含 raw_data，用于趋势/历史）
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform') as Platform | null;

  if (!platform || !ALLOWED_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: `platform 参数非法，需为 ${ALLOWED_PLATFORMS.join('/')}` },
      { status: 400 }
    );
  }

  const recentParam = searchParams.get('recent');
  const recentLimit = recentParam ? Number.parseInt(recentParam, 10) : 0;

  try {
    const latest = await getLatestSnapshot(platform);

    if (!latest) {
      return NextResponse.json(
        { error: `暂无 ${platform} 数据` },
        { status: 404 }
      );
    }

    let history: Awaited<ReturnType<typeof getRecentSnapshots>> = [];
    if (Number.isFinite(recentLimit) && recentLimit > 0) {
      history = await getRecentSnapshots(platform, Math.min(recentLimit, 90));
      // 按日期升序返回，便于前端画趋势
      history = [...history].sort((a, b) =>
        a.data_date < b.data_date ? -1 : 1
      );
    }

    return NextResponse.json({
      platform: latest.platform,
      data_date: latest.data_date,
      fetched_at: latest.fetched_at,
      source: latest.source,
      raw_data: latest.raw_data,
      ...(recentLimit > 0 ? { history } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('读取快照失败:', message);
    return NextResponse.json(
      { error: '读取数据失败', message },
      { status: 500 }
    );
  }
}
