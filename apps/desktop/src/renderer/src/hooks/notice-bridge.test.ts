/**
 * 通知增量：只弹新冒出来的那几条，换会话或整份清单被替换时只重设基线。
 */
import { describe, expect, it } from "vitest";
import { freshNotices, type NoticeCursor, type NoticeLike } from "./notice-bridge.ts";

const EMPTY: NoticeCursor = { count: 0, tail: undefined };

function notice(message: string, level: NoticeLike["level"] = "info"): NoticeLike {
	return { level, message };
}

describe("通知增量", () => {
	it("空清单什么都没有", () => {
		expect(freshNotices(EMPTY, []).fresh).toEqual([]);
	});

	it("游标为零时把现有通知全算成新的（换来源时的基线由调用方先记好）", () => {
		const result = freshNotices(EMPTY, [notice("旧一"), notice("旧二")]);
		expect(result.fresh.map((item) => item.message)).toEqual(["旧一", "旧二"]);
		expect(result.cursor).toEqual({ count: 2, tail: "info:旧二" });
	});

	it("追加的提示只弹新的那条", () => {
		const cursor: NoticeCursor = { count: 1, tail: "info:旧一" };
		const result = freshNotices(cursor, [notice("旧一"), notice("新的", "warning")]);
		expect(result.fresh).toEqual([notice("新的", "warning")]);
		expect(result.cursor).toEqual({ count: 2, tail: "warning:新的" });
	});

	it("一次追加多条时按顺序全弹", () => {
		const cursor: NoticeCursor = { count: 1, tail: "info:旧一" };
		const result = freshNotices(cursor, [notice("旧一"), notice("新一"), notice("新二")]);
		expect(result.fresh.map((item) => item.message)).toEqual(["新一", "新二"]);
	});

	it("整份清单被换掉（切了会话）时只记基线", () => {
		const cursor: NoticeCursor = { count: 2, tail: "info:旧二" };
		const result = freshNotices(cursor, [notice("别的会话一"), notice("别的会话二"), notice("别的会话三")]);
		expect(result.fresh).toEqual([]);
		expect(result.cursor.count).toBe(3);
	});

	it("清单被清空时只记基线", () => {
		const cursor: NoticeCursor = { count: 2, tail: "info:旧二" };
		const result = freshNotices(cursor, []);
		expect(result.fresh).toEqual([]);
		expect(result.cursor).toEqual({ count: 0, tail: undefined });
	});

	it("条数到顶后滚动淘汰时补最后一条", () => {
		const cursor: NoticeCursor = { count: 2, tail: "info:旧二" };
		// 上限把最旧的一条挤掉了，条数不变但尾巴换了
		const result = freshNotices(cursor, [notice("旧二"), notice("滚进来的", "error")]);
		expect(result.fresh).toEqual([notice("滚进来的", "error")]);
	});

	it("条数与尾巴都没变时什么都不弹", () => {
		const cursor: NoticeCursor = { count: 2, tail: "info:旧二" };
		expect(freshNotices(cursor, [notice("旧一"), notice("旧二")]).fresh).toEqual([]);
	});
});
