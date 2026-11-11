import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { pageOf } from "./paging.ts";

/** 只用到 id 与顺序，其余字段用最小形状占位。 */
function entry(id: string): SessionEntry {
	return {
		type: "model_change",
		id,
		parentId: null,
		timestamp: "2026-11-08T00:00:00Z",
		provider: "p",
		modelId: "m",
	} as SessionEntry;
}

const entries = ["e1", "e2", "e3", "e4", "e5"].map(entry);

describe("历史分页", () => {
	it("没有游标时从末尾取一页", () => {
		const page = pageOf(entries, undefined, 2);
		expect(page.window.map((item) => item.id)).toEqual(["e4", "e5"]);
		expect(page.nextCursor).toBe("e4");
		expect(page.missing).toBe(false);
	});

	it("条数不足一页时取全部，且没有下一页", () => {
		const page = pageOf(entries, undefined, 10);
		expect(page.window.map((item) => item.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
		expect(page.nextCursor).toBeUndefined();
	});

	it("带游标时取它之前的一页", () => {
		const page = pageOf(entries, "e4", 2);
		expect(page.window.map((item) => item.id)).toEqual(["e2", "e3"]);
		expect(page.nextCursor).toBe("e2");
	});

	it("游标在第一条时返回空页", () => {
		const page = pageOf(entries, "e1", 2);
		expect(page.window).toEqual([]);
		expect(page.nextCursor).toBeUndefined();
		expect(page.missing).toBe(false);
	});

	it("游标不在数组里时标记缺失", () => {
		const page = pageOf(entries, "nope", 2);
		expect(page.missing).toBe(true);
		expect(page.window).toEqual([]);
	});

	it("limit 小于 1 时按 1 处理", () => {
		const page = pageOf(entries, undefined, 0);
		expect(page.window.map((item) => item.id)).toEqual(["e5"]);
		expect(page.nextCursor).toBe("e5");
	});

	it("空历史返回空页", () => {
		const page = pageOf([], undefined, 3);
		expect(page.window).toEqual([]);
		expect(page.nextCursor).toBeUndefined();
		expect(page.missing).toBe(false);
	});
});
