import { NextResponse } from 'next/server';
import { getLatestSnapshots } from '@/storage/database/snapshot-repo';
import {
  aggregate,
  collectAllRows,
  computePrevRange,
  matchFilter,
  type MeituanFilter,
} from '@/lib/meituan-agg';

export const dynamic = 'force-dynamic';

/**
 * 美团看板聚合接口（服务端聚合，前端不再对截断明细做求和）。
 *
 * 查询参数（均可选）：
 *   from / to   日期范围 YYYY-MM-DD（默认最近30天，按库里最新日期回看）
 *   province    省份
 *   city        城市
 *   store       门店名称关键字
 *
 * 返回 KPI（含环比）、漏斗、趋势、ROI、门店排行、城市汇总、服务质量与筛选元信息。
 * 明细走分页接口 /api/meituan-rows。
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let from = searchParams.get('from') || '';
    let to = searchParams.get('to') || '';
    const province = searchParams.get('province') || '';
    const city = searchParams.get('city') || '';
    const store = searchParams.get('store') || '';

    // 取最近 90 天快照（覆盖 30 天本期 + 30 天环比期；后续历史更长可调大）
    const snapshots = await getLatestSnapshots('meituan', 90);
    if (snapshots.length === 0) {
      return NextResponse.json(
        { success: false, error: '暂无美团数据，请先在本地运行导出并上传' },
        { status: 404 }
      );
    }

    const allDates = snapshots.map((s) => s.data_date).sort();
    const maxDate = allDates[allDates.length - 1];

    // 默认范围：最近30天（以最新数据日期为终点回看，而不是今天，避免缺数时出现空窗）
    if (!to) to = maxDate;
    if (!from) {
      const d = new Date(to + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - 29);
      from = d.toISOString().slice(0, 10);
    }
    if (from > to) {
      return NextResponse.json({ success: false, error: 'from 不能晚于 to' }, { status: 400 });
    }

    const allRows = collectAllRows(snapshots);

    const curFilter: MeituanFilter = { from, to, province, city, store };
    const curRows = allRows.filter((r) => matchFilter(r, curFilter));

    // 上一周期：与本期等长、紧邻本期之前
    const prevRange = computePrevRange(from, to);
    const prevFilter: MeituanFilter = {
      from: prevRange.from,
      to: prevRange.to,
      province,
      city,
      store,
    };
    const prevRows = allRows.filter((r) => matchFilter(r, prevFilter));

    // 如果上期没有任何数据（首次导入只有30天且选择全部），不强行算环比
    const hasPrev = prevRows.length > 0;
    const result = aggregate(
      curRows,
      hasPrev ? prevRows : [],
      { from, to },
      hasPrev ? prevRange : null
    );

    return NextResponse.json({
      success: true,
      data: result,
      latest_date: maxDate,
      available_dates: allDates,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[meituan-data] 读取失败:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
