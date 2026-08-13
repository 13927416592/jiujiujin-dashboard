import { NextResponse } from 'next/server';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

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

// 解析小程序数据
function parseMiniProgramData(mp: any): any {
  const tabs = mp.tabs || {};
  const result: Record<string, any> = {};
  
  for (const [tabName, tabData] of Object.entries(tabs)) {
    const data = tabData as any;
    const bodyText = data.bodyText || '';
    
    result[tabName] = {
      metrics: extractFromBodyText(bodyText),
      tables: parseTables(data.tables || []),
      rawMetrics: data.metrics || []
    };
  }
  
  return {
    id: mp.id,
    name: mp.name,
    tabs: result
  };
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
    
    // 解析流量数据
    const trafficTabs = traffic.tabs || {};
    const trafficOverview = trafficTabs['流量概览'] || {};
    const miniProgramTraffic = trafficTabs['小程序流量'] || {};
    const lifeAccountTraffic = trafficTabs['生活号+流量'] || {};
    const fanGroupTraffic = trafficTabs['商家粉丝群流量'] || {};
    
    // 解析小程序数据
    const miniPrograms = (miniProgram.programs || []).map(parseMiniProgramData);
    
    return NextResponse.json({
      date: rawData.date,
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
      lifeAccount: {
        metrics: extractFromBodyText(lifeAccount.bodyText || ''),
        tables: parseTables(lifeAccount.tables || [])
      },
      fanGroup: {
        metrics: extractFromBodyText(fanGroup.bodyText || ''),
        tables: parseTables(fanGroup.tables || [])
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
