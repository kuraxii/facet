/**
 * 提交图谱泳道计算的单测。
 *
 * 覆盖线性历史、单分叉、合并提交、多分支并行、以及分页截断（父提交不在这一页）这几种
 * 形状；断言只落在「列号、颜色、连线端点」这些可验证的量上，不去比 SVG。
 */
import { describe, expect, it } from "vitest";
import { type GitGraphCommit, layoutGitGraph } from "./git-graph-layout.ts";

/** 造一条提交：`sha` 与父提交哈希一目了然。 */
function commit(sha: string, ...parents: string[]): GitGraphCommit {
	return { sha, parents };
}

describe("layoutGitGraph", () => {
	it("线性历史：一根竖线，一条泳道", () => {
		const layout = layoutGitGraph([commit("c", "b"), commit("b", "a"), commit("a")]);
		expect(layout.maxLanes).toBe(1);
		expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
		expect(layout.rows.map((row) => row.color)).toEqual([0, 0, 0]);
		expect(layout.rows.map((row) => row.hasIncoming)).toEqual([false, true, true]);
		// 每条提交只画自己那一段：没有别的泳道要穿过去
		expect(layout.rows.every((row) => row.links.every((link) => link.kind === "out"))).toBe(true);
		expect(layout.rows[2]?.links).toEqual([]);
	});

	it("单分叉：支线新开一条泳道，再拐回主线汇合", () => {
		// main: m2 → m1；feature 从 m1 分出去：f1 的父也是 m1
		const layout = layoutGitGraph([commit("m2", "m1"), commit("f1", "m1"), commit("m1", "m0"), commit("m0")]);
		// m2 与 m1 在 0 列；f1 是新开的一条线，落在 1 列，并拐回 0 列的 m1
		expect(layout.rows.map((row) => row.lane)).toEqual([0, 1, 0, 0]);
		expect(layout.maxLanes).toBe(2);
		expect(layout.rows[1]?.links).toEqual([
			// 主线从这一行直穿过去
			{ from: 0, to: 0, color: 0, kind: "through" },
			// f1 自己拐回主线
			{ from: 1, to: 0, color: 0, kind: "out" },
		]);
		// 汇合之后 1 列不再占位
		expect(layout.rows[2]?.lanesBefore).toBe(1);
		expect(layout.rows[2]?.lanesAfter).toBe(1);
	});

	it("两条线的头都在页内：先扫到的那条占 0 列，另一条占 1 列并穿过它", () => {
		const layout = layoutGitGraph([commit("f1", "m1"), commit("m2", "m1"), commit("m1", "m0"), commit("m0")]);
		expect(layout.rows.map((row) => row.lane)).toEqual([0, 1, 0, 0]);
		expect(layout.maxLanes).toBe(2);
		// m2 这一行：1 列的线（等 m1）直穿过去，同时 m2 自己拐向 0 列
		expect(layout.rows[1]?.links).toContainEqual({ from: 0, to: 0, color: 0, kind: "through" });
		expect(layout.rows[1]?.links).toContainEqual({ from: 1, to: 0, color: 0, kind: "out" });
	});

	it("合并提交：两个父提交各有一条 out 连线，第二个占新泳道", () => {
		const layout = layoutGitGraph([
			commit("merge", "main1", "side1"),
			commit("main1", "base"),
			commit("side1", "base"),
			commit("base"),
		]);
		const mergeRow = layout.rows[0];
		expect(mergeRow?.lane).toBe(0);
		const outs = mergeRow?.links.filter((link) => link.kind === "out") ?? [];
		expect(outs).toHaveLength(2);
		// 第一个父亲接管本泳道，第二个拐到新的一列
		expect(outs[0]).toEqual({ from: 0, to: 0, color: 0, kind: "out" });
		expect(outs[1]?.from).toBe(0);
		expect(outs[1]?.to).toBe(1);
		expect(layout.maxLanes).toBe(2);
		// 两个分支汇到 base 时不会重复占列
		expect(layout.rows.every((row) => row.lane < 2)).toBe(true);
	});

	it("多分支并行：三条泳道同时在跑", () => {
		const layout = layoutGitGraph([
			commit("a2", "a1"),
			commit("b2", "b1"),
			commit("c2", "c1"),
			commit("a1", "root"),
			commit("b1", "root"),
			commit("c1", "root"),
			commit("root"),
		]);
		expect(layout.maxLanes).toBe(3);
		expect(new Set(layout.rows.slice(0, 3).map((row) => row.lane)).size).toBe(3);
		// 三条线各自带着自己的颜色
		expect(new Set(layout.rows.slice(0, 3).map((row) => row.color)).size).toBe(3);
	});

	it("分页截断：父提交不在这一页时泳道继续等它，不报错也不乱列", () => {
		const layout = layoutGitGraph([commit("n2", "n1"), commit("n1", "older")]);
		expect(layout.rows.map((row) => row.lane)).toEqual([0, 0]);
		// 页尾那条线悬在底部：最后一行的下方仍有活跃泳道
		expect(layout.rows[1]?.lanesAfter).toBe(1);
		expect(layout.rows[1]?.links).toEqual([{ from: 0, to: 0, color: 0, kind: "out" }]);
	});

	it("空输入给空布局", () => {
		expect(layoutGitGraph([])).toEqual({ rows: [], maxLanes: 0 });
	});

	it("没有父提交的提交也能收尾，不留悬空泳道", () => {
		const layout = layoutGitGraph([commit("only")]);
		expect(layout.rows[0]?.lanesAfter).toBe(0);
		expect(layout.maxLanes).toBe(1);
	});

	it("泳道数有上限：再多分支也不会把图谱撑到看不见说明", () => {
		const commits = Array.from({ length: 40 }, (_, index) => commit(`c${index}`, `missing-${index}`));
		const layout = layoutGitGraph(commits);
		expect(layout.maxLanes).toBeLessThanOrEqual(16);
		expect(layout.rows.every((row) => row.lane <= 15)).toBe(true);
	});
});
