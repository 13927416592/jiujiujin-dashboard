import { pgTable, serial, timestamp, index, uniqueIndex, varchar, jsonb, text } from "drizzle-orm/pg-core"
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
