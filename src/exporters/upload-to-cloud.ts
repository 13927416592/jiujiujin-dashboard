/**
 * 把本地抓取结果上传到云端看板
 *
 * 读取环境变量：
 *   DASHBOARD_UPLOAD_URL  云端上传接口完整地址（必填）
 *                         例如 https://your-domain/api/snapshots/upload
 *   DASHBOARD_INGEST_TOKEN  与服务端一致的共享密钥（必填，放请求头）
 *
 * 未来自建服务器时，只需把这两个环境变量改成你们自己的域名/令牌，代码无需改动。
 */

import * as fs from 'fs';
import path from 'path';
import { gzipSync } from 'node:zlib';

export interface UploadOptions {
  platform: 'alipay' | 'meituan' | 'douyin';
  dataDate: string; // YYYY-MM-DD
  rawFile: string; // 本地抓取产出的 JSON 文件绝对路径
  source?: string;
}

function loadDotEnv(): void {
  // 简单加载项目根目录 .env（不依赖 dotenv，避免本地脚本额外依赖）
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export async function uploadSnapshot(options: UploadOptions): Promise<{
  success: boolean;
  status: number;
  body: unknown;
}> {
  loadDotEnv();

  const url = process.env.DASHBOARD_UPLOAD_URL;
  const token = process.env.DASHBOARD_INGEST_TOKEN;

  if (!url) {
    throw new Error(
      '未配置 DASHBOARD_UPLOAD_URL（云端上传接口地址），请在 .env 中设置'
    );
  }
  if (!token) {
    throw new Error(
      '未配置 DASHBOARD_INGEST_TOKEN（上传令牌），请在 .env 中设置'
    );
  }

  const raw = JSON.parse(fs.readFileSync(options.rawFile, 'utf-8')) as Record<
    string,
    unknown
  >;

  // 大体积数据（如美团近30天约6万行、原始~60MB）超过反向代理请求体上限，
  // 统一 gzip 压缩后 base64 传输，服务端按 Content-Encoding=gzip 自动解压。
  const rawJson = JSON.stringify(raw);
  const gzBase64 = gzipSync(Buffer.from(rawJson, 'utf-8')).toString('base64');
  console.log(
    `📦 上传载荷：原始 ${(rawJson.length / 1024 / 1024).toFixed(2)}MB → gzip+base64 ${(
      gzBase64.length /
      1024 /
      1024
    ).toFixed(2)}MB`
  );

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Upload-Token': token,
      'X-Content-Encoding': 'gzip-base64',
    },
    body: JSON.stringify({
      platform: options.platform,
      data_date: options.dataDate,
      source: options.source ?? 'local-mac',
      raw_data_encoded: gzBase64,
    }),
  });

  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    throw new Error(
      `上传失败 HTTP ${res.status}: ${
        typeof body === 'string' ? body : JSON.stringify(body)
      }`
    );
  }

  return { success: true, status: res.status, body };
}

export interface SnapshotItem {
  dataDate: string; // YYYY-MM-DD
  rawData: Record<string, unknown>;
  source?: string;
}

/**
 * 批量按日上传（一次请求含多天快照，服务端逐条 upsert）。
 * 每个 item 的 raw_data 单独 gzip，体积可控；用于美团近30天一次导入。
 */
export async function uploadSnapshotItems(
  platform: 'alipay' | 'meituan' | 'douyin',
  items: SnapshotItem[]
): Promise<{ success: boolean; status: number; body: unknown }> {
  loadDotEnv();
  const url = process.env.DASHBOARD_UPLOAD_URL;
  const token = process.env.DASHBOARD_INGEST_TOKEN;
  if (!url) throw new Error('未配置 DASHBOARD_UPLOAD_URL');
  if (!token) throw new Error('未配置 DASHBOARD_INGEST_TOKEN');
  if (items.length === 0) throw new Error('没有可上传的数据项');

  const encodedItems = items.map((it) => {
    const json = JSON.stringify(it.rawData);
    const gz = gzipSync(Buffer.from(json, 'utf-8')).toString('base64');
    return {
      data_date: it.dataDate,
      source: it.source ?? 'local-mac',
      raw_data_encoded: gz,
      // 附带原始/压缩体积，便于服务端日志与排查
      _size: { raw: json.length, gz: gz.length },
    };
  });

  const totalRaw = encodedItems.reduce((s, it) => s + (it._size?.raw ?? 0), 0);
  const totalGz = encodedItems.reduce((s, it) => s + (it._size?.gz ?? 0), 0);
  console.log(
    `📦 批量上传 ${items.length} 天：原始合计 ${(totalRaw / 1024 / 1024).toFixed(2)}MB → gzip合计 ${(
      totalGz /
      1024 /
      1024
    ).toFixed(2)}MB`
  );

  // 移除内部 _size 字段再发送
  const payloadItems = encodedItems.map(({ _size, ...rest }) => rest);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Upload-Token': token,
    },
    body: JSON.stringify({
      platform,
      source: 'local-mac',
      items: payloadItems,
    }),
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `批量上传失败 HTTP ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`
    );
  }
  return { success: true, status: res.status, body };
}
