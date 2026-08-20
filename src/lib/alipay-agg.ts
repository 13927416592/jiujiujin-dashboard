/**
 * 支付宝每日快照聚合。
 *
 * 设计原则：抓取层只存「每日明细」（每天一条 1日 口径快照），看板层负责把最近 N 天
 * 的明细聚合成「近1日/近7日/近30日」视图，并生成趋势序列。
 *
 * 指标按可加性分三类，聚合规则不同：
 *  - additive（可加）：交易金额、笔数、访问人数/用户数等流量与交易量，N 天直接求和。
 *  - stock（存量/时点）：累计用户资产、总群聊数等，取最近一天的值（不能累加）。
 *  - ratio（均值/比率）：客单价、转化率、留存率等，用 N 天的「分子/分母」重算，
 *    而不是把每日比率简单平均。
 *
 * 该模块为纯函数，可被 'use client' 组件与服务端 API 共同引用，不含数据库/IO。
 */

/** 单个指标值（对齐 alipay-parser 的 MetricValue） */
export interface AggMetric {
  value: string;
  change?: string;
}

/** 一组指标名到值的映射 */
export type MetricMap = Record<string, AggMetric>;

/** 单天解析后的快照（parseAlipayRaw 的结构化结果子集） */
export interface DailySnapshot {
  date: string;
  overview: MetricMap;
  traffic: {
    overview: { metrics: MetricMap; tables?: unknown };
    miniProgramTraffic: { metrics: MetricMap; tables?: unknown };
    lifeAccountTraffic: { metrics: MetricMap; tables?: unknown };
    fanGroupTraffic: { metrics: MetricMap; tables?: unknown };
  };
  lifeAccountTraffic: { metrics: MetricMap; tables?: unknown };
  fanGroupTraffic: { metrics: MetricMap; tables?: unknown };
  miniPrograms?: Array<{
    id: string;
    name: string;
    tabs: Record<string, { metrics: MetricMap; tables?: unknown }>;
  }>;
}

export type RangeKey = '1d' | '7d' | '30d';

const RANGE_DAYS: Record<RangeKey, number> = { '1d': 1, '7d': 7, '30d': 30 };

/**
 * 把形如 "516万" / "6.48万" / "12.3%" / "1,234" / "-" 的展示值解析成数值。
 *  - "万" → ×10000
 *  - "%" → 保留为百分数数值（不除以100，仅用于展示与同口径比较）
 *  - "-" / 空 / 非数字 → null
 */
export function parseMetricNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '-' || s === '--') return null;
  const m = s.match(/(-?\d[\d,]*(?:\.\d+)?)/);
  if (!m) return null;
  let num = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  if (/万/.test(s)) num *= 10000;
  // 百分比不换算成小数：保持与展示同口径（如 "0.01%" → 0.01）
  return num;
}

