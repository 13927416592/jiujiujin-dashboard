import { NextResponse } from 'next/server';
import { saveSnapshot, type Platform } from '@/storage/database/snapshot-repo';
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
  // 新格式：gzip 压缩后 base64 编码的 raw_data（用于大体积数据，绕过代理请求体限制）
  raw_data_encoded?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

  // 3. 校验
  const platform = body.platform as Platform;
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: `platform 非法，需为 ${ALLOWED_PLATFORMS.join('/')}` },
      { status: 400 }
    );
  }

  if (!body.data_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.data_date)) {
    return NextResponse.json(
      { error: 'data_date 非法，需为 YYYY-MM-DD' },
      { status: 400 }
    );
  }

  // 4. 解析 raw_data：支持 gzip+base64 压缩格式（大体积数据）和明文旧格式
  let rawData: Record<string, unknown>;
  if (typeof body.raw_data_encoded === 'string' && body.raw_data_encoded.length > 0) {
    try {
      const buf = Buffer.from(body.raw_data_encoded, 'base64');
      const json = gunzipSync(buf).toString('utf-8');
      rawData = JSON.parse(json) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `raw_data_encoded 解压/解析失败: ${msg}` },
        { status: 400 }
      );
    }
  } else if (isRecord(body.raw_data)) {
    rawData = body.raw_data;
  } else {
    return NextResponse.json(
      { error: 'raw_data 缺失或不是对象（也未提供 raw_data_encoded）' },
      { status: 400 }
    );
  }

  // 5. 写入数据库（同平台同日 upsert 覆盖）
  try {
    const saved = await saveSnapshot({
      platform,
      data_date: body.data_date,
      fetched_at: new Date().toISOString(),
      source: body.source || 'unknown',
      summary: isRecord(body.summary) ? body.summary : null,
      raw_data: rawData,
    });

    return NextResponse.json({
      success: true,
      id: saved.id,
      platform: saved.platform,
      data_date: saved.data_date,
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
