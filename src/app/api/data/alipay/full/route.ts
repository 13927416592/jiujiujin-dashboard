import { NextResponse } from 'next/server';
import { getLatestSnapshot } from '@/storage/database/snapshot-repo';

// 从 bodyText 提取关键指标（更全面的解析）
function extractFromBodyText(bodyText: string): Record<string, { value: string; change?: string }> {
  const result: Record<string, { value: string; change?: string }> = {};
  
  // 通用匹配模式：指标名 + 值 + 较前7日 + 变化
  const patterns = [
    // 交易数据
    { name: '7日交易金额', regex: /7日交易金额\s*([\d,.]+)\s*万\s*较前7日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '7日交易用户数', regex: /7日交易用户数\s*([\d,.]+)\s*较前7日\s*([+\-\d.]+%?)/ },
    { name: '7日交易笔数', regex: /7日交易笔数\s*([\d,.]+)\s*较前7日\s*([+\-\d.]+%?)/ },
    
    // 流量数据
    { name: '7日活跃用户数', regex: /7日活跃用户数\s*([\d,.]+)\s*万?\s*较前7日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '访问用户数', regex: /访问用户数\s*([\d,.]+)\s*万?\s*较前7日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '引导交易用户数', regex: /引导交易用户数\s*([\d,.]+)\s*较前7日\s*([+\-\d.]+%?)/ },
    { name: '引导交易金额', regex: /引导交易金额\s*([\d,.]+)\s*万?\s*较前7日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '引导交易笔数', regex: /引导交易笔数\s*([\d,.]+)\s*较前7日\s*([+\-\d.]+%?)/ },
    { name: '客单价', regex: /客单价\s*([\d,.]+)\s*万?\s*较前7日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '笔单价', regex: /笔单价\s*([\d,.]+)\s*较前7日\s*([+\-\d.]+%?)/ },
    { name: '人均交易笔数', regex: /人均交易笔数\s*([\d,.]+)\s*较前7日\s*([+\-\d.]+%?)/ },
    { name: '引导交易转化率', regex: /引导交易转化率\s*([\d,.]+)%?\s*较前7日\s*([+\-\d.]+%?)/, unit: '%' },
    
    // 用户资产
    { name: '累计用户资产', regex: /累计用户资产\s*([\d,.]+)\s*万\s*较前7日\s*([+\-\d.]+%?)/, unit: '万' },
    
    // 小程序流量
    { name: '总访问用户数', regex: /总访问用户数\s*([\d,.]+)\s*万?\s*较前7日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '新访问用户数', regex: /新访问用户数\s*([\d,.]+)\s*较前7日\s*([+\-\d.]+%?)/ },
    { name: '复访用户数', regex: /复访用户数\s*([\d,.]+)\s*较前7日\s*([+\-\d.]+%?)/ },
  ];
  
  for (const pattern of patterns) {
    const match = bodyText.match(pattern.regex);
    if (match) {
      const value = pattern.unit ? `${match[1]}${pattern.unit}` : match[1];
      result[pattern.name] = { value, change: match[2] };
    }
  }
  
  return result;
}

// 解析表格数据（改进版）
function parseTables(tables: string[][][]): Array<{
  headers: string[];
  rows: Array<Record<string, string>>;
}> {
  return tables.map(table => {
    if (!table || table.length < 2) return { headers: [], rows: [] };
    
    // 找到真正的表头行（包含"活跃阵地"或"来源渠道"等关键词）
    let headerIndex = 0;
    for (let i = 0; i < Math.min(3, table.length); i++) {
      const row = table[i];
      if (row && (row.includes('活跃阵地') || row.includes('来源渠道') || row.includes('用户占比'))) {
        headerIndex = i;
        break;
      }
    }
    
    const headers = table[headerIndex] || [];
    const rows = table.slice(headerIndex + 1).map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (row[i] && h && h !== '操作') {
          // 清理数据，去除多余的换行符
          obj[h] = row[i].replace(/\n/g, ' ').trim();
        }
      });
      return obj;
    }).filter(row => Object.keys(row).length > 0);
    
    return { headers: headers.filter(h => h !== '操作'), rows };
  }).filter(t => t.headers.length > 0 && t.rows.length > 0);
}

