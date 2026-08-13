import { NextResponse } from 'next/server';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

// 解析原始文本数据为结构化格式
function parseMetrics(metrics: string[]): Record<string, { value: string; change?: string }> {
  const result: Record<string, { value: string; change?: string }> = {};
  
  for (const metric of metrics) {
    // 匹配 "指标名 值 较前7日 变化" 格式
    const match = metric.match(/(.+?)\s+([\d,.]+[万亿]?)\s+较前7日\s+([+\-\d.]+%?)/);
    if (match) {
      const [, name, value, change] = match;
      result[name.trim()] = { value, change };
    }
  }
  
  return result;
}

// 从 bodyText 提取关键指标
function extractFromBodyText(bodyText: string): Record<string, string> {
  const result: Record<string, string> = {};
  
  // 交易数据
  const tradeAmountMatch = bodyText.match(/7日交易金额\s*([\d,.]+)\s*万/);
  if (tradeAmountMatch) result['7日交易金额'] = `${tradeAmountMatch[1]}万`;
  
  const tradeUsersMatch = bodyText.match(/7日交易用户数\s*([\d,.]+)/);
  if (tradeUsersMatch) result['7日交易用户数'] = tradeUsersMatch[1];
  
  const tradeCountMatch = bodyText.match(/7日交易笔数\s*([\d,.]+)/);
  if (tradeCountMatch) result['7日交易笔数'] = tradeCountMatch[1];
  
  // 流量数据
  const activeUsersMatch = bodyText.match(/7日活跃用户数\s*([\d,.]+)\s*万/);
  if (activeUsersMatch) result['7日活跃用户数'] = `${activeUsersMatch[1]}万`;
  
  // 用户资产
  const userAssetMatch = bodyText.match(/累计用户资产\s*([\d,.]+)\s*万/);
  if (userAssetMatch) result['累计用户资产'] = `${userAssetMatch[1]}万`;
  
  return result;
}

// 解析表格数据
function parseTables(tables: string[][][]): Array<{
  headers: string[];
  rows: Array<Record<string, string>>;
}> {
  return tables.map(table => {
    if (!table || table.length < 2) return { headers: [], rows: [] };
    
    // 第一行或第二行是表头
    const headers = table[0] || table[1] || [];
    const rows = table.slice(2).map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (row[i]) obj[h] = row[i];
      });
      return obj;
    });
    
    return { headers, rows };
  });
}

export async function GET() {
  try {
    // 查找最新的 JSON 文件
    const outputDir = path.join(process.cwd(), 'src/exporters/output');
    const files = existsSync(outputDir) 
      ? readdirSync(outputDir).filter(f => f.startsWith('alipay_full_'))
      : [];
    
    if (files.length === 0) {
      return NextResponse.json({ error: '未找到支付宝数据文件' }, { status: 404 });
    }
    
    // 读取最新的文件
    const latestFile = files.sort().pop()!;
    const filePath = path.join(outputDir, latestFile);
    const rawData = JSON.parse(readFileSync(filePath, 'utf-8'));
    
    // 解析各模块数据
    const overview = rawData.pages?.overview || {};
    const traffic = rawData.pages?.traffic || {};
    const miniProgram = rawData.pages?.miniProgram || {};
    const lifeAccount = rawData.pages?.lifeAccount || {};
    const fanGroup = rawData.pages?.fanGroup || {};
    
    // 从 bodyText 提取结构化数据
    const overviewData = extractFromBodyText(overview.bodyText || '');
    
    // 解析流量阵地分布表格
    const trafficTabs = traffic.tabs || {};
    const trafficOverview = trafficTabs['流量概览'] || {};
    const trafficTables = parseTables(trafficOverview.tables || []);
    
    // 解析小程序数据
    const miniPrograms = (miniProgram.programs || []).map((mp: any) => ({
      id: mp.id,
      name: mp.name,
      tabs: Object.fromEntries(
        Object.entries(mp.tabs || {}).map(([tabName, tabData]: [string, any]) => [
          tabName,
          {
            metrics: parseMetrics(tabData.metrics || []),
            tables: parseTables(tabData.tables || []),
            bodyText: tabData.bodyText || ''
          }
        ])
      )
    }));
    
    return NextResponse.json({
      date: rawData.date,
      overview: overviewData,
      traffic: {
        overview: {
          metrics: parseMetrics(trafficOverview.metrics || []),
          tables: trafficTables,
          bodyText: trafficOverview.bodyText || ''
        },
        miniProgramTraffic: trafficTabs['小程序流量'] || {},
        lifeAccountTraffic: trafficTabs['生活号+流量'] || {},
        fanGroupTraffic: trafficTabs['商家粉丝群流量'] || {}
      },
      miniPrograms,
      lifeAccount: {
        metrics: parseMetrics(lifeAccount.metrics || []),
        tables: parseTables(lifeAccount.tables || []),
        bodyText: lifeAccount.bodyText || ''
      },
      fanGroup: {
        metrics: parseMetrics(fanGroup.metrics || []),
        tables: parseTables(fanGroup.tables || []),
        bodyText: fanGroup.bodyText || ''
      }
    });
  } catch (error) {
    console.error('读取支付宝数据失败:', error);
    return NextResponse.json(
      { error: '读取数据失败', message: String(error) },
      { status: 500 }
    );
  }
}
