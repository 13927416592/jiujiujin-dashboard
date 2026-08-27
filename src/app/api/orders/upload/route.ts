import { NextRequest, NextResponse } from "next/server";
import { ensureBiOrdersTable } from "@/storage/database/ensure-bi-orders";
import { parseBiOrdersBuffer } from "@/exporters/bi-order-parser";
import { replaceDateForImport, upsertOrderLines } from "@/storage/database/order-repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SmartBI 完成订单报表上传接口。
 *
 * 两种用法：
 *  1. multipart/form-data，字段 file=xlsx，可带 date=YYYY-MM-DD（日度完成日期）
 *     - 传 date：整日替换导入（先删后插，幂等），date_basis=completed
 *     - 不传 date：按订单号建单日回填（upsert），date_basis=created-seed
 *  2. POST JSON（已有解析好的行）由其他后端服务调用（预留）。
 */
export async function POST(req: NextRequest) {
  try {
    // 鉴权策略（两种合法来源）：
    //  1. 看板页面浏览器上传：同源 multipart 请求（fetch 同源带 cookie），放行，方便运营手动补传。
    //  2. SmartBI 抓取脚本回传：跨域请求，必须携带 X-Upload-Token（共享密钥 DASHBOARD_INGEST_TOKEN）。
    // 这样既不破坏页面手动上传，又防止接口被公网匿名写入。
    const expectedToken = process.env.DASHBOARD_INGEST_TOKEN;
    const providedToken = req.headers.get("x-upload-token");
    const origin = req.headers.get("origin") ?? "";
    const host = req.headers.get("host") ?? "";
    const isSameOrigin = origin !== "" && host !== "" && (() => {
      try {
        return new URL(origin).host === host;
      } catch {
        return false;
      }
    })();

    if (providedToken) {
      // 脚本/外部回传：必须匹配 token
      if (!expectedToken) {
        console.error("DASHBOARD_INGEST_TOKEN 未配置，拒绝带 token 的上传");
        return NextResponse.json({ success: false, error: "服务端未配置上传令牌" }, { status: 500 });
      }
      if (providedToken !== expectedToken) {
        return NextResponse.json({ success: false, error: "未授权" }, { status: 401 });
      }
    } else if (!isSameOrigin) {
      // 既没有 token 又不是同源浏览器请求 → 拒绝
      return NextResponse.json(
        { success: false, error: "未授权（需 X-Upload-Token 或同源访问）" },
        { status: 401 }
      );
    }

    await ensureBiOrdersTable();
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const date = (form.get("date") as string | null)?.trim() || undefined;

      if (!file || !(file instanceof File)) {
        return NextResponse.json({ success: false, error: "缺少 file 字段" }, { status: 400 });
      }
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`date 格式应为 YYYY-MM-DD，实际：${date}`);
      }

      const buf = Buffer.from(await file.arrayBuffer());
      // 直接从内存解析，避免沙箱落盘后跨进程文件不可见
      const { lines, filterYearMonth, filterStatus } = parseBiOrdersBuffer(buf, {
        completeDate: date,
      });

      if (lines.length === 0) {
        return NextResponse.json({ success: false, error: "报表中没有数据行" }, { status: 400 });
      }

      let deleted = 0;
      let inserted = 0;
      if (date) {
        // 日度：整日替换
        const r = await replaceDateForImport(date, lines);
        deleted = r.deleted;
        inserted = r.inserted;
      } else {
        // 月度回填：按 (order_no,line_no) upsert
        inserted = await upsertOrderLines(lines);
      }

      return NextResponse.json({
        success: true,
        mode: date ? "daily-replace" : "seed-upsert",
        completeDate: date ?? null,
        filterYearMonth,
        filterStatus,
        lines: lines.length,
        uniqueOrders: new Set(lines.map((l) => l.order_no)).size,
        deleted,
        inserted,
      });
    }

    return NextResponse.json(
      { success: false, error: "仅支持 multipart/form-data 上传 xlsx" },
      { status: 415 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/orders/upload] 上传失败:", e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
