/**
 * 工作区分页的呈现映射。
 *
 * 纯函数：只决定三张分页的名字、图标、计数与可用性，不碰 DOM。
 */
import { describe, expect, it } from "vitest";
import { workspaceTabItems } from "./workspace-tabs.ts";

const TEXT = { files: "文件", changes: "变更", terminal: "终端" };

describe("工作区分页", () => {
	it("三类按固定顺序，名字来自界面语言", () => {
		const items = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: true }, TEXT);
		expect(items.map((item) => item.id)).toEqual(["files", "changes", "terminal"]);
		expect(items.map((item) => item.label)).toEqual(["文件", "变更", "终端"]);
	});

	it("每条都带图标", () => {
		const items = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: true }, TEXT);
		for (const item of items) {
			expect(item.icon).toBeTruthy();
		}
	});

	it("改动数为 0 时不挂计数，有改动才挂", () => {
		const none = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: true }, TEXT);
		expect(none[1]?.badge).toBeUndefined();
		const some = workspaceTabItems({ changes: 7, terminals: 0, canUseTerminal: true }, TEXT);
		expect(some[1]?.badge).toBe(7);
	});

	it("只有一个终端时不挂计数，多于一个才挂", () => {
		const single = workspaceTabItems({ changes: 0, terminals: 1, canUseTerminal: true }, TEXT);
		expect(single[2]?.badge).toBeUndefined();
		const many = workspaceTabItems({ changes: 0, terminals: 2, canUseTerminal: true }, TEXT);
		expect(many[2]?.badge).toBe(2);
	});

	it("主机没有终端能力时终端那一条不可用", () => {
		const items = workspaceTabItems({ changes: 0, terminals: 0, canUseTerminal: false }, TEXT);
		expect(items[2]?.disabled).toBe(true);
		expect(items[0]?.disabled).toBeUndefined();
	});
});
