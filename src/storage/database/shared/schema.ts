import { pgTable, serial, timestamp, varchar, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

/**
 * 各平台经营数据快照（唯一数据源）
 * - 本地抓取脚本抓完后通过云端 API 上传一行
 * - 看板页面读取各平台最新一行渲染
 * - 平台+数据日期联合唯一：同一天重复抓取则覆盖更新
 */
export const platformSnapshots = pgTable(
	"platform_snapshots",
	{
		id: serial("id").primaryKey(),
		// 平台标识：alipay / meituan / douyin
		platform: varchar("platform", { length: 32 }).notNull(),
		// 数据归属日期（YYYY-MM-DD，按 Asia/Shanghai）
		data_date: varchar("data_date", { length: 10 }).notNull(),
		// 抓取时间（ISO 字符串）
		fetched_at: timestamp("fetched_at", { withTimezone: true, mode: "string" }).notNull(),
		// 抓取脚本/上传者标识，便于排查
		source: varchar("source", { length: 64 }),
		// 看板用的结构化摘要（可选；看板也可直接从 raw_data 解析）
		summary: jsonb("summary"),
		// 抓取器产出的完整原始 JSON（含所有板块指标/表格/bodyText）
		raw_data: jsonb("raw_data").notNull(),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		// 同平台同一天只保留一条，重复上传覆盖
		uniqueIndex("platform_snapshots_platform_data_date_uidx").on(table.platform, table.data_date),
		// 看板按平台查最新一条：WHERE platform = ? ORDER BY data_date DESC
		index("platform_snapshots_platform_data_date_idx").on(table.platform, table.data_date),
	]
);
