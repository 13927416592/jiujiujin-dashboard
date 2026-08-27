/**
 * 幂等创建 bi_orders 表（SmartBI 完成订单明细）。
 *
 * 用法：npx tsx scripts/ensure-bi-orders-table.ts
 * 实际建表逻辑在 src/storage/database/ensure-bi-orders.ts，
 * 服务端上传接口与 CLI 导入前会自动调用，一般无需手动执行。
 */
import { ensureBiOrdersTable } from '../src/storage/database/ensure-bi-orders';
import { getPool } from '../src/storage/database/pg-client';

ensureBiOrdersTable()
  .then(() => {
    console.log('✅ bi_orders 表已就绪');
    return getPool().end();
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ 建表失败:', e);
    process.exit(1);
  });
