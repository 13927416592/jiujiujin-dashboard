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

  const { data, error } = await client
    .from('platform_snapshots')
    .upsert(payload, { onConflict: 'platform,data_date' })
    .select()
    .single();

  if (error) {
    throw new Error(`保存平台快照失败: ${error.message}`);
  }
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
