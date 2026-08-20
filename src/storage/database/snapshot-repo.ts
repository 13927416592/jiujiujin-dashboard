/**
 * 平台数据快照数据访问层（Postgres 直连版）。
 *
 * 统一封装 platform_snapshots 表的读写。
 * - 云端上传接口调用 saveSnapshot / saveSnapshots 写入
 * - 看板读取接口调用 getLatestSnapshot / getRecentSnapshots / getLatestSnapshots 查询
 *
 * 走原生 pg 连接（pg-client），绕过 Supabase REST 网关，从源头规避网关 502。
 */

import { query, queryRow, queryRows } from './pg-client';

export type Platform = 'alipay' | 'meituan' | 'douyin';

/**
 * 对一个异步操作做有限次重试。
 * 仅对"瞬时错误"重试：网络错误、数据库连接重置、超时等。
 */
async function withRetry<T>(
  fn: () => Promise<T> | PromiseLike<T>,
  retries: number,
  baseDelayMs: number,
  label: string
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /invalid response from the upstream|timeout|aborted|network|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|Connection terminated|too many clients|server closed|57P01|57P02|57P03|08006|08003/i.test(
          msg
        );
      if (!transient || attempt === retries) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[snapshot-repo] ${label}遇到瞬时错误，${delay}ms 后重试(${attempt + 1}/${retries}):`, msg);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export interface PlatformSnapshot {
  id: number;
  platform: Platform;
  data_date: string; // YYYY-MM-DD
  fetched_at: string; // ISO
  source: string | null;
  summary: Record<string, unknown> | null;
  raw_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SaveSnapshotInput {
  platform: Platform;
  data_date: string;
  fetched_at?: string;
  source?: string;
  summary?: Record<string, unknown> | null;
  raw_data: Record<string, unknown>;
}

/**
 * 写入或更新某平台某天的快照（同平台同日唯一，重复上传覆盖）。
 * 返回写入后的记录。
 */
export async function saveSnapshot(input: SaveSnapshotInput): Promise<PlatformSnapshot> {
  const now = new Date().toISOString();
  const params = [
    input.platform,
    input.data_date,
    input.fetched_at ?? now,
    input.source ?? 'unknown',
    input.summary == null ? null : JSON.stringify(input.summary),
    JSON.stringify(input.raw_data),
    now,
  ];

  const row = await withRetry(
    () =>
      queryRow<PlatformSnapshot>(
        `INSERT INTO platform_snapshots
           (platform, data_date, fetched_at, source, summary, raw_data, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
         ON CONFLICT (platform, data_date) DO UPDATE SET
           fetched_at = EXCLUDED.fetched_at,
           source = EXCLUDED.source,
           summary = EXCLUDED.summary,
           raw_data = EXCLUDED.raw_data,
           updated_at = EXCLUDED.updated_at
         RETURNING id, platform, data_date, fetched_at, source, summary, raw_data, created_at, updated_at`,
        params
      ),
    4,
    800,
    '写入'
  );

  if (!row) {
    throw new Error('保存平台快照失败: 未返回写入记录');
  }

  return row;
}

/**
 * 获取某平台最新一条快照（按数据日期倒序）。
 * 无数据时返回 null。
 */
export async function getLatestSnapshot(platform: Platform): Promise<PlatformSnapshot | null> {
  return withRetry(
    () =>
      queryRow<PlatformSnapshot>(
        `SELECT id, platform, data_date, fetched_at, source, summary, raw_data, created_at, updated_at
         FROM platform_snapshots
         WHERE platform = $1
         ORDER BY data_date DESC
         LIMIT 1`,
        [platform]
      ),
    2,
    500,
    '读取最新快照'
  );
}

/**
 * 获取某平台最近 N 天的快照（不含 raw_data，用于趋势图），按日期升序返回。
 */
export async function getRecentSnapshots(
  platform: Platform,
  limit = 30
): Promise<PlatformSnapshot[]> {
  const rows = await withRetry(
    () =>
      queryRows<PlatformSnapshot>(
        `SELECT id, platform, data_date, fetched_at, source, summary, created_at
         FROM platform_snapshots
         WHERE platform = $1
         ORDER BY data_date DESC
         LIMIT $2`,
        [platform, limit]
      ),
    2,
    500,
    '读取近期快照'
  );

  return rows.sort((a, b) => a.data_date.localeCompare(b.data_date));
}

/**
 * 获取某平台最近 N 天的快照（含 raw_data，用于看板聚合），按日期升序返回。
 */
export async function getLatestSnapshots(
  platform: Platform,
  limit = 30
): Promise<PlatformSnapshot[]> {
  const rows = await withRetry(
    () =>
      queryRows<PlatformSnapshot>(
        `SELECT id, platform, data_date, fetched_at, source, summary, raw_data, created_at, updated_at
         FROM platform_snapshots
         WHERE platform = $1
         ORDER BY data_date DESC
         LIMIT $2`,
        [platform, limit]
      ),
    2,
    500,
    '读取聚合快照'
  );

  return rows.sort((a, b) => a.data_date.localeCompare(b.data_date));
}

/**
 * 批量写入快照：一次性 upsert 多个 (platform, data_date) 记录。
 * 用于美团等"一次导出含多日明细"的场景，按日拆分存储，避免单条 jsonb 过大。
 * 返回成功写入的条数。
 */
export async function saveSnapshots(inputs: SaveSnapshotInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const now = new Date().toISOString();
  // 构造多值 VALUES：每条 7 列 => ($1,$2,...$7), ($8,...)
  const cols = 7;
  const valuesSql = inputs
    .map((_, i) => {
      const base = i * cols;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}::jsonb, $${base + 7})`;
    })
    .join(', ');

  const params: unknown[] = [];
  for (const input of inputs) {
    params.push(
      input.platform,
      input.data_date,
      input.fetched_at ?? now,
      input.source ?? 'unknown',
      input.summary == null ? null : JSON.stringify(input.summary),
      JSON.stringify(input.raw_data),
      now
    );
  }

  await withRetry(
    () =>
      query(
        `INSERT INTO platform_snapshots
           (platform, data_date, fetched_at, source, summary, raw_data, updated_at)
         VALUES ${valuesSql}
         ON CONFLICT (platform, data_date) DO UPDATE SET
           fetched_at = EXCLUDED.fetched_at,
           source = EXCLUDED.source,
           summary = EXCLUDED.summary,
           raw_data = EXCLUDED.raw_data,
           updated_at = EXCLUDED.updated_at`,
        params
      ),
    4,
    800,
    '批量写入'
  );

  return inputs.length;
}
