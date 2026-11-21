/**
 * 文件树的宽度：落盘边界、非法值回落与容器 budget。
 *
 * 纯函数，只钉三件事：读盘读不懂时回缺省、落盘收在 `[180, 420]`、拖动上限还受容器宽约束
 * （右侧留 120px 给编辑器）。
 */
import { describe, expect, it } from "vitest";
import {
	clampFileTreeWidth,
	EDITOR_KEEP_WIDTH,
	FILE_TREE_DEFAULT_WIDTH,
	FILE_TREE_MAX_WIDTH,
	FILE_TREE_MIN_WIDTH,
	type FileTreeStorage,
	fileTreeMaxWidth,
	readFileTreeWidth,
	writeFileTreeWidth,
} from "./file-tree-state.ts";

/** 内存里的本地存储。 */
function createStorage(
	initial: Record<string, string> = {},
): FileTreeStorage & { data: Record<string, string> } {
	const data = { ...initial };
	return {
		data,
		getItem: (key) => data[key] ?? null,
		setItem: (key, value) => {
			data[key] = value;
		},
	};
}

describe("悬浮文件树的宽度", () => {
	it("边界是 180 / 240 / 420，编辑器保底 120", () => {
		expect(FILE_TREE_MIN_WIDTH).toBe(180);
		expect(FILE_TREE_DEFAULT_WIDTH).toBe(240);
		expect(FILE_TREE_MAX_WIDTH).toBe(420);
		expect(EDITOR_KEEP_WIDTH).toBe(120);
	});

	it("没有记录时用缺省值", () => {
		expect(readFileTreeWidth(createStorage())).toBe(FILE_TREE_DEFAULT_WIDTH);
	});

	it("读回写下的宽度，取整、收进上下限", () => {
		const storage = createStorage();
		writeFileTreeWidth(storage, 300.6);
		expect(storage.data["facet.files.treeWidth"]).toBe("301");
		expect(readFileTreeWidth(storage)).toBe(301);
	});

	it("超上限收进 420，低于下限收进 180，读不懂回缺省", () => {
		expect(readFileTreeWidth(createStorage({ "facet.files.treeWidth": "9999" }))).toBe(FILE_TREE_MAX_WIDTH);
		expect(readFileTreeWidth(createStorage({ "facet.files.treeWidth": "10" }))).toBe(FILE_TREE_MIN_WIDTH);
		expect(readFileTreeWidth(createStorage({ "facet.files.treeWidth": "宽" }))).toBe(FILE_TREE_DEFAULT_WIDTH);
	});

	it("clampFileTreeWidth 收进上下限", () => {
		expect(clampFileTreeWidth(420)).toBe(420);
		expect(clampFileTreeWidth(421)).toBe(420);
		expect(clampFileTreeWidth(179)).toBe(180);
		expect(clampFileTreeWidth(Number.NaN)).toBe(FILE_TREE_DEFAULT_WIDTH);
	});

	it("拖动上限还受容器宽约束：右侧留出 120px 给编辑器", () => {
		// 宽容器：上限就是 420
		expect(fileTreeMaxWidth(1200)).toBe(420);
		expect(fileTreeMaxWidth(540)).toBe(420);
		// 右栏只有 320 时只能到 200
		expect(fileTreeMaxWidth(320)).toBe(320 - EDITOR_KEEP_WIDTH);
		// 右栏到下限 300 时只剩 180，正好是树的下限
		expect(fileTreeMaxWidth(300)).toBe(FILE_TREE_MIN_WIDTH);
		// 容器窄到连下限都放不下：回落下限，编辑器让到最后一条缝
		expect(fileTreeMaxWidth(200)).toBe(FILE_TREE_MIN_WIDTH);
		// 读不懂的容器宽按上限处理
		expect(fileTreeMaxWidth(Number.NaN)).toBe(FILE_TREE_MAX_WIDTH);
	});
});
