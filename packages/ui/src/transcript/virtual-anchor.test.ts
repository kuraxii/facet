import { describe, expect, it } from "vitest";
import type { DisplayRow } from "./group.ts";
import {
	buildGridPlan,
	estimateRowHeight,
	extractPinnedRange,
	MAX_SELECTION_PIN_SPAN,
	resolveAnchorRowId,
	VIRTUAL_ROW_GAP,
	VIRTUAL_SCROLL_MARGIN,
	type VirtualSpan,
} from "./virtual-anchor.ts";

/** 拼一段虚拟项：高度等分，行程按 `gap` 递推。 */
function spans(
	heights: readonly number[],
	gap = VIRTUAL_ROW_GAP,
	origin = VIRTUAL_SCROLL_MARGIN,
): VirtualSpan[] {
	let start = origin;
	return heights.map((size, index) => {
		const span = { index, start, end: start + size };
		start += size + gap;
		return span;
	});
}

/** 只取某几项（模拟窗口 + 钉行造成的非连续）。 */
function pick(all: readonly VirtualSpan[], indexes: readonly number[]): VirtualSpan[] {
	const byIndex = new Map(all.map((span) => [span.index, span]));
	return indexes.map((index) => {
		const span = byIndex.get(index);
		if (span === undefined) {
			throw new Error(`no span ${index}`);
		}
		return span;
	});
}

describe("estimateRowHeight", () => {
	const row = (kind: DisplayRow["kind"]): Pick<DisplayRow, "kind"> => ({ kind });

	it("按种类分型：用户行、助手行、过程行各一档", () => {
		expect(estimateRowHeight(row("user"), false)).toBe(80);
		expect(estimateRowHeight(row("assistant"), false)).toBe(120);
	});

	it("过程行收起与展开差一个量级", () => {
		const collapsed = estimateRowHeight(row("meta"), true);
		const expanded = estimateRowHeight(row("meta"), false);
		expect(collapsed).toBe(44);
		expect(expanded).toBe(220);
		expect(expanded).toBeGreaterThan(collapsed * 4);
	});

	it("分隔与重试行是一行字的高度，分叉行再矮一档（它带 -6px 上外边距）", () => {
		expect(estimateRowHeight(row("divider"), false)).toBe(28);
		expect(estimateRowHeight(row("error"), false)).toBe(28);
		expect(estimateRowHeight(row("fork"), false)).toBe(22);
	});
});

