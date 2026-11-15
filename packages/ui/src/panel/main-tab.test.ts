import { describe, expect, it } from "vitest";
import {
	changesTabId,
	commitTabId,
	diffTabId,
	fileTabId,
	normalizeMainTabDropTarget,
	reorderMainTabIds,
	sessionTabId,
	terminalTabId,
} from "./main-tab.ts";

describe("main tab identity", () => {
	it("keeps one tab per session file", () => {
		expect(sessionTabId("/work/a.jsonl", "session-a")).toBe("session:/work/a.jsonl");
	});

	it("separates in-memory sessions by session id", () => {
		expect(sessionTabId(undefined, "session-a")).toBe("session:session-a");
	});

	it("scopes files and diffs by project directory", () => {
		expect(fileTabId("/work/a", "src/app.ts")).toBe("file:/work/a:src/app.ts");
		expect(diffTabId("/work/a", "src/app.ts")).toBe("diff:/work/a:src/app.ts");
	});

	it("keeps one changes document per project", () => {
		expect(changesTabId("/work/a")).toBe("changes:/work/a");
	});

	it("keeps one tab per commit", () => {
		expect(commitTabId("/work/a", "abcdef123456")).toBe("commit:/work/a:abcdef123456");
	});

	it("keeps one tab per terminal", () => {
		expect(terminalTabId("term-1")).toBe("terminal:term-1");
	});

	it("moves a tab before its target", () => {
		expect(reorderMainTabIds([{ id: "a" }, { id: "b" }, { id: "c" }], "c", "a", false)).toEqual([
			"c",
			"a",
			"b",
		]);
	});

	it("moves a tab after its target", () => {
		expect(reorderMainTabIds([{ id: "a" }, { id: "b" }, { id: "c" }], "a", "c", true)).toEqual([
			"b",
			"c",
			"a",
		]);
	});

	it("keeps the order when the drag has no target", () => {
		expect(reorderMainTabIds([{ id: "a" }, { id: "b" }], "a", "missing", false)).toEqual(["a", "b"]);
		expect(reorderMainTabIds([{ id: "a" }, { id: "b" }], "a", "a", true)).toEqual(["a", "b"]);
	});

	it("draws one drop line between adjacent tabs", () => {
		const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
		expect(normalizeMainTabDropTarget(tabs, { id: "b", after: false })).toEqual({ id: "a", after: true });
		expect(normalizeMainTabDropTarget(tabs, { id: "a", after: false })).toEqual({ id: "a", after: false });
		expect(normalizeMainTabDropTarget(tabs, { id: "c", after: true })).toEqual({ id: "c", after: true });
	});

	it("reorders to the same gap from either side", () => {
		const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const beforeB = normalizeMainTabDropTarget(tabs, { id: "b", after: false });
		expect(reorderMainTabIds(tabs, "c", beforeB.id, beforeB.after)).toEqual(["a", "c", "b"]);
		expect(reorderMainTabIds(tabs, "c", "a", true)).toEqual(["a", "c", "b"]);
	});
});
