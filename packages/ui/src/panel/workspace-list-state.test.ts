/**
 * 索引栏宽度。
 *
 * 三条边界各管一段：落盘与读盘收进 `[200, 480]`，拖动上限再受容器宽约束（预览至少留
 * `280px`），容器窄到连下限都放不下时不让索引消失。
 */
import { describe, expect, it } from "vitest";
import {
	clampWorkspaceListWidth,
	readWorkspaceListWidth,
	WORKSPACE_DETAIL_KEEP_WIDTH,
	WORKSPACE_LIST_DEFAULT_WIDTH,
	WORKSPACE_LIST_MAX_WIDTH,
	WORKSPACE_LIST_MIN_WIDTH,
	workspaceListMaxWidth,
	writeWorkspaceListWidth,
} from "./workspace-list-state.ts";

/** 只留在内存里的假存储。 */
function fakeStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		getItem: (key: string): string | null => items.get(key) ?? null,
		setItem: (key: string, value: string): void => {
			items.set(key, value);
		},
	};
}

describe("索引栏宽度", () => {
	it("夹进 [200, 480]，读不懂的回落缺省值", () => {
		expect(clampWorkspaceListWidth(320)).toBe(320);
		expect(clampWorkspaceListWidth(10)).toBe(WORKSPACE_LIST_MIN_WIDTH);
		expect(clampWorkspaceListWidth(9000)).toBe(WORKSPACE_LIST_MAX_WIDTH);
		expect(clampWorkspaceListWidth(319.6)).toBe(320);
		expect(clampWorkspaceListWidth(Number.NaN)).toBe(WORKSPACE_LIST_DEFAULT_WIDTH);
		expect(clampWorkspaceListWidth(undefined)).toBe(WORKSPACE_LIST_DEFAULT_WIDTH);
	});

	it("拖动上限给预览留够地方", () => {
		// 容器 680（刚解锁两栏）：最多 400，正好给预览留下 280
		expect(workspaceListMaxWidth(680)).toBe(680 - WORKSPACE_DETAIL_KEEP_WIDTH);
		// 展宽之后固定上限 480 接管
		expect(workspaceListMaxWidth(1400)).toBe(WORKSPACE_LIST_MAX_WIDTH);
		// 容器窄到连下限都放不下时保下限，不把索引卷成一条
		expect(workspaceListMaxWidth(300)).toBe(WORKSPACE_LIST_MIN_WIDTH);
		// 还没量到宽度（SSR 与首帧）时按上限算，不误伤一次拖动的起点
		expect(workspaceListMaxWidth(0)).toBe(WORKSPACE_LIST_MIN_WIDTH);
		expect(workspaceListMaxWidth(Number.POSITIVE_INFINITY)).toBe(WORKSPACE_LIST_MAX_WIDTH);
	});

	it("读写共用同一个夹紧口径", () => {
		const storage = fakeStorage();
		expect(readWorkspaceListWidth(storage)).toBe(WORKSPACE_LIST_DEFAULT_WIDTH);
		writeWorkspaceListWidth(storage, 420);
		expect(readWorkspaceListWidth(storage)).toBe(420);
		// 落到盘上的也是夹过的值
		writeWorkspaceListWidth(storage, 9999);
		expect(readWorkspaceListWidth(storage)).toBe(WORKSPACE_LIST_MAX_WIDTH);
		// 读不懂的字符串按缺省值处理
		expect(readWorkspaceListWidth(fakeStorage({ "facet.workspace.listWidth": "宽一点" }))).toBe(
			WORKSPACE_LIST_DEFAULT_WIDTH,
		);
	});
});