describe("buildGridPlan", () => {
	const all = spans([100, 200, 50, 300]);
	// 虚拟化器的 getTotalSize()：最后一项的 end，已经含 scrollMargin
	const totalSize = VIRTUAL_SCROLL_MARGIN + 100 + 200 + 50 + 300 + 3 * VIRTUAL_ROW_GAP;

	it("全部可见时不插占位，前后留白刚好补齐总高", () => {
		const plan = buildGridPlan({
			items: all,
			totalSize,
			gap: VIRTUAL_ROW_GAP,
			scrollMargin: VIRTUAL_SCROLL_MARGIN,
		});
		expect(plan.segments).toEqual([
			{ kind: "row", index: 0 },
			{ kind: "row", index: 1 },
			{ kind: "row", index: 2 },
			{ kind: "row", index: 3 },
		]);
		// 首项就在列表起点上，前面没有要留的空白
		expect(plan.paddingTop).toBe(0);
		// 末项就是最后一行：留白为 0
		expect(plan.paddingBottom).toBe(0);
		// 整列高度 + `.scroll` 的上内边距 = 虚拟总高
		expect(plan.paddingTop + (all[3]?.end as number) - (all[0]?.start as number) + plan.paddingBottom).toBe(
			totalSize - VIRTUAL_SCROLL_MARGIN,
		);
	});

	it("只挂中间一段时，前后留白把两端补齐", () => {
		const plan = buildGridPlan({
			items: pick(all, [1, 2]),
			totalSize,
			gap: VIRTUAL_ROW_GAP,
			scrollMargin: VIRTUAL_SCROLL_MARGIN,
		});
		expect(plan.paddingTop).toBe(
			all[1]?.start === undefined ? -1 : (all[1].start as number) - VIRTUAL_SCROLL_MARGIN,
		);
		expect(plan.paddingBottom).toBe(totalSize - (all[2]?.end as number));
	});

	it("跳过的行折成一个 spacer，加上两侧 row-gap 正好等于真实间距", () => {
		const plan = buildGridPlan({
			items: pick(all, [0, 3]),
			totalSize,
			gap: VIRTUAL_ROW_GAP,
			scrollMargin: VIRTUAL_SCROLL_MARGIN,
		});
		const spacer = plan.segments[1];
		if (spacer?.kind !== "spacer") {
			throw new Error("expected spacer");
		}
		const previous = all[0];
		const next = all[3];
		if (previous === undefined || next === undefined) {
			throw new Error("bad fixture");
		}
		// DOM 里这两项之间是 gap + spacer + gap，必须严丝合缝地等于虚拟坐标差
		expect(VIRTUAL_ROW_GAP + spacer.height + VIRTUAL_ROW_GAP).toBe(next.start - previous.end);
	});

	it("相邻两项之间不插 spacer：一个 row-gap 就是它们的距离", () => {
		const plan = buildGridPlan({
			items: pick(all, [0, 1]),
			totalSize,
			gap: VIRTUAL_ROW_GAP,
			scrollMargin: VIRTUAL_SCROLL_MARGIN,
		});
		expect(plan.segments.some((segment) => segment.kind === "spacer")).toBe(false);
		expect((all[1]?.start as number) - (all[0]?.end as number)).toBe(VIRTUAL_ROW_GAP);
	});

	it("只有一两行的短会话：不留多余空白，顶边就是列表起点", () => {
		const short = spans([113]);
		const total = VIRTUAL_SCROLL_MARGIN + 113;
		const plan = buildGridPlan({
			items: short,
			totalSize: total,
			gap: VIRTUAL_ROW_GAP,
			scrollMargin: VIRTUAL_SCROLL_MARGIN,
		});
		expect(plan.segments).toEqual([{ kind: "row", index: 0 }]);
		// 内容比视口矮时上下都不该有留白，否则会凭空多出可滚的余量
		expect(plan.paddingTop).toBe(0);
		expect(plan.paddingBottom).toBe(0);
	});

	it("相邻两行之间只隔一个 row-gap，没有 spacer", () => {
		const pair = spans([80, 120]);
		const total = VIRTUAL_SCROLL_MARGIN + 80 + VIRTUAL_ROW_GAP + 120;
		const plan = buildGridPlan({
			items: pair,
			totalSize: total,
			gap: VIRTUAL_ROW_GAP,
			scrollMargin: VIRTUAL_SCROLL_MARGIN,
		});
		expect(plan.segments.some((segment) => segment.kind === "spacer")).toBe(false);
		expect(plan.paddingBottom).toBe(0);
	});

	it("跳过的行比一个 row-gap 还矮时 spacer 被夹到 0（现网不可达，最小行高 28）", () => {
		// 两行相距只有一个 gap 的一半：这种间距在真实行表里不会出现（每行至少 28px），
		// 这里只把钳制的行为写死，免得日后有人以为漏算了
		const tight: VirtualSpan[] = [
			{ index: 0, start: VIRTUAL_SCROLL_MARGIN, end: VIRTUAL_SCROLL_MARGIN + 100 },
			{
				index: 3,
				start: VIRTUAL_SCROLL_MARGIN + 100 + VIRTUAL_ROW_GAP / 2,
				end: VIRTUAL_SCROLL_MARGIN + 200,
			},
		];
		const plan = buildGridPlan({
			items: tight,
			totalSize: VIRTUAL_SCROLL_MARGIN + 200,
			gap: VIRTUAL_ROW_GAP,
			scrollMargin: VIRTUAL_SCROLL_MARGIN,
		});
		const spacer = plan.segments[1];
		expect(spacer?.kind === "spacer" ? spacer.height : -1).toBe(0);
	});

	it("空窗口给空计划", () => {
		expect(
			buildGridPlan({ items: [], totalSize, gap: VIRTUAL_ROW_GAP, scrollMargin: VIRTUAL_SCROLL_MARGIN }),
		).toEqual({
			paddingTop: 0,
			paddingBottom: 0,
			segments: [],
		});
	});
});