// 从 rawMetrics 数组提取指标（当 bodyText 为空时）
function extractFromRawMetrics(rawMetrics: string[]): Record<string, { value: string; change?: string }> {
  const result: Record<string, { value: string; change?: string }> = {};
  
  // 合并所有 rawMetrics 为一个大字符串
  const fullText = rawMetrics.join(' ');
  
  // 匹配模式：指标名 + 值 + 较前日 + 变化
  const patterns = [
    { name: '总访问用户数', regex: /总访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '私域渠道访问用户数', regex: /私域渠道访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '公域日常推广访问用户数', regex: /公域日常推广访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '流量激励访问用户数', regex: /流量激励访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '商业化推广访问用户数', regex: /商业化推广访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '新访问用户数', regex: /新访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '累计访问用户数', regex: /累计访问用户数\s*([\d,.]+)\s*万?\s*较前日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '留存率', regex: /留存率\s*([\d,.]+)%?\s*较前日\s*([+\-\d.]+%?)/, unit: '%' },
    { name: '人均访问时长', regex: /人均访问时长[（(]秒[）)]\s*(\d+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '次均访问时长', regex: /次均访问时长[（(]秒[）)]\s*(\d+)\s*较前日\s*([+\-\d.]+%?)/ },
    
    // 交易数据
    { name: '引导交易金额', regex: /引导交易金额\s*([\d,.]+)\s*万?\s*较前日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '引导交易笔数', regex: /引导交易笔数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '引导交易用户数', regex: /引导交易用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '客单价', regex: /客单价\s*([\d,.]+)\s*万?\s*较前日\s*([+\-\d.]+%?)/, unit: '万' },
  ];
  
  for (const pattern of patterns) {
    const match = fullText.match(pattern.regex);
    if (match) {
      const value = pattern.unit ? `${match[1]}${pattern.unit}` : match[1];
      result[pattern.name] = { value, change: match[2] };
    }
  }
  
  return result;
}

// 从小程序 bodyText 提取指标（专用函数）
function extractMiniProgramMetrics(bodyText: string): Record<string, { value: string; change?: string }> {
  const result: Record<string, { value: string; change?: string }> = {};
  
  const patterns = [
    // 单行格式：指标名 值 较前日 变化
    { name: '总访问用户数', regex: /总访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '私域渠道访问用户数', regex: /私域渠道访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '公域日常推广访问用户数', regex: /公域日常推广访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '流量激励访问用户数', regex: /流量激励访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '商业化推广访问用户数', regex: /商业化推广访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '新访问用户数', regex: /新访问用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '累计访问用户数', regex: /累计访问用户数\s*([\d,.]+)\s*万?\s*较前日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '留存率', regex: /留存率\s*([\d,.]+)%?\s*较前日\s*([+\-\d.]+%?)/, unit: '%' },
    { name: '人均访问时长（秒）', regex: /人均访问时长[（(]秒[）)]\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '次均访问时长（秒）', regex: /次均访问时长[（(]秒[）)]\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    
    // 交易数据 - 多行格式：指标名(元)\n值\n万\n较前1日\n变化
    { name: '引导交易金额', regex: /交易金额[（(]元[）)]\s*\n\s*([\d,.]+)\s*\n\s*万?\s*\n\s*较前\d+日\s*\n\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '引导交易笔数', regex: /交易笔数\s*\n\s*([\d,.]+)\s*\n\s*较前\d+日\s*\n\s*([+\-\d.]+%?)/ },
    { name: '引导交易用户数', regex: /交易用户数\s*\n\s*([\d,.]+)\s*\n\s*较前\d+日\s*\n\s*([+\-\d.]+%?)/ },
    { name: '客单价', regex: /客单价[（(]元[）)]\s*\n\s*([\d,.]+)\s*\n\s*万?\s*\n\s*较前\d+日\s*\n\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '笔单价', regex: /笔单价[（(]元[）)]\s*\n\s*([\d,.]+)\s*\n\s*较前\d+日\s*\n\s*([+\-\d.]+%?)/ },
    
    // 交易数据 - 单行格式（备用）
    { name: '引导交易金额', regex: /引导交易金额\s*([\d,.]+)\s*万?\s*较前日\s*([+\-\d.]+%?)/, unit: '万' },
    { name: '引导交易笔数', regex: /引导交易笔数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '引导交易用户数', regex: /引导交易用户数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/ },
    { name: '客单价', regex: /客单价\s*([\d,.]+)\s*万?\s*较前日\s*([+\-\d.]+%?)/, unit: '万' },
  ];
  
  for (const pattern of patterns) {
    if (result[pattern.name]) continue; // 已匹配则跳过
    const match = bodyText.match(pattern.regex);
    if (match) {
      const value = pattern.unit ? `${match[1]}${pattern.unit}` : match[1];
      result[pattern.name] = { value, change: match[2] };
    }
  }
  
  return result;
}

// 解析小程序数据
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMiniProgramData(mp: any): any {
  const tabs = mp.tabs || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};
  
  for (const [tabName, tabData] of Object.entries(tabs)) {
    const data = tabData as Record<string, unknown>;
    const bodyText = (data.bodyText as string) || '';
    const rawMetrics = (data.metrics as string[]) || [];
    
    // 优先使用 bodyText，如果为空则使用 rawMetrics
    const metrics = bodyText 
      ? extractMiniProgramMetrics(bodyText)
      : extractFromRawMetrics(rawMetrics);
    
    result[tabName] = {
      metrics,
      tables: parseTables((data.tables as string[][][]) || []),
      rawMetrics
    };
  }
  
  return {
    id: mp.id,
    name: mp.name,
    tabs: result
  };
}

/**
 * 将抓取器产出的原始 JSON 解析为看板需要的结构化数据。
 * 同时被「数据库读取」和「本地文件兜底读取」两条路径复用。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAlipayRaw(rawData: any, date?: string) {
  // 解析各模块数据
  const overview = rawData.pages?.overview || {};
  const traffic = rawData.pages?.traffic || {};
  const miniProgram = rawData.pages?.miniProgram || {};
  const lifeAccount = rawData.pages?.lifeAccount || {};
  const fanGroup = rawData.pages?.fanGroup || {};
  
  // 从 bodyText 提取结构化数据
  const overviewData = extractFromBodyText(overview.bodyText || '');
  
  // 解析流量数据
  const trafficTabs = traffic.tabs || {};
  const trafficOverview = trafficTabs['流量概览'] || {};
  const miniProgramTraffic = trafficTabs['小程序流量'] || {};
  const lifeAccountTraffic = trafficTabs['生活号+流量'] || {};
  const fanGroupTraffic = trafficTabs['商家粉丝群流量'] || {};
  
  // 解析小程序数据
  const miniPrograms = (miniProgram.programs || []).map(parseMiniProgramData);
  
  // 解析生活号数据
  const lifeAccountMetrics: Record<string, { value: string; change?: string }> = {};
  const lifeAccountBodyText = lifeAccount.bodyText || '';
  const lifeAccountMatch = lifeAccountBodyText.match(/访问人数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/);
  if (lifeAccountMatch) {
    lifeAccountMetrics['访问人数'] = { value: lifeAccountMatch[1], change: lifeAccountMatch[2] };
  }
  const lifeAccountVisitMatch = lifeAccountBodyText.match(/访问次数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/);
  if (lifeAccountVisitMatch) {
    lifeAccountMetrics['访问次数'] = { value: lifeAccountVisitMatch[1], change: lifeAccountVisitMatch[2] };
  }
  
  // 解析粉丝群数据
  const fanGroupMetrics: Record<string, { value: string; change?: string }> = {};
  const fanGroupBodyText = fanGroup.bodyText || '';
  const fanGroupMatch = fanGroupBodyText.match(/访问人数\s*([\d,.]+)\s*较前日\s*([+\-\d.]+%?)/);
  if (fanGroupMatch) {
    fanGroupMetrics['访问人数'] = { value: fanGroupMatch[1], change: fanGroupMatch[2] };
  }
  
  return {
    date: date ?? rawData.date,
    overview: overviewData,
    traffic: {
      overview: {
        metrics: extractFromBodyText(trafficOverview.bodyText || ''),
        tables: parseTables(trafficOverview.tables || [])
      },
      miniProgramTraffic: {
        metrics: extractFromBodyText(miniProgramTraffic.bodyText || ''),
        tables: parseTables(miniProgramTraffic.tables || [])
      },
      lifeAccountTraffic: {
        metrics: extractFromBodyText(lifeAccountTraffic.bodyText || ''),
        tables: parseTables(lifeAccountTraffic.tables || [])
      },
      fanGroupTraffic: {
        metrics: extractFromBodyText(fanGroupTraffic.bodyText || ''),
        tables: parseTables(fanGroupTraffic.tables || [])
      }
    },
    miniPrograms,
    lifeAccountTraffic: {
      metrics: lifeAccountMetrics,
      tables: parseTables(lifeAccount.tables || [])
    },
    fanGroupTraffic: {
      metrics: fanGroupMetrics,
      tables: parseTables(fanGroup.tables || [])
    }
  };
}

// 兜底：从本地 output 目录读最新文件（数据库无数据时使用）
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

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
