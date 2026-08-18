/**
 * 美团经营宝报表 xlsx 解析。
 *
 * 报表为双行表头：
 *   第1行主表头：日期 / 1级组织名 / 2级组织名 / 运营成本 / 客流分析 / 交易分析 / ...（分组合并）
 *   第2行子表头：推广通消耗金额(元) / 环比 / 曝光人数(人) / 环比 / ...
 * 默认 sheet_to_json 会把列拍成"客流分析 / 客流分析_1 / 客流分析_4"，丢失指标含义。
 *
 * 这里用前两行合成语义化列名：
 *   - 维度列（日期/1级组织名/2级组织名）直接用子表头
 *   - 指标列用子表头（如"曝光人数(人)"）
 *   - 紧跟在指标后的"环比"列命名为"<指标>__环比"，便于按需排除
 *
 * 导出的对象行即为 1:1 数据结构（仅列名语义化），不在解析层做任何指标裁剪。
 */

import * as XLSX from 'xlsx';

export type MeituanRow = Record<string, string | number>;

/**
 * 根据主/子表头生成最终列名数组。
 */
export function buildMeituanColumnNames(mainHeader: unknown[], subHeader: unknown[]): string[] {
  const colCount = Math.max(mainHeader.length, subHeader.length);
  const names: string[] = [];
  let prevMetric: string | null = null;

  for (let i = 0; i < colCount; i++) {
    const sub = String(subHeader[i] ?? '').trim();
    const main = String(mainHeader[i] ?? '').trim();

    // 前 3 列固定为维度
    if (i <= 2) {
      const name = sub || main;
      names.push(name);
      prevMetric = null;
      continue;
    }

    if (sub === '环比') {
      names.push(prevMetric ? `${prevMetric}__环比` : `列${i}__环比`);
    } else {
      names.push(sub || main || `列${i}`);
      prevMetric = sub || main || null;
    }
  }

  return names;
}

/**
 * 判断列名是否为环比列。
 */
export function isHuanbiColumn(columnName: string): boolean {
  return columnName.endsWith('__环比');
}

export interface ParseMeituanOptions {
  /** 剔除所有环比列（首次导入30天历史数据时使用）。默认 false，全量保留。 */
  dropHuanbi?: boolean;
}

/**
 * 解析美团报表 xlsx，返回 1:1 行数据（已过滤表头占位行）。
 */
export function parseMeituanWorkbook(filePath: string, options: ParseMeituanOptions = {}): MeituanRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Excel 文件中未找到工作表：${sheetName}`);
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (matrix.length < 3) {
    return [];
  }

  const mainHeader = (matrix[0] as unknown[]) ?? [];
  const subHeader = (matrix[1] as unknown[]) ?? [];
  const allNames = buildMeituanColumnNames(mainHeader, subHeader);

  // 按需剔除环比列（保留原列序号，避免错位）
  const wantedIndexes = allNames
    .map((name, idx) => ({ name, idx }))
    .filter(({ name }) => (options.dropHuanbi ? !isHuanbiColumn(name) : true))
    .map(({ idx }) => idx);

  const rows: MeituanRow[] = [];
  // 数据从第 3 行（index 2）开始
  for (let r = 2; r < matrix.length; r++) {
    const rawRow = (matrix[r] as unknown[]) ?? [];
    // 跳过整行空行或表头占位行（日期列等于"日期"）
    const dateCell = String(rawRow[0] ?? '').trim();
    if (!dateCell || dateCell === '日期') continue;

    const obj: MeituanRow = {};
    for (const idx of wantedIndexes) {
      const key = allNames[idx];
      let v: unknown = rawRow[idx] ?? '';
      if (v !== null && v !== undefined && typeof v !== 'number') {
        v = String(v).trim();
      }
      obj[key] = v as string | number;
    }
    rows.push(obj);
  }

  return rows;
}
