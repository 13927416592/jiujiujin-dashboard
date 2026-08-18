import { NextResponse } from 'next/server';
import {
  saveSnapshot,
  saveSnapshots,
  type Platform,
} from '@/storage/database/snapshot-repo';
import { gunzipSync } from 'node:zlib';

/**
 * 平台数据上传接口
 *
 * 本地抓取脚本抓完后 POST 到这里：
 *   POST /api/snapshots/upload
 *   Headers: { "Content-Type": "application/json", "X-Upload-Token": "<INGEST_TOKEN>" }
 *   Body: {
 *     platform: "alipay",
 *     data_date: "2026-08-18",
 *     source?: "local-mac",
 *     summary?: { ... },        // 可选
 *     raw_data: { ... }          // 抓取器产出的完整 JSON
 *   }
 *
 * 鉴权：共享密钥，来自环境变量 DASHBOARD_INGEST_TOKEN。
 * 本地脚本通过环境变量持有同一个值，不写死在代码里。
 */

const ALLOWED_PLATFORMS: Platform[] = ['alipay', 'meituan', 'douyin'];

interface UploadBody {
  platform?: string;
  data_date?: string;
  source?: string;
  summary?: Record<string, unknown> | null;
  raw_data?: Record<string, unknown>;
  // gzip 压缩后 base64 编码的 raw_data（用于大体积数据，绕过代理请求体限制）
  raw_data_encoded?: string;
  // 批量按日上传：一次提交多天的快照（如美团近30天）。每项含 data_date + raw_data(_encoded)
  items?: UploadItem[];
}

interface UploadItem {
  data_date?: string;
  source?: string;
  raw_data?: Record<string, unknown>;
  raw_data_encoded?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解压单项 raw_data（支持 gzip+base64 或明文对象） */
function decodeRawData(item: {
  raw_data?: Record<string, unknown>;
  raw_data_encoded?: string;
}): Record<string, unknown> | { error: string } {
  if (typeof item.raw_data_encoded === 'string' && item.raw_data_encoded.length > 0) {
    try {
      const buf = Buffer.from(item.raw_data_encoded, 'base64');
      return JSON.parse(gunzipSync(buf).toString('utf-8')) as Record<string, unknown>;
    } catch (err) {
      return { error: `raw_data_encoded 解压/解析失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (isRecord(item.raw_data)) return item.raw_data;
  return { error: 'raw_data 缺失或不是对象' };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request): Promise<NextResponse> {
  // 1. 鉴权
  const expectedToken = process.env.DASHBOARD_INGEST_TOKEN;
  const providedToken = request.headers.get('x-upload-token');

  if (!expectedToken) {
    console.error('DASHBOARD_INGEST_TOKEN 未配置');
    return NextResponse.json(
      { error: '服务端未配置上传令牌' },
      { status: 500 }
    );
  }
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  // 2. 解析 body
  let body: UploadBody;
  try {
    body = (await request.json()) as UploadBody;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  // 3. 校验平台
  const platform = body.platform as Platform;
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: `platform 非法，需为 ${ALLOWED_PLATFORMS.join('/')}` },
      { status: 400 }
    );
  }

  // 4. 统一成"按日快照"列表：items（批量，新）或 顶层单条（旧格式，兼容）
  const rawItems: UploadItem[] = Array.isArray(body.items) && body.items.length > 0
    ? body.items
    : [{ data_date: body.data_date, source: body.source, raw_data: body.raw_data, raw_data_encoded: body.raw_data_encoded }];

  const toSave = [];
  for (const item of rawItems) {
    if (!item.data_date || !DATE_RE.test(item.data_date)) {
      return NextResponse.json(
        { error: `data_date 非法，需为 YYYY-MM-DD：${item.data_date ?? '(空)'}` },
        { status: 400 }
      );
    }
    const decoded = decodeRawData(item);
    if ('error' in decoded) {
      return NextResponse.json({ error: decoded.error }, { status: 400 });
    }
    toSave.push({
      platform,
      data_date: item.data_date,
      source: item.source || body.source || 'unknown',
      raw_data: decoded,
    });
  }

  // 5. 写入数据库（按 platform+data_date upsert；批量用一次请求）
  try {
    if (toSave.length === 1) {
      const saved = await saveSnapshot(toSave[0]);
      return NextResponse.json({
        success: true,
        id: saved.id,
        platform: saved.platform,
        data_date: saved.data_date,
        count: 1,
      });
    }

    const count = await saveSnapshots(toSave);
    return NextResponse.json({
      success: true,
      platform,
      count,
      dates: toSave.map((s) => s.data_date),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('上传快照失败:', message);
    return NextResponse.json(
      { error: '写入数据库失败', message },
      { status: 500 }
    );
  }
}
