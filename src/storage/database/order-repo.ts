/**
 * SmartBI 完成订单数据访问层（Postgres 直连）。
 *
 * 统一封装 bi_orders 表的读写：
 *  - CLI / 上传接口：replaceDateForImport（先按完成日期删除，再批量插入，保证日度幂等）
 *  - 看板聚合接口：getOrderRows（取近 N 天明细，交由 order-agg 纯函数聚合）
 *
 * 走原生 pg 连接，与 snapshot-repo / meituan-store-cache 保持一致。
 */

import { query, queryRows } from './pg-client';
import type { OrderPlatform, SourceGroup } from '../../exporters/bi-order-parser';

/** 数据库中的一条订单明细行（amount 等 numeric 以 string 返回，聚合层转 number）。 */
export interface BiOrderRow {
  order_no: string;
  line_no: number;
  data_date: string;
  date_basis: 'completed' | 'created-seed';
  store_name: string | null;
  store_code: string | null;
  is_online: number;
  mini_app: string | null;
  platform: OrderPlatform;
  channel_name: string | null;
  source_name: string | null;
  source_group: SourceGroup;
  amount: string;
  gross_weight: string | null;
  net_weight: string | null;
  created_date: string | null;
}

export interface OrderLineInput {
  order_no: string;
  line_no: number;
  data_date: string;
  date_basis: 'completed' | 'created-seed';
  store_name: string | null;
  store_code: string | null;
  is_online: boolean;
  mini_app: string | null;
  platform: OrderPlatform;
  channel_name: string | null;
  source_name: string | null;
  source_group: SourceGroup;
  amount: number;
  gross_weight: number | null;
  net_weight: number | null;
  created_date: string | null;
  raw_row: Record<string, unknown>;
}

/**
 * 按完成日期做"整日替换"导入：先删除该 data_date 的所有行，再批量插入。
 * 同一天重复导入不会产生重复数据，符合"每日抓取昨日、可重跑"的语义。
 * 返回 { deleted, inserted }。
 */
export async function replaceDateForImport(
  dataDate: string,
  lines: OrderLineInput[]
): Promise<{ deleted: number; inserted: number }> {
  const client = await (await import('./pg-client')).getPool().connect();
  let deleted = 0;
  try {
    await client.query('BEGIN');
    const del = await client.query('DELETE FROM bi_orders WHERE data_date = $1', [dataDate]);
    deleted = del.rowCount ?? 0;

    if (lines.length > 0) {
      const COLS = 17;
      const BATCH = 200;
      let inserted = 0;
      for (let i = 0; i < lines.length; i += BATCH) {
        const batch = lines.slice(i, i + BATCH);
        const placeholders = batch
          .map((_, r) => {
            const b = r * COLS;
            return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},$${b + 16},$${b + 17})`;
          })
          .join(',');
        const params: unknown[] = [];
        for (const l of batch) {
          params.push(
            l.order_no,
            l.line_no,
            l.data_date,
            l.date_basis,
            l.store_name,
            l.store_code,
            l.is_online ? 1 : 0,
            l.mini_app,
            l.platform,
            l.channel_name,
            l.source_name,
            l.source_group,
            l.amount,
            l.gross_weight,
            l.net_weight,
            l.created_date,
            JSON.stringify(l.raw_row)
          );
        }
        const ins = await client.query(
          `INSERT INTO bi_orders
             (order_no, line_no, data_date, date_basis, store_name, store_code, is_online,
              mini_app, platform, channel_name, source_name, source_group,
              amount, gross_weight, net_weight, created_date, raw_row)
           VALUES ${placeholders}
           ON CONFLICT (order_no, line_no) DO UPDATE SET
             data_date=EXCLUDED.data_date, date_basis=EXCLUDED.date_basis,
             store_name=EXCLUDED.store_name, store_code=EXCLUDED.store_code,
             is_online=EXCLUDED.is_online, mini_app=EXCLUDED.mini_app,
             platform=EXCLUDED.platform, channel_name=EXCLUDED.channel_name,
             source_name=EXCLUDED.source_name, source_group=EXCLUDED.source_group,
             amount=EXCLUDED.amount, gross_weight=EXCLUDED.gross_weight,
             net_weight=EXCLUDED.net_weight, created_date=EXCLUDED.created_date,
             raw_row=EXCLUDED.raw_row, updated_at=now()`,
          params
        );
        inserted += ins.rowCount ?? batch.length;
      }
      await client.query('COMMIT');
      return { deleted, inserted };
    }

    await client.query('COMMIT');
    return { deleted, inserted: 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 批量 upsert（不按日期删除）。用于月度回填等跨日期导入场景。
 */
export async function upsertOrderLines(lines: OrderLineInput[]): Promise<number> {
  let affected = 0;
  const COLS = 17;
  const BATCH = 200;
  for (let i = 0; i < lines.length; i += BATCH) {
    const batch = lines.slice(i, i + BATCH);
    const placeholders = batch
      .map((_, r) => {
        const b = r * COLS;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},$${b + 16},$${b + 17})`;
      })
      .join(',');
    const params: unknown[] = [];
    for (const l of batch) {
      params.push(
        l.order_no,
        l.line_no,
        l.data_date,
        l.date_basis,
        l.store_name,
        l.store_code,
        l.is_online ? 1 : 0,
        l.mini_app,
        l.platform,
        l.channel_name,
        l.source_name,
        l.source_group,
        l.amount,
        l.gross_weight,
        l.net_weight,
        l.created_date,
        JSON.stringify(l.raw_row)
      );
    }
    const res = await query(
      `INSERT INTO bi_orders
         (order_no, line_no, data_date, date_basis, store_name, store_code, is_online,
          mini_app, platform, channel_name, source_name, source_group,
          amount, gross_weight, net_weight, created_date, raw_row)
       VALUES ${placeholders}
       ON CONFLICT (order_no, line_no) DO UPDATE SET
         data_date=EXCLUDED.data_date, date_basis=EXCLUDED.date_basis,
         store_name=EXCLUDED.store_name, store_code=EXCLUDED.store_code,
         is_online=EXCLUDED.is_online, mini_app=EXCLUDED.mini_app,
         platform=EXCLUDED.platform, channel_name=EXCLUDED.channel_name,
         source_name=EXCLUDED.source_name, source_group=EXCLUDED.source_group,
         amount=EXCLUDED.amount, gross_weight=EXCLUDED.gross_weight,
         net_weight=EXCLUDED.net_weight, created_date=EXCLUDED.created_date,
         raw_row=EXCLUDED.raw_row, updated_at=now()`,
      params
    );
    affected += res.rowCount ?? batch.length;
  }
  return affected;
}

