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

const TTL_MS = 5 * 60_000;

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
let inflight: Promise<Map<string, MeituanStoreInfo>> | null = null;

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

/** 获取门店台账（ID -> 门店信息），优先走缓存 */
export async function getMeituanStoreMap(): Promise<Map<string, MeituanStoreInfo>> {
  const now = Date.now();

  if (cache && now - cache.savedAt < TTL_MS) {
    return cache.byId;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
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
      return fresh.byId;
    } catch (err) {
      // 上游瞬时不可用：有旧台账就降级继续用，避免整个看板 500
      if (cache) {
        console.warn(
          '[meituan-store-cache] 刷新门店台账失败，降级使用旧缓存:',
          err instanceof Error ? err.message : String(err)
        );
        return cache.byId;
      }
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 台账导入后主动失效 */
export function invalidateMeituanStoreCache(): void {
  cache = null;
}

/** 经营数据行的门店ID列（点评门店ID）统一转字符串 */
export function rowStoreId(r: Record<string, unknown>): string {
  return String(r['点评门店ID'] ?? '').trim();
}