/** 把数值格式化为展示字符串（保留万/原始） */
export function formatMetric(num: number | null, opts?: { isRatio?: boolean }): string {
  if (num == null || !Number.isFinite(num)) return '-';
  if (opts?.isRatio) return `${num.toFixed(2)}%`;
  if (Math.abs(num) >= 10000) {
    const wan = num / 10000;
    return `${wan % 1 === 0 ? wan.toFixed(0) : wan.toFixed(1)}万`;
  }
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

/** 指标聚合语义分类 */
type MetricKind = 'additive' | 'stock' | 'ratio';

/**
 * 指标元数据：声明每个指标如何跨天聚合。
 * key 为解析器输出的字段名（经营总览里是 "7日交易金额" 等历史命名，解析层已把 1日 归一化到此名）。
 */
interface MetricSpec {
  kind: MetricKind;
  /** ratio 类：重算所需的分子/分母字段名（在同一指标组内） */
  numerator?: string;
  denominator?: string;
}

/** 经营总览 KPI 聚合规则 */
export const OVERVIEW_SPECS: Record<string, MetricSpec> = {
  // 可加：交易量
  '7日交易金额': { kind: 'additive' },
  '7日交易用户数': { kind: 'additive' },
  '7日交易笔数': { kind: 'additive' },
  '7日活跃用户数': { kind: 'additive' },
  // 存量：取最新一天
  '累计用户资产': { kind: 'stock' },
  // 比率：用金额/笔数/用户数重算
  '客单价': { kind: 'ratio', numerator: '7日交易金额', denominator: '7日交易用户数' },
  '笔单价': { kind: 'ratio', numerator: '7日交易金额', denominator: '7日交易笔数' },
  '人均交易笔数': { kind: 'ratio', numerator: '7日交易笔数', denominator: '7日交易用户数' },
  '引导交易转化率': { kind: 'ratio' }, // 无明确分子分母时退化为按天均值
  '引导交易金额': { kind: 'additive' },
  '引导交易笔数': { kind: 'additive' },
  '引导交易用户数': { kind: 'additive' },
};

/** 流量类（各 Tab 通用）聚合规则 */
export const TRAFFIC_SPECS: Record<string, MetricSpec> = {
  '活跃用户数': { kind: 'additive' },
  '访问用户数': { kind: 'additive' },
  '访问人数': { kind: 'additive' },
  '访问次数': { kind: 'additive' },
  '新访问用户数': { kind: 'additive' },
  '复访用户数': { kind: 'additive' },
  '新入群用户数': { kind: 'additive' },
  '复访问用户数': { kind: 'additive' },
  '引导交易用户数': { kind: 'additive' },
  '引导交易金额': { kind: 'additive' },
  '引导交易笔数': { kind: 'additive' },
  '引导直播交易用户数': { kind: 'additive' },
  '引导直播交易金额': { kind: 'additive' },
  '引导直播交易笔数': { kind: 'additive' },
  '私域渠道访问用户数': { kind: 'additive' },
  '公域日常推广访问用户数': { kind: 'additive' },
  '流量激励访问用户数': { kind: 'additive' },
  '商业化推广访问用户数': { kind: 'additive' },
  '总访问用户数': { kind: 'additive' },
  // 存量
  '累计访问用户数': { kind: 'stock' },
  // 比率
  '客单价': { kind: 'ratio', numerator: '引导交易金额', denominator: '引导交易用户数' },
  '笔单价': { kind: 'ratio', numerator: '引导交易金额', denominator: '引导交易笔数' },
  '人均交易笔数': { kind: 'ratio', numerator: '引导交易笔数', denominator: '引导交易用户数' },
  '引导交易转化率': { kind: 'ratio' },
  '留存率': { kind: 'ratio' },
  '人均访问时长': { kind: 'ratio' },
  '次均访问时长': { kind: 'ratio' },
};

/** 判断字段名是否含比率/率/价/时长等比率类命名（兜底分类） */
function inferRatioByName(name: string): boolean {
  return /(率|价|时长|占比|均值)/.test(name);
}

/** 判断字段名是否为存量/累计类（兜底） */
function inferStockByName(name: string): boolean {
  return /(累计|总群|总组数|总用户数$)/.test(name);
}

function specFor(name: string, specs: Record<string, MetricSpec>): MetricSpec {
  if (specs[name]) return specs[name];
  if (inferStockByName(name)) return { kind: 'stock' };
  if (inferRatioByName(name)) return { kind: 'ratio' };
  return { kind: 'additive' };
}

function isPercentField(name: string): boolean {
  return /(率|占比)/.test(name);
}

/** 从一个指标组中取某指标的数值 */
function num(metrics: MetricMap | undefined, name: string): number | null {
  if (!metrics) return null;
  const m = metrics[name];
  return m ? parseMetricNumber(m.value) : null;
}

/**
 * 把多天的同一指标组聚合成一个范围视图。
 * 返回的 key 与输入字段名一致，value 为聚合后的展示值；同时返回每日趋势。
 */
export function aggregateGroup(
  daily: Array<{ date: string; metrics: MetricMap }>,
  specs: Record<string, MetricSpec>
): {
  metrics: MetricMap;
  trend: Array<{ date: string; values: Record<string, number | null> }>;
} {
  if (daily.length === 0) return { metrics: {}, trend: [] };

  // 收集所有出现过的字段名
  const nameSet = new Set<string>();
  for (const d of daily) {
    for (const k of Object.keys(d.metrics)) nameSet.add(k);
  }

  const out: MetricMap = {};
  const trendValues: Record<string, Array<number | null>> = {};
  for (const name of nameSet) trendValues[name] = [];

  for (const d of daily) {
    for (const name of nameSet) {
      trendValues[name].push(num(d.metrics, name));
    }
  }

  for (const name of nameSet) {
    const spec = specFor(name, specs);
    const series = trendValues[name];
    let aggNum: number | null = null;

    if (spec.kind === 'stock') {
      // 取最近一天的非空值
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i] != null) {
          aggNum = series[i];
          break;
        }
      }
    } else if (spec.kind === 'additive') {
      const sum = series.reduce<number>((acc, v) => acc + (v ?? 0), 0);
      aggNum = daily.some((d) => num(d.metrics, name) != null) ? sum : null;
    } else {
      // ratio：优先用分子/分母在范围内求和后重算
      if (spec.numerator && spec.denominator) {
        let nSum = 0;
        let dSum = 0;
        let hasAny = false;
        for (const d of daily) {
          const n = num(d.metrics, spec.numerator);
          const dd = num(d.metrics, spec.denominator);
          if (n != null && dd != null && dd !== 0) {
            nSum += n;
            dSum += dd;
            hasAny = true;
          }
        }
        aggNum = hasAny && dSum !== 0 ? nSum / dSum : null;
        if (aggNum != null && !isPercentField(name)) {
          // 客单价/笔单价/人均笔数：金额/人数或笔数/人数，结果不是百分数，保持数值
        }
      } else {
        // 无分子分母：取有值天数的均值
        const vals = series.filter((v): v is number => v != null);
        aggNum = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }
    }

    if (aggNum != null) {
      const isRatio = isPercentField(name);
      out[name] = { value: formatMetric(aggNum, { isRatio }) };
    } else {
      out[name] = { value: '-' };
    }
  }

  // 趋势：按日期升序
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const trend = sorted.map((d) => ({
    date: d.date,
    values: Object.fromEntries(
      [...nameSet].map((name) => [name, num(d.metrics, name)])
    ) as Record<string, number | null>,
  }));

  return { metrics: out, trend };
}

