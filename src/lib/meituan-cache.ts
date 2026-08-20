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
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TTL_MS = 5 * 60_000; // 5 分钟：数据每天才增量一次，无需频繁回源

// 磁盘兜底缓存：进程重启后内存缓存清空，若此时 Supabase 网关正好不可用，
// 看板会直接 500。把最近一次成功拉取的快照落盘，首次加载失败时读盘兜底，
// 保证看板在网关持续故障 + 服务重启的叠加情况下仍可用（标记 stale）。
const DISK_CACHE_PATH = join(tmpdir(), 'jiujiujin-meituan-snapshots.json');

interface CacheEntry {
  snapshots: PlatformSnapshot[];
  fingerprint: string;
  savedAt: number;
}

let cache: CacheEntry | null = null;
let refreshPromise: Promise<{ snapshots: PlatformSnapshot[]; stale: boolean }> | null = null;

function persistToDisk(snapshots: PlatformSnapshot[]): void {
  try {
    fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify(snapshots), 'utf-8');
  } catch (err) {
    console.warn(
      '[meituan-cache] 写入磁盘兜底缓存失败（不影响运行）:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

function readFromDisk(): PlatformSnapshot[] | null {
  try {
    if (!fs.existsSync(DISK_CACHE_PATH)) return null;
    const raw = fs.readFileSync(DISK_CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as PlatformSnapshot[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch (err) {
    console.warn(
      '[meituan-cache] 读取磁盘兜底缓存失败:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** 对一个异步操作做有限次重试（仅对网络类瞬时错误重试） */
async function withRetry<T>(fn: () => Promise<T> | PromiseLike<T>, retries = 2, delayMs = 400): Promise<T> {
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
 * stale=true 表示上游不可用、返回的是旧缓存（数据可能不是最新）。
 *
 * 降级策略（按优先级）：
 * 1. TTL 内的内存缓存 → 立即返回
 * 2. 内存有旧缓存：后台异步刷新，先返回旧的（stale-while-revalidate），不阻塞请求
 * 3. 内存无缓存（进程刚重启）：有磁盘兜底则先返回磁盘数据（stale），后台异步刷新
 * 这样即使 Supabase 网关完全不可用，看板也能在几十毫秒内返回上次的数据，而不是卡几十秒后 500。
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

  // 2. 内存有旧数据：先返回旧的，后台静默刷新（不 await）
  if (cache) {
    void refreshInBackground();
    return { snapshots: cache.snapshots, stale: true };
  }

  // 3. 内存无缓存（进程刚重启）：尝试磁盘兜底，立即返回 + 后台刷新
  const diskSnapshots = readFromDisk();
  if (diskSnapshots) {
    // savedAt 设为 0 让磁盘兜底数据在刷新成功前始终标记 stale（数据可能不是最新）
    cache = { snapshots: diskSnapshots, fingerprint: 'disk', savedAt: 0 };
    void refreshInBackground();
    return { snapshots: diskSnapshots, stale: true };
  }

  // 4. 内存和磁盘都没有（首次启动且从未成功加载过）：只能同步等上游
  return refreshInBackground();
}

/** 后台刷新：带并发去重（共享同一个 Promise），失败时降级到内存/磁盘缓存 */
function refreshInBackground(): Promise<{
  snapshots: PlatformSnapshot[];
  stale: boolean;
}> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const now = Date.now();
      const fingerprint = await computeFingerprint();
      if (cache && cache.fingerprint === fingerprint) {
        cache.savedAt = now;
        return { snapshots: cache.snapshots, stale: false };
      }
      const snapshots = await loadFresh();
      cache = { snapshots, fingerprint, savedAt: now };
      persistToDisk(snapshots);
      return { snapshots, stale: false };
    } catch (err) {
      // 刷新失败：有内存/磁盘缓存就用缓存，没有就抛
      if (cache) {
        console.warn(
          '[meituan-cache] 后台刷新失败，沿用内存缓存:',
          err instanceof Error ? err.message : String(err)
        );
        return { snapshots: cache.snapshots, stale: true };
      }
      const diskSnapshots = readFromDisk();
      if (diskSnapshots) {
        cache = { snapshots: diskSnapshots, fingerprint: 'disk', savedAt: Date.now() };
        return { snapshots: diskSnapshots, stale: true };
      }
      throw err;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** 数据写入后可主动失效缓存（上传接口调用），下次请求立即拉新 */
export function invalidateMeituanCache(): void {
  cache = null;
  // 同时删除磁盘兜底缓存：否则进程重启后可能读到旧的磁盘快照
  try {
    if (fs.existsSync(DISK_CACHE_PATH)) fs.unlinkSync(DISK_CACHE_PATH);
  } catch (err) {
    console.warn(
      '[meituan-cache] 删除磁盘缓存失败（不影响运行）:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

// 模块加载时后台预热一次：成功则内存 + 磁盘都有了缓存，
// 这样即使预热完成后网关才挂掉、或进程后续被重启，也有兜底数据可用。
// 不 await，不阻塞模块加载；失败静默（后续请求会再试）。
void (async () => {
  try {
    await getMeituanSnapshots();
  } catch {
    // 预热失败忽略，首次真实请求时会再尝试
  }
})();