describe("extractPinnedRange", () => {
	const rows = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
	const index = new Map(rows.map((id, at) => [id, at]));
	const rowIndexOf = (id: string): number | undefined => index.get(id);
	const range = (
		startIndex: number,
		endIndex: number,
		overscan = 1,
		count = rows.length,
	): RangeExtractInput["range"] => ({
		startIndex,
		endIndex,
		overscan,
		count,
	});

	it("可见窗口加 overscan，升序去重", () => {
		expect(extractPinnedRange({ range: range(4, 6), selection: null, rowIndexOf })).toEqual([3, 4, 5, 6, 7]);
	});

	it("overscan 在两端各被边界截住", () => {
		expect(extractPinnedRange({ range: range(0, 1, 3), selection: null, rowIndexOf })).toEqual([
			0, 1, 2, 3, 4,
		]);
		expect(extractPinnedRange({ range: range(8, 9, 3), selection: null, rowIndexOf })).toEqual([
			5, 6, 7, 8, 9,
		]);
	});

	it("拖选跨过的整段都钉住，与可见窗口合并去重", () => {
		expect(extractPinnedRange({ range: range(3, 8, 0), selection: ["b", "e"], rowIndexOf })).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8,
		]);
	});

	it("从下往上拖选也按升序给", () => {
		expect(extractPinnedRange({ range: range(4, 4, 0), selection: ["g", "c"], rowIndexOf })).toEqual([
			2, 3, 4, 5, 6,
		]);
	});

	it("跨过太多行时只钉两端，不把整段历史挂上去", () => {
		const long = Array.from({ length: 400 }, (_, at) => `row-${at}`);
		const longIndex = new Map(long.map((id, at) => [id, at]));
		const picked = extractPinnedRange({
			range: range(200, 205, 0, long.length),
			selection: ["row-1", "row-390"],
			rowIndexOf: (id) => longIndex.get(id),
		});
		expect(picked).toEqual([200, 201, 202, 203, 204, 205, 1, 390].sort((left, right) => left - right));
		expect(picked.length).toBeLessThan(MAX_SELECTION_PIN_SPAN);
	});

	it("不认识的标识与空选区都静默跳过", () => {
		expect(extractPinnedRange({ range: range(2, 3, 0), selection: ["gone", "b"], rowIndexOf })).toEqual([
			2, 3,
		]);
		expect(extractPinnedRange({ range: range(2, 3, 0), selection: null, rowIndexOf })).toEqual([2, 3]);
	});

	it("跨度刚好等于上限时整段钉住，超一行就只钉两端", () => {
		const many = Array.from({ length: 100 }, (_, at) => `r${at}`);
		const index = new Map(many.map((id, at) => [id, at]));
		const rowIndexOfMany = (id: string): number | undefined => index.get(id);
		const at = (span: number): number[] =>
			extractPinnedRange({
				range: { startIndex: 90, endIndex: 90, overscan: 0, count: many.length },
				selection: ["r0", `r${span}`],
				rowIndexOf: rowIndexOfMany,
			});
		// 0..60 是个闭区间，跨度 60 行 = 61 个下标，正好等于上限
		expect(at(MAX_SELECTION_PIN_SPAN).length).toBe(MAX_SELECTION_PIN_SPAN + 2);
		expect(at(MAX_SELECTION_PIN_SPAN + 1)).toEqual([0, MAX_SELECTION_PIN_SPAN + 1, 90]);
	});

	it("一行都没有时返回空", () => {
		expect(extractPinnedRange({ range: range(0, 0, 2, 0), selection: null, rowIndexOf })).toEqual([]);
	});
});

describe("resolveAnchorRowId", () => {
	it("换过一次标识就换到新的", () => {
		expect(resolveAnchorRowId("m1", { m1: "e:e9" })).toBe("e:e9");
	});

	it("连着换过几次也能跟到底", () => {
		expect(resolveAnchorRowId("m1", { m1: "m2", m2: "e:e9" })).toBe("e:e9");
	});

	it("没记过的标识原样返回", () => {
		expect(resolveAnchorRowId("e:e9", { m1: "e:e9" })).toBe("e:e9");
	});

	it("映射到自己时不会绕圈", () => {
		expect(resolveAnchorRowId("m1", { m1: "m1" })).toBe("m1");
	});

	it("脏数据成环时按跳数上限收手", () => {
		const resolved = resolveAnchorRowId("m1", { m1: "m2", m2: "m1" });
		expect(["m1", "m2"]).toContain(resolved);
	});
});

type RangeExtractInput = Parameters<typeof extractPinnedRange>[0];