/** 计算环比变化率：当前范围值 vs 上一个同等长度范围。返回带符号百分比字符串。 */
export function changePct(current: number | null, previous: number | null): string | undefined {
  if (current == null || previous == null || previous === 0) return undefined;
  const pct = ((current - previous) / previous) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** 聚合后的支付宝看板数据 */
export interface AlipayAggregated {
  range: RangeKey;
  days: number;
  /** 实际覆盖到的日期（升序） */
  dates: string[];
  latestDate: string | null;
  overview: MetricMap;
  traffic: {
    overview: MetricMap;
    miniProgramTraffic: MetricMap;
    lifeAccountTraffic: MetricMap;
    fanGroupTraffic: MetricMap;
  };
  lifeAccountTraffic: MetricMap;
  fanGroupTraffic: MetricMap;
  /** 每日趋势序列（按指标组） */
  trend: {
    overview: Array<{ date: string; values: Record<string, number | null> }>;
    trafficOverview: Array<{ date: string; values: Record<string, number | null> }>;
  };
  miniPrograms: Array<{
    id: string;
    name: string;
    tabs: Record<string, MetricMap>;
  }>;
}

/**
 * 把最近若干天的每日解析快照聚合成看板视图。
 * @param snapshots 已 parseAlipayRaw 的每日快照（任意顺序，函数内按日期排序取最新 N 天）
 * @param range 时间范围
 */
export function aggregateAlipay(
  snapshots: DailySnapshot[],
  range: RangeKey = '7d'
): AlipayAggregated {
  const days = RANGE_DAYS[range];
  const sorted = [...snapshots].sort((a, b) => b.date.localeCompare(a.date)).slice(0, days);
  // 升序用于趋势
  const asc = [...sorted].sort((a, b) => a.date.localeCompare(b.date));
  const dates = asc.map((s) => s.date);

  const group = (pick: (s: DailySnapshot) => MetricMap, specs: Record<string, MetricSpec>) =>
    aggregateGroup(
      asc.map((s) => ({ date: s.date, metrics: pick(s) || {} })),
      specs
    );

  const overviewAgg = group((s) => s.overview, OVERVIEW_SPECS);
  const trafficOverviewAgg = group(
    (s) => s.traffic.overview.metrics,
    TRAFFIC_SPECS
  );
  const trafficMiniAgg = group(
    (s) => s.traffic.miniProgramTraffic.metrics,
    TRAFFIC_SPECS
  );
  const trafficLifeAgg = group(
    (s) => s.traffic.lifeAccountTraffic.metrics,
    TRAFFIC_SPECS
  );
  const trafficFanAgg = group(
    (s) => s.traffic.fanGroupTraffic.metrics,
    TRAFFIC_SPECS
  );
  const lifeAgg = group((s) => s.lifeAccountTraffic.metrics, TRAFFIC_SPECS);
  const fanAgg = group((s) => s.fanGroupTraffic.metrics, TRAFFIC_SPECS);

  // 小程序：按 id 对齐多天，每个 tab 聚合
  const miniById = new Map<
    string,
    { name: string; tabs: Record<string, Array<{ date: string; metrics: MetricMap }>> }
  >();
  for (const s of asc) {
    for (const mp of s.miniPrograms || []) {
      let entry = miniById.get(mp.id);
      if (!entry) {
        entry = { name: mp.name, tabs: {} };
        miniById.set(mp.id, entry);
      }
      for (const [tabKey, tabData] of Object.entries(mp.tabs || {})) {
        const arr = entry.tabs[tabKey] ?? [];
        arr.push({ date: s.date, metrics: tabData.metrics || {} });
        entry.tabs[tabKey] = arr;
      }
    }
  }
  const miniPrograms = [...miniById.entries()].map(([id, entry]) => ({
    id,
    name: entry.name,
    tabs: Object.fromEntries(
      Object.entries(entry.tabs).map(([tabKey, arr]) => [
        tabKey,
        aggregateGroup(arr, TRAFFIC_SPECS).metrics,
      ])
    ),
  }));

  return {
    range,
    days,
    dates,
    latestDate: dates[dates.length - 1] ?? null,
    overview: overviewAgg.metrics,
    traffic: {
      overview: trafficOverviewAgg.metrics,
      miniProgramTraffic: trafficMiniAgg.metrics,
      lifeAccountTraffic: trafficLifeAgg.metrics,
      fanGroupTraffic: trafficFanAgg.metrics,
    },
    lifeAccountTraffic: lifeAgg.metrics,
    fanGroupTraffic: fanAgg.metrics,
    trend: {
      overview: overviewAgg.trend,
      trafficOverview: trafficOverviewAgg.trend,
    },
    miniPrograms,
  };
}
