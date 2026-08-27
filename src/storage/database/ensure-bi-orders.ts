/**
 * 幂等创建 bi_orders 表（SmartBI 完成订单明细）。
 * 服务端启动/上传前调用，CLI 脚本也可引用。
 */
import { getPool } from './pg-client';

export const ENSURE_BI_ORDERS_SQL = `
CREATE TABLE IF NOT EXISTS bi_orders (
  id            SERIAL PRIMARY KEY,
  order_no      VARCHAR(32)  NOT NULL,
  line_no       INTEGER      NOT NULL,
  data_date     VARCHAR(10)  NOT NULL,
  date_basis    VARCHAR(16)  NOT NULL,
  store_name    VARCHAR(255),
  store_code    VARCHAR(32),
  is_online     INTEGER      NOT NULL DEFAULT 0,
  mini_app      VARCHAR(128),
  platform      VARCHAR(32)  NOT NULL,
  channel_name  VARCHAR(64),
  source_name   VARCHAR(128),
  source_group  VARCHAR(32)  NOT NULL,
  amount        NUMERIC(14,2) NOT NULL,
  gross_weight  NUMERIC(12,3),
  net_weight    NUMERIC(12,3),
  created_date  VARCHAR(10),
  raw_row       JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT bi_orders_order_line_uidx UNIQUE (order_no, line_no)
);

CREATE INDEX IF NOT EXISTS bi_orders_data_date_idx    ON bi_orders (data_date);
CREATE INDEX IF NOT EXISTS bi_orders_platform_idx     ON bi_orders (platform);
CREATE INDEX IF NOT EXISTS bi_orders_source_group_idx ON bi_orders (source_group);
CREATE INDEX IF NOT EXISTS bi_orders_store_code_idx   ON bi_orders (store_code);
`;

export async function ensureBiOrdersTable(): Promise<void> {
  await getPool().query(ENSURE_BI_ORDERS_SQL);
}
