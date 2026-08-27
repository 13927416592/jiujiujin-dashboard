/**
 * SmartBI「门店每日完成订单统计」报表 xlsx 解析。
 *
 * 报表结构（来自真实导出文件）：
 *   R1: 年月   | 等于 | 2026-08
 *   R2: 状态名称| 等于 | 回收：已完成（同意）
 *   R3: 空行
 *   R4: 订单编号 | 门店名称 | 小程序名称 | 回收付款 | 渠道名称 | 来源名称 | 回收毛重 | 回收净重
 *   R5+: 明细行
 *
 * 注意：
 *  - 一单多行：一个订单编号可对应多条回收物明细（最多 13 条），金额/克重为行级。
 *    订单数需 count(distinct order_no)，金额 sum(amount)。
 *  - 订单编号前 6 位 = YYMMDD 建单日（非完成日）。报表"年月日/年月"筛选的是完成日期。
 *  - 日度导出所有行完成日相同 → dataDate 用筛选日期；月度回填无逐行完成日，用建单日近似。
 *
 * 该解析器是纯函数（输入 xlsx 路径 + 选项 → 结构化行），不访问数据库，可被
 * 服务端上传接口与 CLI 导入脚本共用。
 */

import * as XLSX from 'xlsx';

/** 归一化后的成交平台（对应"小程序名称"）。 */
export type OrderPlatform =
  | 'alipay' // 支付宝黄金回收 / 鑫赛道支付宝小程序 / 中国珠宝贵金属回收平台(支付宝侧)
  | 'wechat' // 微信黄金回收 / 微信黄金价格
  | 'meituan' // 美团黄金回收小程序
  | 'xinsai' // 鑫赛道
  | 'other';

/** 归一化后的获客来源组（对应"来源名称"，用于跨平台 ROI 归因）。 */
export type SourceGroup =
  | 'douyin' // 抖音
  | 'meituan' // 美团 / 美团服务商
  | 'dianping' // 大众点评
  | 'alipay' // 支付宝 / 蚂蚁回收
  | 'wechat' // 微信
  | 'xiaohongshu' // 小红书
  | 'doubao' // 豆包
  | 'map' // 地图搜索(高德/百度/腾讯)
  | 'referral' // 客户转介绍
  | 'repeat' // 老客复购
  | 'walkin' // 商场逛街路过
  | 'other'; // 其余 / 未填写

/** 解析后的一条订单明细行（已归一化）。字段命名与 bi_orders 表 / 聚合层保持 snake_case 一致。 */
export interface ParsedOrderLine {
  order_no: string;
  line_no: number; // 同订单内行序号，从 0 开始
  data_date: string; // YYYY-MM-DD 完成日期
  date_basis: 'completed' | 'created-seed';
  store_name: string | null;
  store_code: string | null;
  is_online: boolean;
  mini_app: string | null;
  platform: OrderPlatform;
  channel_name: string | null;
  source_name: string | null;
  source_group: SourceGroup;
  amount: number;
  gross_weight: number | null;
  net_weight: number | null;
  created_date: string | null;
  raw_row: Record<string, unknown>;
}

export interface ParseBiOrdersOptions {
  /**
   * 完成日期（YYYY-MM-DD）。
   * - 日度导出：传报表筛选日期（昨天），所有行用它作为 dataDate，dateBasis=completed。
   * - 月度回填：不传，改用订单号前 6 位建单日作为 dataDate，dateBasis=created-seed。
   */
  completeDate?: string;
  /** 报表筛选状态文案（仅校验用，默认"回收：已完成（同意）"）。 */
  expectStatus?: string;
}

export interface ParseBiOrdersResult {
  lines: ParsedOrderLine[];
  /** 报表头读到的"年月"筛选值（如 2026-08），没有则 null。 */
  filterYearMonth: string | null;
  /** 报表头读到的状态筛选值。 */
  filterStatus: string | null;
}

const HEADER_KEYS = ['订单编号', '门店名称', '小程序名称', '回收付款', '渠道名称', '来源名称', '回收毛重', '回收净重'];

function cleanStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 从订单编号前 6 位解析建单日：YYMMDD → 20YY-MM-DD。 */
export function parseCreatedDate(orderNo: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})/.exec(orderNo.trim());
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** 从门店名解析 NO.xxx 门店编码（含"线上-XX店NO.xxx"）。 */
export function parseStoreCode(storeName: string | null): string | null {
  if (!storeName) return null;
  const m = /NO\.?\s*([A-Za-z0-9]+)/i.exec(storeName);
  return m ? m[1].toUpperCase() : null;
}

function isOnlineStore(storeName: string | null): boolean {
  return !!storeName && storeName.startsWith('线上');
}

/** 小程序名称 → 成交平台。 */
export function normalizePlatform(miniApp: string | null): OrderPlatform {
  if (!miniApp) return 'other';
  const s = miniApp;
  if (s.includes('支付宝')) return 'alipay';
  if (s.startsWith('微信')) return 'wechat';
  if (s.includes('美团')) return 'meituan';
  if (s.includes('鑫赛道')) return 'xinsai';
  return 'other';
}

/** 来源名称 → 获客来源组。 */
export function normalizeSourceGroup(sourceName: string | null): SourceGroup {
  if (!sourceName) return 'other';
  const s = sourceName;
  if (s.includes('抖音')) return 'douyin';
  if (s.includes('美团')) return 'meituan';
  if (s.includes('大众点评') || s.includes('点评')) return 'dianping';
  if (s.includes('蚂蚁回收') || s.includes('支付宝')) return 'alipay';
  if (s.includes('微信')) return 'wechat';
  if (s.includes('小红书')) return 'xiaohongshu';
  if (s.includes('豆包')) return 'doubao';
  if (s.includes('地图')) return 'map';
  if (s.includes('转介绍')) return 'referral';
  if (s.includes('老客') || s.includes('复购')) return 'repeat';
  if (s.includes('逛街') || s.includes('路过') || s.includes('商场')) return 'walkin';
  return 'other';
}

/** 平台/来源的中文展示名（聚合输出与前端复用）。 */
export const PLATFORM_LABELS: Record<OrderPlatform, string> = {
  alipay: '支付宝',
  wechat: '微信',
  meituan: '美团',
  xinsai: '鑫赛道',
  other: '其他',
};

export const SOURCE_GROUP_LABELS: Record<SourceGroup, string> = {
  douyin: '抖音',
  meituan: '美团',
  dianping: '大众点评',
  alipay: '支付宝/蚂蚁',
  wechat: '微信',
  xiaohongshu: '小红书',
  doubao: '豆包',
  map: '地图搜索',
  referral: '转介绍',
  repeat: '老客复购',
  walkin: '商场路过',
  other: '其他/未填',
};

interface RawMatrix {
  matrix: unknown[][];
  filterYearMonth: string | null;
  filterStatus: string | null;
  headerRowIndex: number;
}

/** 读取工作表并定位表头行（报表前 3 行是筛选条件，表头含"订单编号"）。 */
function readMatrix(filePath: string): RawMatrix {
  const workbook = XLSX.readFile(filePath);
  return matrixFromWorkbook(workbook);
}

/** 与 readMatrix 相同，但直接从内存 Buffer 读取（用于上传接口，避免沙箱落盘跨进程不可见）。 */
export function parseBiOrdersBuffer(
  buf: Buffer,
  options: ParseBiOrdersOptions = {}
): ParseBiOrdersResult {
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const { matrix, filterYearMonth, filterStatus, headerRowIndex } = matrixFromWorkbook(workbook);
  return buildResult(matrix, filterYearMonth, filterStatus, headerRowIndex, options);
}

