/**
 * 导入 SmartBI「门店每日完成订单统计」xlsx 到 bi_orders 表。
 *
 * 用法：
 *   # 日度导入（推荐，整日落库、幂等可重跑）：
 *   npx tsx scripts/import-bi-orders.ts <xlsx路径> --date=2026-08-23
 *
 *   # 月度历史回填（不删数据，按订单号建单日近似归属，upsert）：
 *   npx tsx scripts/import-bi-orders.ts <xlsx路径> --seed
 *
 * 说明：
 *  - --date 对应报表里"年月日"筛选的完成日期，导入前会先删除该 data_date 旧数据再插入。
 *  - --seed 用于一次性导入月度报表（无逐行完成日），按订单号前6位建单日近似。
 *  - 两种模式互斥，默认 --seed（不传 --date 即按建单日回填）。
 */
import path from 'path';
import { ensureBiOrdersTable } from '../src/storage/database/ensure-bi-orders';
import { parseBiOrdersWorkbook } from '../src/exporters/bi-order-parser';
import { replaceDateForImport, upsertOrderLines } from '../src/storage/database/order-repo';
import { getPool } from '../src/storage/database/pg-client';
import { aggregateOrders } from '../src/lib/order-agg';

interface Args {
  filePath: string;
  date?: string;
  seed: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let date: string | undefined;
  let seed = false;
  for (const a of argv.slice(2)) {
    if (a.startsWith('--date=')) {
      date = a.slice('--date='.length).trim();
    } else if (a === '--seed') {
      seed = true;
    } else if (!a.startsWith('-')) {
      positional.push(a);
    }
  }
  if (positional.length === 0) {
    console.error('用法: npx tsx scripts/import-bi-orders.ts <xlsx路径> [--date=YYYY-MM-DD | --seed]');
    process.exit(1);
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`--date 格式应为 YYYY-MM-DD，实际：${date}`);
    process.exit(1);
  }
  return { filePath: path.resolve(positional[0]), date, seed };
}

async function main() {
  const args = parseArgs(process.argv);
  const mode: 'daily' | 'seed' = args.date ? 'daily' : 'seed';

  console.log(`📖 解析 BI 报表: ${args.filePath}`);
  console.log(`   模式: ${mode === 'daily' ? `日度整日落库（完成日期 ${args.date}）` : '月度回填（按建单日近似）'}`);

  const { lines, filterYearMonth, filterStatus } = parseBiOrdersWorkbook(args.filePath, {
    completeDate: mode === 'daily' ? args.date : undefined,
  });

  console.log(`   报表筛选: 年月=${filterYearMonth ?? '-'} 状态=${filterStatus ?? '-'}`);
  console.log(`✅ 解析到 ${lines.length} 行明细，${new Set(lines.map((l) => l.order_no)).size} 个唯一订单`);

  // 平台/来源分布快览
  const agg = aggregateOrders(lines);
  console.log('\n   平台分布（按金额）:');
  for (const g of agg.byPlatform) {
    console.log(`     ${g.label.padEnd(6)} 订单${String(g.orderCount).padStart(5)}  金额¥${g.amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}  (${(g.amountShare * 100).toFixed(1)}%)`);
  }
  console.log('   来源分布 top6（按金额）:');
  for (const g of agg.bySource.slice(0, 6)) {
    console.log(`     ${g.label.padEnd(10)} 订单${String(g.orderCount).padStart(5)}  金额¥${g.amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`);
  }

  console.log('\n🗄️  确保 bi_orders 表存在...');
  await ensureBiOrdersTable();

  if (mode === 'daily') {
    const { deleted, inserted } = await replaceDateForImport(args.date!, lines);
    console.log(`✅ 日度导入完成：删除旧行 ${deleted}，插入新行 ${inserted}（完成日期 ${args.date}）`);
  } else {
    const inserted = await upsertOrderLines(lines);
    console.log(`✅ 月度回填完成：upsert ${inserted} 行`);
    if (agg.dateBasisNote) {
      console.log(`   ⚠️  ${agg.dateBasisNote}`);
    }
  }

  await getPool().end();
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ 导入失败:', e);
  process.exit(1);
});
