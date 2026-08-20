import { NextRequest, NextResponse } from "next/server";
import { parseAlipayRaw } from "@/lib/alipay-parser";
import { aggregateAlipay, type RangeKey } from "@/lib/alipay-agg";
import { getLatestSnapshots } from "@/storage/database/snapshot-repo";

// 复用解析器的类型
type AlipayParsed = ReturnType<typeof parseAlipayRaw>;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidRange(r: string | null): r is RangeKey {
  return r === "1d" || r === "7d" || r === "30d";
}

/** 把解析器输出适配成聚合模块的 DailySnapshot 结构 */
function toDailySnapshot(date: string, parsed: AlipayParsed) {
  return {
    date,
    overview: parsed.overview,
    traffic: {
      overview: { metrics: parsed.traffic.overview.metrics },
      miniProgramTraffic: { metrics: parsed.traffic.miniProgramTraffic.metrics },
      lifeAccountTraffic: { metrics: parsed.traffic.lifeAccountTraffic.metrics },
      fanGroupTraffic: { metrics: parsed.traffic.fanGroupTraffic.metrics },
    },
    lifeAccountTraffic: { metrics: parsed.lifeAccountTraffic.metrics },
    fanGroupTraffic: { metrics: parsed.fanGroupTraffic.metrics },
    miniPrograms: parsed.miniPrograms,
  };
}

export async function GET(req: NextRequest) {
  try {
    const requested = req.nextUrl.searchParams.get("days");
    const range: RangeKey = isValidRange(requested) ? requested : "7d";
    const limit = range === "1d" ? 1 : range === "7d" ? 7 : 30;

    const snaps = await getLatestSnapshots("alipay", limit);

    if (!snaps || snaps.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "暂无支付宝数据，请先运行抓取脚本上传数据",
          range,
          dates: [],
        },
        { status: 404 }
      );
    }

    // 每条快照解析其 raw_data，按 data_date 去重（取最新 fetched_at）
    const byDate = new Map<string, AlipayParsed>();
    const sorted = [...snaps].sort((a, b) =>
      String(b.fetched_at ?? "").localeCompare(String(a.fetched_at ?? ""))
    );
    for (const s of sorted) {
      if (byDate.has(s.data_date)) continue;
      const raw = (s.raw_data ?? {}) as Record<string, unknown>;
      byDate.set(s.data_date, parseAlipayRaw(raw, s.data_date));
    }

    const daily = [...byDate.entries()].map(([date, parsed]) =>
      toDailySnapshot(date, parsed)
    );

    const aggregated = aggregateAlipay(daily, range);

    return NextResponse.json({
      success: true,
      range,
      days: aggregated.days,
      availableDays: daily.length,
      date: aggregated.latestDate,
      dates: aggregated.dates,
      overview: aggregated.overview,
      traffic: {
        overview: aggregated.traffic.overview,
        miniProgramTraffic: aggregated.traffic.miniProgramTraffic,
        lifeAccountTraffic: aggregated.traffic.lifeAccountTraffic,
        fanGroupTraffic: aggregated.traffic.fanGroupTraffic,
      },
      miniPrograms: aggregated.miniPrograms,
      lifeAccountTraffic: aggregated.lifeAccountTraffic,
      fanGroupTraffic: aggregated.fanGroupTraffic,
      trend: aggregated.trend,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("加载支付宝数据失败:", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "未知错误" },
      { status: 500 }
    );
  }
}
