/**
 * 工作区工具的呈现映射。
 *
 * 纯函数：只决定四件工具的名字、图标、计数、可用性与快捷键提示，不碰 DOM。
 */
import { describe, expect, it } from "vitest";
import { workspaceTabItems } from "./workspace-tabs.ts";

const TEXT = { files: "文件", changes: "变更", gitGraph: "提交图谱", terminal: "终端", browser: "浏览器" };

describe("工作区工具", () => {
	it("五类按固定顺序，名字来自界面语言", () => {
		const items = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: true }, TEXT, false);
		expect(items.map((item) => item.id)).toEqual(["files", "changes", "git-graph", "terminal", "browser"]);
		expect(items.map((item) => item.label)).toEqual(["文件", "变更", "提交图谱", "终端", "浏览器"]);
	});

	it("每条都带图标", () => {
		const items = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: true }, TEXT, false);
		for (const item of items) {
			expect(item.icon).toBeTruthy();
		}
	});

	it("改动数为 0 时不挂计数，有改动才挂", () => {
		const none = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: true }, TEXT, false);
		expect(none[1]?.badge).toBeUndefined();
		const some = workspaceTabItems({ changes: 7, terminals: 0, canUseTerminal: true }, TEXT, false);
		expect(some[1]?.badge).toBe(7);
	});

	it("提交图谱不挂计数：它是历史，不是待办", () => {
		const items = workspaceTabItems({ changes: 9, terminals: 3, canUseTerminal: true }, TEXT, false);
		expect(items[2]?.id).toBe("git-graph");
		expect(items[2]?.badge).toBeUndefined();
	});

	it("只有一个终端时不挂计数，多于一个才挂", () => {
		const single = workspaceTabItems({ changes: 0, terminals: 1, canUseTerminal: true }, TEXT, false);
		expect(single[3]?.badge).toBeUndefined();
		const many = workspaceTabItems({ changes: 0, terminals: 2, canUseTerminal: true }, TEXT, false);
		expect(many[3]?.badge).toBe(2);
	});

	it("主机没有终端能力时终端那一条不可用", () => {
		const items = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: false }, TEXT, false);
		expect(items[3]?.disabled).toBe(true);
		expect(items[0]?.disabled).toBeUndefined();
	});

	it("快捷键提示按平台写，且与真实绑定同源", () => {
		const other = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: true }, TEXT, false);
		expect(other.map((item) => item.shortcut)).toEqual([
			"Ctrl+Shift+E",
			"Ctrl+Shift+G",
			"Ctrl+Shift+H",
			"Ctrl+`",
			"Ctrl+Shift+B",
		]);
		const mac = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: true }, TEXT, true);
		expect(mac.map((item) => item.shortcut)).toEqual(["⌘⇧E", "⌘⇧G", "⌘⇧H", "⌘`", "⌘⇧B"]);
	});
});