function matrixFromWorkbook(workbook: XLSX.WorkBook): RawMatrix {
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Excel 中未找到工作表：${sheetName}`);
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];

  let headerRowIndex = -1;
  let filterYearMonth: string | null = null;
  let filterStatus: string | null = null;

  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    const row = matrix[r] ?? [];
    const first = cleanStr(row[0]);
    const third = cleanStr(row[2]);
    if (first === '年月') filterYearMonth = third;
    if (first === '状态名称') filterStatus = third;
    // 表头判定：第一列是"订单编号"
    if (first === '订单编号') {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('未找到表头行（第一列应为"订单编号"），文件可能不是 SmartBI 完成订单报表');
  }

  return { matrix, filterYearMonth, filterStatus, headerRowIndex };
}

/**
 * 解析 BI 完成订单报表 xlsx，返回逐行明细（已归一化、含行号）。
 */
export function parseBiOrdersWorkbook(
  filePath: string,
  options: ParseBiOrdersOptions = {}
): ParseBiOrdersResult {
  const { matrix, filterYearMonth, filterStatus, headerRowIndex } = readMatrix(filePath);
  return buildResult(matrix, filterYearMonth, filterStatus, headerRowIndex, options);
}

function buildResult(
  matrix: unknown[][],
  filterYearMonth: string | null,
  filterStatus: string | null,
  headerRowIndex: number,
  options: ParseBiOrdersOptions
): ParseBiOrdersResult {

  if (options.expectStatus && filterStatus && !filterStatus.includes('已完成')) {
    throw new Error(`报表状态筛选不是"已完成"，实际为：${filterStatus}`);
  }

  // 按列标题定位列序号（报表列顺序稳定，但仍按名称匹配以容错）
  const headerRow = matrix[headerRowIndex] ?? [];
  const colIndex: Record<string, number> = {};
  for (let c = 0; c < headerRow.length; c++) {
    const name = cleanStr(headerRow[c]);
    if (name) colIndex[name] = c;
  }
  for (const key of HEADER_KEYS) {
    if (!(key in colIndex)) {
      throw new Error(`报表缺少必要列：${key}`);
    }
  }

  const seedMode = !options.completeDate;
  const lineNoByOrder = new Map<string, number>();
  const lines: ParsedOrderLine[] = [];

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const rawRow = matrix[r] ?? [];
    const orderNo = cleanStr(rawRow[colIndex['订单编号']]);
    if (!orderNo) continue;

    const storeName = cleanStr(rawRow[colIndex['门店名称']]);
    const miniApp = cleanStr(rawRow[colIndex['小程序名称']]);
    const channelName = cleanStr(rawRow[colIndex['渠道名称']]);
    const sourceName = cleanStr(rawRow[colIndex['来源名称']]);
    const amount = toNum(rawRow[colIndex['回收付款']]) ?? 0;
    const grossWeight = toNum(rawRow[colIndex['回收毛重']]);
    const netWeight = toNum(rawRow[colIndex['回收净重']]);

    const createdDate = parseCreatedDate(orderNo);
    const lineNo = lineNoByOrder.get(orderNo) ?? 0;
    lineNoByOrder.set(orderNo, lineNo + 1);

    // 完成日期：日度精确 → completeDate；月度回填 → 建单日近似
    const dataDate = seedMode ? createdDate ?? options.completeDate ?? '' : options.completeDate!;
    if (!dataDate) {
      throw new Error(`订单 ${orderNo} 无法解析建单日，且未提供 completeDate`);
    }

    const raw: Record<string, unknown> = {};
    for (const key of HEADER_KEYS) {
      raw[key] = rawRow[colIndex[key]] ?? '';
    }

    lines.push({
      order_no: orderNo,
      line_no: lineNo,
      data_date: dataDate,
      date_basis: seedMode ? 'created-seed' : 'completed',
      store_name: storeName,
      store_code: parseStoreCode(storeName),
      is_online: isOnlineStore(storeName),
      mini_app: miniApp,
      platform: normalizePlatform(miniApp),
      channel_name: channelName,
      source_name: sourceName,
      source_group: normalizeSourceGroup(sourceName),
      amount,
      gross_weight: grossWeight,
      net_weight: netWeight,
      created_date: createdDate,
      raw_row: raw,
    });
  }

  return { lines, filterYearMonth, filterStatus };
}
