/**
 * `↑`/`↓` 的历史回溯：翻到哪一条、到顶怎么停、退出时还原什么，全是纯变换。
 */
import { describe, expect, it } from "vitest";
import { normalizeHistory, resetHistoryNav, stepHistoryDown, stepHistoryUp } from "./history-nav.ts";

const HISTORY = ["第一条", "第二条", "第三条"];

describe("归一化已发消息", () => {
	it("去掉空白项与连续重复,不相邻的重复留着", () => {
		expect(normalizeHistory(["甲", "", "  ", "甲", "乙", "甲"])).toEqual(["甲", "乙", "甲"]);
	});

	it("两端空白不进历史", () => {
		expect(normalizeHistory(["  甲  "])).toEqual(["甲"]);
	});
});

describe("往回翻", () => {
	it("空历史什么都不翻", () => {
		const state = resetHistoryNav();
		expect(stepHistoryUp(state, [], "写了一半")).toEqual({ state, text: null });
	});

	it("第一次翻存下当前草稿并跳到最近一条", () => {
		const step = stepHistoryUp(resetHistoryNav(), HISTORY, "写了一半");
		expect(step.text).toBe("第三条");
		expect(step.state).toEqual({ index: 2, savedDraft: "写了一半" });
	});

	it("继续翻往回走,到最旧的一条就停住", () => {
		const first = stepHistoryUp(resetHistoryNav(), HISTORY, "").state;
		const second = stepHistoryUp(first, HISTORY, "").state;
		const third = stepHistoryUp(second, HISTORY, "");
		expect(third.state.index).toBe(0);
		expect(third.text).toBe("第一条");

		const clamped = stepHistoryUp(third.state, HISTORY, "");
		expect(clamped.text).toBeNull();
		expect(clamped.state).toBe(third.state);
	});
});

describe("往前翻", () => {
	it("不在浏览态时不动", () => {
		const state = resetHistoryNav();
		expect(stepHistoryDown(state, HISTORY)).toEqual({ state, text: null });
	});

	it("往前走一条", () => {
		const up = stepHistoryUp(stepHistoryUp(resetHistoryNav(), HISTORY, "草稿").state, HISTORY, "草稿");
		const down = stepHistoryDown(up.state, HISTORY);
		expect(down.text).toBe("第三条");
		expect(down.state.index).toBe(2);
	});

	it("越过最新的一条就退出浏览态,把原草稿还回去", () => {
		const up = stepHistoryUp(resetHistoryNav(), HISTORY, "写了一半");
		const down = stepHistoryDown(up.state, HISTORY);
		expect(down.text).toBe("写了一半");
		expect(down.state).toEqual(resetHistoryNav());
	});

	it("没有存过草稿时退出浏览态铺的是空串", () => {
		const up = stepHistoryUp(resetHistoryNav(), HISTORY, "");
		expect(stepHistoryDown(up.state, HISTORY).text).toBe("");
	});
});
