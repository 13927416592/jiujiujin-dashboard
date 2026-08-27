import { NextRequest, NextResponse } from "next/server";
import { getOrderRows, getLatestOrderDate, getOrderCoverage } from "@/storage/database/order-repo";
import { aggregateOrders, deltaRatio, type OrderAggregate } from "@/lib/order-agg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RangeKey = "1d" | "7d" | "30d";

function isValidRange(r: string | null): r is RangeKey {
  return r === "1d" || r === "7d" || r === "30d";
}

interface OrdersFullResponse {
  success: boolean;
  error?: string;
  range: RangeKey;
  latestDate: string | null;
  coverage: { totalDays: number; minDate: string | null; maxDate: string | null };
  data: OrderAggregate | null;
  /** 上一周期 KPI，用于前端算环比。 */
  previous: {
    orderCount: number;
    amount: number;
    netWeight: number;
    avgOrderAmount: number;
  } | null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const requested = sp.get("days");
  const range: RangeKey = isValidRange(requested) ? requested : "7d";
  const limit = range === "1d" ? 1 : range === "7d" ? 7 : 30;

  const platform = sp.get("platform");
  const sourceGroup = sp.get("source");
  const storeCode = sp.get("store");

  try {
    const [rows, latestDate, coverage] = await Promise.all([
      getOrderRows(limit, { platform: platform ?? undefined, sourceGroup: sourceGroup ?? undefined, storeCode: storeCode ?? undefined }),
      getLatestOrderDate(),
      getOrderCoverage(),
    ]);

    if (!rows || rows.length === 0) {
      const empty: OrdersFullResponse = {
        success: false,
        error: "暂无完成订单数据，请先运行 SmartBI 每日导出并导入",
        range,
        latestDate,
        coverage,
        data: null,
        previous: null,
      };
      return NextResponse.json(empty, { status: 404 });
    }

    // 当前周期：取最近 limit 个日期
    const allDates = [...new Set(rows.map((r) => r.data_date))].sort();
    const curDates = new Set(allDates.slice(-limit));
    const curRows = rows.filter((r) => curDates.has(r.data_date));
    const prevRows = rows.filter((r) => !curDates.has(r.data_date)); // 更早的同等长度区间（如果有）

    const data = aggregateOrders(curRows);

    let previous: OrdersFullResponse["previous"] = null;
    if (prevRows.length > 0) {
      const pa = aggregateOrders(prevRows).kpi;
      previous = {
        orderCount: pa.orderCount,
        amount: pa.amount,
        netWeight: pa.netWeight,
        avgOrderAmount: pa.avgOrderAmount,
      };
    }

    const resp: OrdersFullResponse = {
      success: true,
      range,
      latestDate,
      coverage,
      data,
      previous,
    };
    return NextResponse.json(resp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/orders/full] 聚合失败:", e);
    return NextResponse.json(
      { success: false, error: `订单聚合失败: ${msg}`, range, data: null },
      { status: 500 }
    );
  }
}
