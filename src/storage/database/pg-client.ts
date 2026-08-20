/**
 * Postgres 直连连接池（绕过 Supabase REST 网关）。
 *
 * 背景：Supabase 的 PostgREST 网关间歇性返回 502（"invalid response from
 * the upstream server"），导致看板 500/白屏。同库的 Postgres 引擎本身是稳的，
 * 因此服务端数据访问统一走原生 TCP 连接（pg.Pool），从源头绕开该网关。
 *
 * 连接信息来源（优先级从高到低）：
 *   1. PGDATABASE_URL / DATABASE_URL（平台注入的直连串）
 *   2. PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE 拼装
 * 这些变量由平台在运行时注入；本地脚本通过 dotenv / workload identity 加载。
 */

import { Pool, PoolConfig, QueryConfig, QueryResult, QueryResultRow } from 'pg';
import { loadEnv } from './supabase-client';

let pool: Pool | null = null;
let poolErrorHandlerAttached = false;

function buildConnectionString(): string | undefined {
  loadEnv();

  // 显式传入连接参数（不走连接串里的 sslmode），避免 pg-connection-string 的弃用警告噪音
  const host = process.env.PGHOST;
  if (host) {
    return undefined; // 交给 buildPoolConfig 用 host/port/... 显式配置
  }

  if (process.env.PGDATABASE_URL) return process.env.PGDATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return undefined;
}

function buildPoolConfig(): PoolConfig {
  loadEnv();

  const sslMode = (process.env.PGSSLMODE ?? 'require').toLowerCase();
  const ssl =
    sslMode === 'disable'
      ? false
      : { rejectUnauthorized: sslMode === 'verify-full' || sslMode === 'verify-ca' };

  const base: PoolConfig = {
    ssl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  };

  // 优先用显式 PG* 变量（平台注入），避免连接串中的 sslmode 弃用警告
  const host = process.env.PGHOST;
  if (host) {
    return {
      ...base,
      host,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD ?? '',
      database: process.env.PGDATABASE ?? 'postgres',
    };
  }

  const connectionString = process.env.PGDATABASE_URL ?? process.env.DATABASE_URL;
  if (connectionString) {
    return { ...base, connectionString };
  }

  throw new Error(
    '未找到数据库直连配置：请设置 PGHOST/PGUSER/PGPASSWORD/PGDATABASE 或 PGDATABASE_URL'
  );
}

export function getPool(): Pool {
  return buildPool();
}

function buildPool(): Pool {
  if (pool) return pool;

  const config = buildPoolConfig();
  pool = new Pool(config);

  // 连接池级别的 idle 连接错误不能让进程崩溃
  if (!poolErrorHandlerAttached) {
    pool.on('error', (err) => {
      console.error('[pg-pool] 空闲连接发生错误（已忽略，连接将被回收）:', err.message);
    });
    poolErrorHandlerAttached = true;
  }

  return pool;
}

/**
 * 执行查询，返回 pg 的完整 QueryResult。
 * 支持参数化查询（用 $1/$2... 占位，避免 SQL 注入）。
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  q: QueryConfig<unknown[]> | string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(q, params);
}

/** 查询多行，返回行数组。 */
export async function queryRows<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

/** 查询单行；无结果返回 null。 */
export async function queryRow<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const res = await getPool().query<T>(text, params);
  return res.rows[0] ?? null;
}

/** 供脚本/测试优雅关闭连接池。 */
export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
