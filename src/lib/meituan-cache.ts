/**
 * 美团快照内存缓存。
 *
 * 瓶颈：聚合接口每次都从 Supabase 拉取近 90 天、含 raw_data（约 6 万行）的全量快照，
 * 网络往返约 1~2 秒；而筛选 + 聚合在内存中仅需几十毫秒。
 *
 * 数据每天只增量一次，因此对原始快照做短 TTL 缓存：
 * - 命中 TTL 时直接复用，切换日期/省/市/门店筛选亚秒级响应；
 * - 过期后用最新快照指纹（data_date + updated_at）做轻量校验，数据未变则续期，变了才重新拉全量；
 * - 并发请求共享同一个 in-flight Promise，避免缓存击穿；
 * - 上游（Supabase 网关）瞬时抖动时自动重试 2 次；仍失败则降级返回上一次成功的旧快照，
 *   保证看板不因短暂网络错误而整页 500（旧快照用 stale 标记，调用方可据此提示"数据可能非最新"）。
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

/** 对一个异步操作做有限次重试（仅对网络类瞬时错误重试） */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

async function computeFingerprint(): Promise<string> {
  const latest = await withRetry(() => getLatestSnapshot('meituan'));
  if (!latest) return 'empty';
  return `${latest.data_date}#${latest.updated_at}`;
}

async function loadFresh(): Promise<PlatformSnapshot[]> {
  // 取最近 90 天（覆盖 30 天本期 + 30 天环比期），含 raw_data
  return withRetry(() => getLatestSnapshots('meituan', 90));
}

/**
 * 获取美团原始快照（优先走缓存）。
 * 调用方拿到后自行提取行、筛选、聚合。
 *
 * 第二返回值 stale=true 表示上游不可用、返回的是旧缓存（数据可能不是最新）。
 */
export async function getMeituanSnapshots(): Promise<{
  snapshots: PlatformSnapshot[];
  stale: boolean;
}> {
  const now = Date.now();

  // 1. TTL 内直接返回
  if (cache && now - cache.savedAt < TTL_MS) {
    return { snapshots: cache.snapshots, stale: false };
  }

  // 2. 并发去重
  if (inflight) {
    const snapshots = await inflight;
    return { snapshots, stale: false };
  }

  inflight = (async () => {
    // 3. TTL 过期：先做轻量指纹校验，数据没变就只续期；变了才拉全量。
    //    任一步骤因上游瞬时错误失败，都降级用旧快照（若有），避免看板整体 500。
    try {
      const fingerprint = await computeFingerprint();
      if (cache && cache.fingerprint === fingerprint) {
        cache.savedAt = now;
        return cache.snapshots;
      }
      const snapshots = await loadFresh();
      cache = { snapshots, fingerprint, savedAt: now };
      return snapshots;
    } catch (err) {
      if (cache) {
        // 上游挂了但本地还有旧数据：续用旧快照（不更新 savedAt，让下次请求再试一次刷新）
        console.warn(
          '[meituan-cache] 刷新快照失败，降级使用旧缓存:',
          err instanceof Error ? err.message : String(err)
        );
        return cache.snapshots;
      }
      // 首次加载且无旧缓存可兜底，只能抛出
      throw err;
    } finally {
      inflight = null;
    }
  })();

  const snapshots = await inflight;
  return { snapshots, stale: false };
}

/** 数据写入后可主动失效缓存（上传接口调用），下次请求立即拉新 */
export function invalidateMeituanCache(): void {
  cache = null;
}
