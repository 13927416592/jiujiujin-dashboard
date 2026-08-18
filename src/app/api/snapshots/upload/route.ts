import { NextResponse } from 'next/server';
import { saveSnapshot, type Platform } from '@/storage/database/snapshot-repo';

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

  if (!isRecord(body.raw_data)) {
    return NextResponse.json(
      { error: 'raw_data 缺失或不是对象' },
      { status: 400 }
    );
  }

  // 4. 写入数据库（同平台同日 upsert 覆盖）
  try {
    const saved = await saveSnapshot({
      platform,
      data_date: body.data_date,
      fetched_at: new Date().toISOString(),
      source: body.source || 'unknown',
      summary: isRecord(body.summary) ? body.summary : null,
      raw_data: body.raw_data,
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
