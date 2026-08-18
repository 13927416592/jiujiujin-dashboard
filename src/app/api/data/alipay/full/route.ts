import { NextResponse } from 'next/server';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { getLatestSnapshot } from '@/storage/database/snapshot-repo';
import {
  parseOverviewMetrics,
  parseTrafficOverview,
  parseMetricsByNames,
  parseLifeAccountMetrics,
  parseTrafficLifeAccountMetrics,
  parseTrafficFanGroupMetrics,
  parseTables,
  MINI_PROGRAM_METRIC_NAMES,
  type MetricValue,
} from '@/lib/alipay-parser';

// 流量分析各子 Tab 在抓取结果中的英文 key
const TRAFFIC_TAB_KEYS = {
  overview: 'overview',
  miniApp: 'miniApp',
  lifeAccount: 'lifeAccount',
  fanGroup: 'fanGroup',
  other: 'other',
} as const;

type TabLike = { bodyText?: string; tables?: string[][][] };

function getTrafficTab(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trafficTabs: Record<string, any>,
  key: string
): TabLike {
  return (trafficTabs?.[key] as TabLike) || {};
}

// 小程序指标：bodyText 与 rawMetrics 合并解析，互补缺失
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMiniProgramMetrics(tabData: any): Record<string, MetricValue> {
  const bodyText = (tabData?.bodyText as string) || '';
  const rawMetrics = (tabData?.metrics as string[]) || [];
  const combined = `${bodyText}\n${rawMetrics.join('\n')}`;
  return parseMetricsByNames(combined, MINI_PROGRAM_METRIC_NAMES);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMiniProgramData(mp: any) {
  const tabs = mp.tabs || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const [tabName, tabData] of Object.entries(tabs)) {
    const data = tabData as Record<string, unknown>;
    const rawMetrics = ((data.metrics as string[]) || []).slice(0, 30);
    result[tabName] = {
      metrics: parseMiniProgramMetrics(data),
      tables: parseTables((data.tables as string[][][]) || []),
      rawMetrics,
    };
  }

  return {
    id: mp.id,
    name: mp.name,
    tabs: result,
  };
}

/**
 * 将抓取器产出的原始 JSON 解析为看板需要的结构化数据。
 * 同时被「数据库读取」和「本地文件兜底读取」两条路径复用。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAlipayRaw(rawData: any, date?: string) {
  const overview = rawData.pages?.overview || {};
  const traffic = rawData.pages?.traffic || {};
  const miniProgram = rawData.pages?.miniProgram || {};
  const lifeAccount = rawData.pages?.lifeAccount || {};
  const fanGroup = rawData.pages?.fanGroup || {};

  // 经营总览
  const overviewData = parseOverviewMetrics(overview.bodyText || '');

  // 流量分析（注意：tab key 是英文）
  const trafficTabs = traffic.tabs || {};
  const trafficOverview = getTrafficTab(trafficTabs, TRAFFIC_TAB_KEYS.overview);
  const miniProgramTraffic = getTrafficTab(trafficTabs, TRAFFIC_TAB_KEYS.miniApp);
  const lifeAccountTraffic = getTrafficTab(trafficTabs, TRAFFIC_TAB_KEYS.lifeAccount);
  const fanGroupTraffic = getTrafficTab(trafficTabs, TRAFFIC_TAB_KEYS.fanGroup);

  // 小程序分析
  const miniPrograms = (miniProgram.programs || []).map(parseMiniProgramData);

  // 生活号+
  const lifeAccountBodyText = lifeAccount.bodyText || '';
  const lifeAccountMetrics = parseLifeAccountMetrics(lifeAccountBodyText);

  // 粉丝群（顶层「粉丝群」页面同样包含访问用户数/访问次数/新入群等）
  const fanGroupBodyText = fanGroup.bodyText || '';
  const fanGroupMetrics = parseTrafficFanGroupMetrics(fanGroupBodyText);

  // 流量-小程序 / 生活号 / 粉丝群 子 Tab 的指标名
  const trafficMiniMetrics = parseTrafficOverview(miniProgramTraffic.bodyText || '');
  const trafficLifeMetrics = parseTrafficLifeAccountMetrics(lifeAccountTraffic.bodyText || '');
  const trafficFanMetrics = parseTrafficFanGroupMetrics(fanGroupTraffic.bodyText || '');

  return {
    date: date ?? rawData.date,
    overview: overviewData,
    traffic: {
      overview: {
        metrics: parseTrafficOverview(trafficOverview.bodyText || ''),
        tables: parseTables(trafficOverview.tables || []),
      },
      miniProgramTraffic: {
        metrics: trafficMiniMetrics,
        tables: parseTables(miniProgramTraffic.tables || []),
      },
      lifeAccountTraffic: {
        metrics: trafficLifeMetrics,
        tables: parseTables(lifeAccountTraffic.tables || []),
      },
      fanGroupTraffic: {
        metrics: trafficFanMetrics,
        tables: parseTables(fanGroupTraffic.tables || []),
      },
    },
    miniPrograms,
    lifeAccountTraffic: {
      metrics: lifeAccountMetrics,
      tables: parseTables(lifeAccount.tables || []),
    },
    fanGroupTraffic: {
      metrics: fanGroupMetrics,
      tables: parseTables(fanGroup.tables || []),
    },
  };
}

// 兜底：从本地 output 目录读最新文件（数据库无数据时使用）
function readLatestFromFile() {
  const outputDir = path.join(process.cwd(), 'src/exporters/output');
  const files = existsSync(outputDir)
    ? readdirSync(outputDir).filter((f) => f.startsWith('alipay_full_'))
    : [];

  if (files.length === 0) return null;

  const latestFile = files.sort().pop()!;
  const filePath = path.join(outputDir, latestFile);
  const rawData = JSON.parse(readFileSync(filePath, 'utf-8'));
  return parseAlipayRaw(rawData);
}

export async function GET(): Promise<NextResponse> {
  // 1. 优先从云端数据库读取
  try {
    const snapshot = await getLatestSnapshot('alipay');
    if (snapshot) {
      return NextResponse.json({
        ...parseAlipayRaw(snapshot.raw_data, snapshot.data_date),
        source: snapshot.source ?? 'cloud',
        fetched_at: snapshot.fetched_at,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('从数据库读取支付宝快照失败，尝试本地文件兜底:', message);
  }

  // 2. 兜底：本地文件
  try {
    const fromFile = readLatestFromFile();
    if (fromFile) {
      return NextResponse.json({ ...fromFile, source: 'local-file' });
    }
  } catch (error) {
    console.error('读取支付宝数据失败:', error);
    return NextResponse.json(
      { error: '读取数据失败', message: String(error) },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: '暂无支付宝数据，请先运行抓取并上传' },
    { status: 404 }
  );
}