export interface OrderQueryFilter {
  platform?: string;
  sourceGroup?: string;
  storeCode?: string;
}

/** 取最近 N 个有数据的日期对应的全部明细行（按 data_date 升序）。 */
export async function getOrderRows(
  days: number,
  filter: OrderQueryFilter = {}
): Promise<BiOrderRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.platform) {
    params.push(filter.platform);
    conditions.push(`platform = $${params.length}`);
  }
  if (filter.sourceGroup) {
    params.push(filter.sourceGroup);
    conditions.push(`source_group = $${params.length}`);
  }
  if (filter.storeCode) {
    params.push(filter.storeCode);
    conditions.push(`store_code = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // 先选出最近 N 个有数据的日期，再取这些日期的（按筛选过滤的）明细行
  const limitIdx = params.length + 1;
  const rows = await queryRows<BiOrderRow>(
    `WITH recent AS (
       SELECT DISTINCT data_date
         FROM bi_orders
         ${where}
         ORDER BY data_date DESC
         LIMIT $${limitIdx}
     )
     SELECT b.order_no, b.line_no, b.data_date, b.date_basis, b.store_name, b.store_code, b.is_online,
            b.mini_app, b.platform, b.channel_name, b.source_name, b.source_group,
            b.amount::text AS amount, b.gross_weight::text AS gross_weight,
            b.net_weight::text AS net_weight, b.created_date
       FROM bi_orders b
       JOIN recent r ON r.data_date = b.data_date
       ${where ? `${where.replace(/WHERE/, 'AND')}` : ''}
      ORDER BY b.data_date ASC, b.order_no ASC, b.line_no ASC`,
    [...params, days]
  );
  return rows;
}

/** 最新有数据的完成日期。 */
export async function getLatestOrderDate(): Promise<string | null> {
  const rows = await queryRows<{ data_date: string }>(
    'SELECT MAX(data_date) AS data_date FROM bi_orders'
  );
  return rows[0]?.data_date ?? null;
}

/** 数据覆盖的日期数与起止。 */
export async function getOrderCoverage(): Promise<{
  totalDays: number;
  minDate: string | null;
  maxDate: string | null;
}> {
  const rows = await queryRows<{ total_days: number; min_date: string | null; max_date: string | null }>(
    `SELECT COUNT(DISTINCT data_date)::int AS total_days,
            MIN(data_date) AS min_date, MAX(data_date) AS max_date
       FROM bi_orders`
  );
  return {
    totalDays: rows[0]?.total_days ?? 0,
    minDate: rows[0]?.min_date ?? null,
    maxDate: rows[0]?.max_date ?? null,
  };
}
