/**
 * 美团快照内存缓存。
 *
 * 瓶颈：聚合接口每次都从 Supabase 拉取近 90 天、含 raw_data（约 6 万行）的全量快照，
 * 网络往返约 1~2 秒；而筛选 + 聚合在内存中仅需几十毫秒。
 *
 * 数据每天只增量一次，因此对原始快照做短 TTL 缓存：
 * - 命中 TTL 时直接复用，切换日期/省/市/门店筛选亚秒级响应；
 * - 过期后用最新快照指纹（data_date + updated_at）做轻量校验，数据未变则续期，变了才重新拉全量；
 * - 并发请求共享同一个 in-flight Promise，避免缓存击穿。
 */

import { getLatestSnapshot, getLatestSnapshots, type PlatformSnapshot } from '@/storage/database/snapshot-repo';

const TTL_MS = 60_000;

interface CacheEntry {
  snapshots: PlatformSnapshot[];
  fingerprint: string;
  savedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<PlatformSnapshot[]> | null = null;

async function computeFingerprint(): Promise<string> {
  const latest = await getLatestSnapshot('meituan');
  if (!latest) return 'empty';
  return `${latest.data_date}#${latest.updated_at}`;
}

async function loadFresh(): Promise<PlatformSnapshot[]> {
  // 取最近 90 天（覆盖 30 天本期 + 30 天环比期），含 raw_data
  return getLatestSnapshots('meituan', 90);
}

/**
 * 获取美团原始快照（优先走缓存）。
 * 调用方拿到后自行提取行、筛选、聚合。
 */
export async function getMeituanSnapshots(): Promise<PlatformSnapshot[]> {
  const now = Date.now();

  // 1. TTL 内直接返回
  if (cache && now - cache.savedAt < TTL_MS) {
    return cache.snapshots;
  }

  // 2. 并发去重
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      // 3. TTL 过期：先做轻量指纹校验
      const fingerprint = await computeFingerprint();
      if (cache && cache.fingerprint === fingerprint) {
        // 数据没变，仅续期
        cache.savedAt = now;
        return cache.snapshots;
      }
      // 4. 数据变了或首次加载：重新拉全量
      const snapshots = await loadFresh();
      cache = { snapshots, fingerprint, savedAt: now };
      return snapshots;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 数据写入后可主动失效缓存（上传接口调用），下次请求立即拉新 */
export function invalidateMeituanCache(): void {
  cache = null;
}
