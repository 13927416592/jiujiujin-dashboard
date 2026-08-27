import { pgTable, serial, timestamp, index, uniqueIndex, varchar, jsonb, text, numeric, integer } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const platformSnapshots = pgTable("platform_snapshots", {
	id: serial().primaryKey().notNull(),
	platform: varchar({ length: 32 }).notNull(),
	dataDate: varchar("data_date", { length: 10 }).notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: 'string' }).notNull(),
	source: varchar({ length: 64 }),
	summary: jsonb(),
	rawData: jsonb("raw_data").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("platform_snapshots_platform_data_date_idx").using("btree", table.platform.asc().nullsLast().op("text_ops"), table.dataDate.asc().nullsLast().op("text_ops")),
	uniqueIndex("platform_snapshots_platform_data_date_uidx").using("btree", table.platform.asc().nullsLast().op("text_ops"), table.dataDate.asc().nullsLast().op("text_ops")),
]);

// 美团门店台账（从经营宝"我的门店"导出，按门店ID关联经营数据）
export const meituanStores = pgTable("meituan_stores", {
	storeId: varchar("store_id", { length: 32 }).primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	brand: varchar({ length: 128 }),
	organization: varchar("organization", { length: 255 }),
	category: varchar({ length: 255 }),
	city: varchar({ length: 64 }),
	address: text(),
	claimStatus: varchar("claim_status", { length: 32 }),
	businessStatus: varchar("business_status", { length: 32 }),
	licenseStatus: varchar("license_status", { length: 32 }),
	qualificationType: varchar("qualification_type", { length: 64 }),
	qualificationNo: varchar("qualification_no", { length: 64 }),
	qualificationEntity: varchar("qualification_entity", { length: 255 }),
	thirdPartyCode: varchar("third_party_code", { length: 64 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("meituan_stores_city_idx").using("btree", table.city.asc().nullsLast().op("text_ops")),
	index("meituan_stores_business_status_idx").using("btree", table.businessStatus.asc().nullsLast().op("text_ops")),
	index("meituan_stores_qualification_entity_idx").using("btree", table.qualificationEntity.asc().nullsLast().op("text_ops")),
]);

// SmartBI「门店每日完成订单统计」明细（一单多行：一个订单编号可对应多条回收物明细行）
// 数据来源：BI 报表 xlsx，由 scripts/import-bi-orders.ts 解析入库。
// 完成日期 = 报表筛选日期（日度导出即"昨天"）；订单编号前 6 位为建单日 YYMMDD，非完成日。
export const biOrders = pgTable("bi_orders", {
	id: serial().primaryKey().notNull(),
	orderNo: varchar("order_no", { length: 32 }).notNull(),       // 订单编号
	lineNo: integer("line_no").notNull(),                        // 同一订单内的明细行序号（从 0 开始），构成 (order_no, line_no) 唯一
	dataDate: varchar("data_date", { length: 10 }).notNull(),     // 完成日期 YYYY-MM-DD（报表筛选日期）
	dateBasis: varchar("date_basis", { length: 16 }).notNull(),   // completed=完成日(日度精确) / created-seed=按建单日近似(月度回填)
	storeName: varchar("store_name", { length: 255 }),            // 门店名称
	storeCode: varchar("store_code", { length: 32 }),             // 从门店名解析的 NO.xxx 编码（线上单可能为空）
	isOnline: integer("is_online").notNull().default(0),          // 是否线上单（门店名以"线上"开头）
	miniApp: varchar("mini_app", { length: 128 }),                // 小程序名称（成交渠道）
	platform: varchar("platform", { length: 32 }).notNull(),      // 归一化成交平台：alipay/wechat/meituan/xinsai/etc
	channelName: varchar("channel_name", { length: 64 }),         // 渠道名称（报表原值）
	sourceName: varchar("source_name", { length: 128 }),          // 来源名称（报表原值，获客归因）
	sourceGroup: varchar("source_group", { length: 32 }).notNull(), // 归一化获客来源：douyin/meituan/dianping/alipay/.../other
	amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // 回收付款（该行实收，元）
	grossWeight: numeric("gross_weight", { precision: 12, scale: 3 }), // 回收毛重（克）
	netWeight: numeric("net_weight", { precision: 12, scale: 3 }),     // 回收净重（克）
	createdDate: varchar("created_date", { length: 10 }),         // 建单日 YYYY-MM-DD（从订单编号前6位解析）
	rawRow: jsonb("raw_row"),                                     // 原始行（排错用）
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("bi_orders_order_line_uidx").using("btree", table.orderNo.asc().nullsLast().op("text_ops"), table.lineNo.asc().nullsLast().op("int4_ops")),
	index("bi_orders_data_date_idx").using("btree", table.dataDate.asc().nullsLast().op("text_ops")),
	index("bi_orders_platform_idx").using("btree", table.platform.asc().nullsLast().op("text_ops")),
	index("bi_orders_source_group_idx").using("btree", table.sourceGroup.asc().nullsLast().op("text_ops")),
	index("bi_orders_store_code_idx").using("btree", table.storeCode.asc().nullsLast().op("text_ops")),
]);
