/**
 * 平台数据快照数据访问层
 *
 * 统一封装 platform_snapshots 表的读写。
 * - 云端上传接口调用 saveSnapshot 写入
 * - 看板读取接口调用 getLatestSnapshot 查询
 *
 * 未来自建服务器时，只要数据库仍是 Postgres（或 Supabase），
 * 本文件无需改动，只需配置好连接环境变量即可。
 */

import { getSupabaseClient } from './supabase-client';

export type Platform = 'alipay' | 'meituan' | 'douyin';

/**
 * 对一个异步写操作做有限次重试。
 * 仅对"瞬时错误"重试：网络错误、Supabase 网关 502/503/504、超时等。
 * 这类错误通常 10 秒内返回，重试能扛过短暂网关抖动。
 */
async function withWriteRetry<T>(
  fn: () => Promise<T> | PromiseLike<T>,
  retries = 4,
  baseDelayMs = 800
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /invalid response from the upstream|timeout|aborted|network|fetch failed|502|503|504|ECONNRESET|ETIMEDOUT/i.test(
          msg
        );
      if (!transient || attempt === retries) break;
      const delay = baseDelayMs * Math.pow(2, attempt); // 800ms,1.6s,3.2s,6.4s
      console.warn(
        `[snapshot-repo] 写入遇到瞬时错误，${delay}ms 后重试(${attempt + 1}/${retries}):`,
        msg
      );
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
export async function saveSnapshot(
  input: SaveSnapshotInput
): Promise<PlatformSnapshot> {
  const client = getSupabaseClient();

  const payload = {
    platform: input.platform,
    data_date: input.data_date,
    fetched_at: input.fetched_at ?? new Date().toISOString(),
    source: input.source ?? 'unknown',
    summary: input.summary ?? null,
    raw_data: input.raw_data,
    updated_at: new Date().toISOString(),
  };

  const { data } = await withWriteRetry<{ data: unknown }>(async () => {
    const { data, error } = await client
      .from('platform_snapshots')
      .upsert(payload, { onConflict: 'platform,data_date' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { data };
  });

  if (!data) {
    throw new Error('保存平台快照失败: 未返回写入记录');
  }

  return data as PlatformSnapshot;
}

/**
 * 获取某平台最新一条快照（按数据日期倒序）。
 * 无数据时返回 null。
 */
export async function getLatestSnapshot(
  platform: Platform
): Promise<PlatformSnapshot | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('platform_snapshots')
    .select('*')
    .eq('platform', platform)
    .order('data_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`读取平台快照失败: ${error.message}`);
  }

  return (data as PlatformSnapshot | null) ?? null;
}

/**
 * 获取某平台最近 N 天的快照（用于趋势图），按日期升序。
 */
export async function getRecentSnapshots(
  platform: Platform,
  limit = 30
): Promise<PlatformSnapshot[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('platform_snapshots')
    .select('id, platform, data_date, fetched_at, source, summary, created_at')
    .eq('platform', platform)
    .order('data_date', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`读取平台快照列表失败: ${error.message}`);
  }

  return (data as PlatformSnapshot[] | null) ?? [];
}

/**
 * 获取某平台最近 N 天的快照（含 raw_data，用于看板聚合），按日期升序。
 */
export async function getLatestSnapshots(
  platform: Platform,
  limit = 30
): Promise<PlatformSnapshot[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('platform_snapshots')
    .select('*')
    .eq('platform', platform)
    .order('data_date', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`读取平台快照列表失败: ${error.message}`);
  }

  const list = (data as PlatformSnapshot[] | null) ?? [];
  return list.sort((a, b) => a.data_date.localeCompare(b.data_date));
}

/**
 * 批量写入快照：一次性 upsert 多个 (platform, data_date) 记录。
 * 用于美团等"一次导出含多日明细"的场景，按日拆分存储，避免单条 jsonb 过大。
 * 返回成功写入的条数。
 */
export async function saveSnapshots(
  inputs: SaveSnapshotInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;
  const client = getSupabaseClient();
  const now = new Date().toISOString();
  const payload = inputs.map((input) => ({
    platform: input.platform,
    data_date: input.data_date,
    fetched_at: input.fetched_at ?? now,
    source: input.source ?? 'unknown',
    summary: input.summary ?? null,
    raw_data: input.raw_data,
    updated_at: now,
  }));

  await withWriteRetry(async () => {
    const { error } = await client
      .from('platform_snapshots')
      .upsert(payload, { onConflict: 'platform,data_date' });
    if (error) throw new Error(error.message);
  });

  return payload.length;
}
