/**
 * 标签拖拽重排纯逻辑测试。
 *
 * 重点覆盖非等宽标签换位、来回跨越中点不抖动、快甩跨多格与边界夹紧。
 */
import { describe, expect, it } from "vitest";
import {
	hasExceededDragThreshold,
	resolveDraggedTabOrder,
	TAB_DRAG_THRESHOLD_PX,
	type TabStripRect,
} from "./tab-reorder.ts";

const EQUAL_TABS: readonly TabStripRect[] = [
	{ id: "files", left: 0, right: 80, width: 80 },
	{ id: "changes", left: 82, right: 162, width: 80 },
	{ id: "git-graph", left: 164, right: 244, width: 80 },
	{ id: "terminal", left: 246, right: 326, width: 80 },
];

describe("hasExceededDragThreshold", () => {
	it("小于阈值不算拖拽，达到阈值才进入拖拽", () => {
		expect(hasExceededDragThreshold(TAB_DRAG_THRESHOLD_PX - 1, 0)).toBe(false);
		expect(hasExceededDragThreshold(TAB_DRAG_THRESHOLD_PX, 0)).toBe(true);
		expect(hasExceededDragThreshold(3, 3)).toBe(true);
	});
});

describe("resolveDraggedTabOrder", () => {
	it("未越过邻项中点时保持原顺序且其余标签不让位", () => {
		const layout = resolveDraggedTabOrder(EQUAL_TABS, "files", 0, 20);
		expect(layout.targetIndex).toBe(0);
		expect(layout.orderedIds).toEqual(["files", "changes", "git-graph", "terminal"]);
		expect(layout.shifts).toEqual({ changes: 0, "git-graph": 0, terminal: 0 });
		expect(layout.dx).toBe(20);
	});

	it("向右越过邻项中点后交换位置，邻项向左平移一个槽宽", () => {
		// changes 中点是 122；files 右缘 80 + 43 = 123 > 122
		const layout = resolveDraggedTabOrder(EQUAL_TABS, "files", 0, 43);
		expect(layout.targetIndex).toBe(1);
		expect(layout.orderedIds).toEqual(["changes", "files", "git-graph", "terminal"]);
		expect(layout.shifts).toEqual({ changes: -82, "git-graph": 0, terminal: 0 });
	});

	it("快速向右拖动时一次跨越多个标签并让中间项全部左移", () => {
		const layout = resolveDraggedTabOrder(EQUAL_TABS, "files", 0, 220);
		expect(layout.targetIndex).toBe(3);
		expect(layout.orderedIds).toEqual(["changes", "git-graph", "terminal", "files"]);
		expect(layout.shifts).toEqual({ changes: -82, "git-graph": -82, terminal: -82 });
	});

	it("向左拖动越过左侧标签中点后，左侧标签向右平移让位", () => {
		// git-graph 左缘 164；changes 中点 122 -> dx = -43 时左缘 121 < 122
		const layout = resolveDraggedTabOrder(EQUAL_TABS, "git-graph", 2, -43);
		expect(layout.targetIndex).toBe(1);
		expect(layout.orderedIds).toEqual(["files", "git-graph", "changes", "terminal"]);
		expect(layout.shifts).toEqual({ files: 0, changes: 82, terminal: 0 });
	});

	it("非等宽标签互相跨越时只越过半宽即换位，且同一点不会来回抖动", () => {
		const varied: readonly TabStripRect[] = [
			{ id: "files", left: 0, right: 50, width: 50 },
			{ id: "git-graph", left: 52, right: 172, width: 120 },
			{ id: "terminal", left: 174, right: 234, width: 60 },
		];
		// 窄拖过宽：git-graph 中点 112，files 右缘 50 + 63 = 113 > 112
		const forward = resolveDraggedTabOrder(varied, "files", 0, 63);
		expect(forward.targetIndex).toBe(1);
		expect(forward.orderedIds).toEqual(["git-graph", "files", "terminal"]);
		expect(forward.shifts).toEqual({ "git-graph": -52, terminal: 0 });

		// 同一位移再算一次仍稳停在槽位 1，不回跳
		const steady = resolveDraggedTabOrder(varied, "files", forward.targetIndex, 63);
		expect(steady.targetIndex).toBe(1);
		expect(steady.orderedIds).toEqual(["git-graph", "files", "terminal"]);

		// 宽拖过窄：git-graph(120) 拖向 terminal(60)，terminal 中点 204，只需移动 33px
		const wideForward = resolveDraggedTabOrder(varied, "git-graph", 1, 33);
		expect(wideForward.targetIndex).toBe(2);
		expect(wideForward.orderedIds).toEqual(["files", "terminal", "git-graph"]);
		expect(wideForward.shifts).toEqual({ files: 0, terminal: -122 });

		// 同一位移重算依然稳停在槽位 2
		const wideSteady = resolveDraggedTabOrder(varied, "git-graph", wideForward.targetIndex, 33);
		expect(wideSteady.targetIndex).toBe(2);
	});

	it("拖拽位移严格夹在首末标签边界之间", () => {
		const leftClamp = resolveDraggedTabOrder(EQUAL_TABS, "changes", 1, -500);
		expect(leftClamp.dx).toBe(-82);
		expect(leftClamp.targetIndex).toBe(0);

		const rightClamp = resolveDraggedTabOrder(EQUAL_TABS, "changes", 1, 500);
		expect(rightClamp.dx).toBe(164);
		expect(rightClamp.targetIndex).toBe(3);
	});

	it("单标签或找不到标签时保持原状", () => {
		const single = resolveDraggedTabOrder([{ id: "files", left: 0, right: 80, width: 80 }], "files", 0, 50);
		expect(single.dx).toBe(0);
		expect(single.orderedIds).toEqual(["files"]);

		const missing = resolveDraggedTabOrder(EQUAL_TABS, "unknown", 0, 50);
		expect(missing.dx).toBe(0);
		expect(missing.orderedIds).toEqual(["files", "changes", "git-graph", "terminal"]);
	});
});
