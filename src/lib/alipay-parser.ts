/**
 * 支付宝 bodyText 指标提取（共享、健壮版）
 *
 * 支付宝商家平台的 bodyText 中，指标名与数值之间可能是空格、换行或制表符，
 * 且不同 Tab 的"较前 N 日"措辞不同（较前7日 / 较前日 / 较前1日）。
 * 本模块统一按「指标名 → 数值 → 变化」的顺序扫描，不依赖它们在同一行。
 */

export interface MetricValue {
  value: string;
  change?: string;
}

/** 把任意空白（含换行）压缩为单个空格，便于顺序匹配 */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 顺序扫描：找到指标名后，取其「后接较前N日」的数值作为 value，
 * 再在其后找 +x% / -x% 作为 change。
 *
 * 关键约束：数值后必须在短窗口内出现「较前」，避免把
 * 「较前7日」里的 7、或页面其它位置的数字误当成本指标的值。
 * 当指标无数据（页面显示「-」）时记为 "-"。
 */
function extractSequential(
  flat: string,
  names: string[]
): Record<string, MetricValue> {
  const result: Record<string, MetricValue> = {};
  for (const name of names) {
    if (result[name]) continue;
    const idx = flat.indexOf(name);
    if (idx < 0) continue;
    // 只在指标名之后的一小段窗口内查找，防止跨指标串值
    let window = flat.slice(idx + name.length, idx + name.length + 60);

    // 兼容「交易金额(元) 103 万」这类单位括号：把名称后紧跟的 (元)/(秒)/（元） 也并入窗口
    const unitParen = window.match(/^[\s]*[（(][^）)]{1,4}[）)]/);
    if (unitParen) window = window.slice(unitParen[0].length);

    // 先判断是否为「无数据」：指标名后紧跟「- 较前」
    const noData = /^[\s:：-]*-[^\d]{0,4}较前/.test(window);

    // 数值（可带 万 / %），且其后 0~8 个字符内出现「较前」
    const valueMatch = window.match(
      /([0-9][0-9,]*(?:\.\d+)?)\s*(万|%)?(?=[\s\S]{0,8}?较前)/
    );

    if (!valueMatch) {
      if (noData) result[name] = { value: '-' };
      continue;
    }

    const value = `${valueMatch[1]}${valueMatch[2] ?? ''}`;
    // 变化率：必须紧跟在「较前X日」之后，避免串到下一个指标；
    // 支持 +x% / -x%，也支持无符号的 0.00%
    const afterValue = window.slice(valueMatch.index! + valueMatch[0].length);
    const changeMatch = afterValue.match(/较前\S*?日\s*([+-]?\d+(?:\.\d+)?%)/);
    result[name] = {
      value,
      change: changeMatch
        ? changeMatch[1].startsWith('-') || changeMatch[1].startsWith('+')
          ? changeMatch[1]
          : undefined // 无符号视为无变化，不展示
        : undefined,
    };
  }
  return result;
}

/** 经营总览指标（顶部 KPI + 概览卡片） */
export function parseOverviewMetrics(bodyText: string): Record<string, MetricValue> {
  const flat = flatten(bodyText);
  return extractSequential(flat, [
    '7日交易金额',
    '7日交易用户数',
    '7日交易笔数',
    '7日活跃用户数',
    '累计用户资产',
    '引导交易用户数',
    '引导交易金额',
    '引导交易笔数',
    '客单价',
    '笔单价',
    '人均交易笔数',
    '引导交易转化率',
  ]);
}

/** 流量分析 - 流量概览 Tab */
export function parseTrafficOverview(bodyText: string): Record<string, MetricValue> {
  const flat = flatten(bodyText);
  return extractSequential(flat, [
    '活跃用户数',
    '访问用户数',
    '引导交易用户数',
    '引导交易金额',
    '引导交易笔数',
    '客单价',
    '笔单价',
    '人均交易笔数',
    '引导交易转化率',
  ]);
}

/** 通用：从一段 bodyText 中按给定指标名提取 */
export function parseMetricsByNames(
  bodyText: string,
  names: string[]
): Record<string, MetricValue> {
  return extractSequential(flatten(bodyText), names);
}

/** 小程序 Tab（概览/访问/交易）指标名集合 */
export const MINI_PROGRAM_METRIC_NAMES = [
  '总访问用户数',
  '私域渠道访问用户数',
  '公域日常推广访问用户数',
  '流量激励访问用户数',
  '商业化推广访问用户数',
  '新访问用户数',
  '复访用户数',
  '累计访问用户数',
  '留存率',
  '人均访问时长',
  '次均访问时长',
  '引导交易金额',
  '引导交易笔数',
  '引导交易用户数',
  // 小程序「交易」Tab（名称带 (元) 后缀，由扫描器自动跳过单位括号）
  '交易金额',
  '交易用户数',
  '交易笔数',
  '客单价',
  '笔单价',
];

/** 解析表格：把二维文本数组规整为 { headers, rows } */
export function parseTables(tables: string[][][]): Array<{
  headers: string[];
  rows: Array<Record<string, string>>;
}> {
  return (tables || [])
    .map((table) => {
      if (!table || table.length < 2) return { headers: [], rows: [] };

      // 找到真正的表头行
      let headerIndex = 0;
      for (let i = 0; i < Math.min(3, table.length); i++) {
        const row = table[i];
        if (
          row &&
          (row.includes('活跃阵地') ||
            row.includes('来源渠道') ||
            row.includes('用户占比'))
        ) {
          headerIndex = i;
          break;
        }
      }

      const headers = (table[headerIndex] || []).filter((h) => h && h !== '操作');
      const rows = table
        .slice(headerIndex + 1)
        .map((row) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => {
            if (row[i] && h) {
              obj[h] = String(row[i]).replace(/\s+/g, ' ').trim();
            }
          });
          return obj;
        })
        .filter((row) => {
          if (Object.keys(row).length === 0) return false;
          // 跳过抓取产生的重复表头行（每一列的值都等于列名）
          const isDuplicateHeader = headers.every((h) => !row[h] || row[h] === h);
          return !isDuplicateHeader;
        });

      return { headers, rows };
    })
    .filter((t) => t.headers.length > 0 && t.rows.length > 0);
}

/** 生活号+ / 粉丝群 专属指标（顶层「生活号」「粉丝群」页面） */
export function parseLifeAccountMetrics(bodyText: string): Record<string, MetricValue> {
  return parseMetricsByNames(bodyText, ['访问人数', '访问次数']);
}

/** 流量分析 - 生活号+流量 子 Tab 指标 */
export function parseTrafficLifeAccountMetrics(bodyText: string): Record<string, MetricValue> {
  return parseMetricsByNames(bodyText, [
    '访问用户数',
    '引导直播交易用户数',
    '引导直播交易金额',
    '引导直播交易笔数',
    '客单价',
    '笔单价',
    '人均交易笔数',
  ]);
}

/** 流量分析 - 商家粉丝群流量 子 Tab 指标 */
export function parseTrafficFanGroupMetrics(bodyText: string): Record<string, MetricValue> {
  return parseMetricsByNames(bodyText, [
    '访问用户数',
    '访问次数',
    '新入群用户数',
    '复访问用户数',
  ]);
}
