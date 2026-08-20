/**
 * 美团门店台账缓存。
 *
 * 从 meituan_stores 表加载全部门店主数据（按点评门店ID索引），
 * 用于把经营数据行与门店营业/认领状态关联。
 *
 * 台账数据更新频率极低（偶尔重新导入），用较长 TTL（5 分钟）+
 * 门店总数指纹校验，避免每次看板请求都查库。
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TTL_MS = 5 * 60_000;

// 磁盘兜底：进程重启 + 网关故障叠加时，用上次成功加载的台账兜底
const DISK_CACHE_PATH = join(tmpdir(), 'jiujiujin-meituan-stores.json');

export interface MeituanStoreInfo {
  store_id: string;
  name: string;
  brand: string | null;
  city: string | null;
  business_status: string | null;
  claim_status: string | null;
  qualification_entity: string | null;
}

interface StoreCache {
  byId: Map<string, MeituanStoreInfo>;
  count: number;
  savedAt: number;
  fingerprint: string;
}

let cache: StoreCache | null = null;
let refreshPromise: Promise<Map<string, MeituanStoreInfo>> | null = null;

function persistToDisk(byId: Map<string, MeituanStoreInfo>): void {
  try {
    fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify(Array.from(byId.values())), 'utf-8');
  } catch (err) {
    console.warn(
      '[meituan-store-cache] 写入磁盘兜底缓存失败（不影响运行）:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

function readFromDisk(): Map<string, MeituanStoreInfo> | null {
  try {
    if (!fs.existsSync(DISK_CACHE_PATH)) return null;
    const list = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, 'utf-8')) as MeituanStoreInfo[];
    if (!Array.isArray(list) || list.length === 0) return null;
    const byId = new Map<string, MeituanStoreInfo>();
    for (const s of list) byId.set(String(s.store_id), s);
    return byId;
  } catch (err) {
    console.warn(
      '[meituan-store-cache] 读取磁盘兜底台账失败:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** 有限次重试，抵御 Supabase 网关瞬时抖动 */
async function withRetry<T>(
  fn: () => Promise<T> | PromiseLike<T>,
  retries = 2,
  delayMs = 400
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchStores(): Promise<StoreCache> {
  const client = getSupabaseClient();
  // 台账 2000+ 家，Supabase 单次最多返回 1000 行，必须分页拉全量
  const PAGE = 1000;
  const list: MeituanStoreInfo[] = [];
  let from = 0;
  // select 只取看板需要的列；按 store_id 稳定排序以保证分页一致
  for (;;) {
    const { data, error } = await client
      .from('meituan_stores')
      .select('store_id,name,brand,city,business_status,claim_status,qualification_entity')
      .order('store_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`加载门店台账失败: ${error.message}`);
    const batch = (data ?? []) as MeituanStoreInfo[];
    list.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }

  const byId = new Map<string, MeituanStoreInfo>();
  for (const s of list) byId.set(String(s.store_id), s);

  return {
    byId,
    count: list.length,
    savedAt: Date.now(),
    fingerprint: `count:${list.length}`,
  };
}

/**
 * 获取门店台账（ID -> 门店信息）。
 * 采用 stale-while-revalidate：有内存/磁盘缓存时立即返回，后台静默刷新，
 * 保证台账接口故障绝不拖慢或拖垮看板。
 */
export async function getMeituanStoreMap(): Promise<Map<string, MeituanStoreInfo>> {
  const now = Date.now();

  // 1. TTL 内直接返回
  if (cache && now - cache.savedAt < TTL_MS) {
    return cache.byId;
  }

  // 2. 内存有旧台账：立即返回，后台刷新
  if (cache) {
    void refreshStoreMapInBackground();
    return cache.byId;
  }

  // 3. 内存无（进程刚重启）：磁盘兜底立即返回，后台刷新
  const diskMap = readFromDisk();
  if (diskMap) {
    cache = { byId: diskMap, count: diskMap.size, savedAt: 0, fingerprint: 'disk' };
    void refreshStoreMapInBackground();
    return diskMap;
  }

  // 4. 首次启动且无磁盘缓存：同步等上游；失败返回空映射（不抛错）
  return refreshStoreMapInBackground();
}

function refreshStoreMapInBackground(): Promise<Map<string, MeituanStoreInfo>> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const now = Date.now();
      // 过期后简单指纹校验：数量一致就认为没变（台账全量导入，数量变化是可靠信号）
      if (cache) {
        const client = getSupabaseClient();
        const countResult = await withRetry<{ count: number | null }>(async () => {
          const { count, error } = await client
            .from('meituan_stores')
            .select('*', { count: 'exact', head: true });
          if (error) throw new Error(error.message);
          return { count };
        });
        const fingerprint = `count:${countResult.count ?? 0}`;
        if (fingerprint === cache.fingerprint) {
          cache.savedAt = now;
          return cache.byId;
        }
      }
      const fresh = await withRetry(fetchStores);
      cache = fresh;
      persistToDisk(fresh.byId);
      return fresh.byId;
    } catch (err) {
      // 台账属于「锦上添花」：有缓存用缓存，没有就返回空映射，绝不抛错
      if (cache) {
        console.warn(
          '[meituan-store-cache] 后台刷新失败，沿用内存缓存:',
          err instanceof Error ? err.message : String(err)
        );
        return cache.byId;
      }
      const diskMap = readFromDisk();
      if (diskMap) {
        cache = { byId: diskMap, count: diskMap.size, savedAt: Date.now(), fingerprint: 'disk' };
        return diskMap;
      }
      console.warn(
        '[meituan-store-cache] 门店台账不可用，降级为空映射:',
        err instanceof Error ? err.message : String(err)
      );
      return new Map<string, MeituanStoreInfo>();
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** 台账导入后主动失效 */
export function invalidateMeituanStoreCache(): void {
  cache = null;
}

// 模块加载时后台预热：成功则内存 + 磁盘都有台账兜底。不 await，失败静默。
void (async () => {
  try {
    await getMeituanStoreMap();
  } catch {
    // ignore
  }
})();

/** 经营数据行的门店ID列（点评门店ID）统一转字符串 */
export function rowStoreId(r: Record<string, unknown>): string {
  return String(r['点评门店ID'] ?? '').trim();
}
