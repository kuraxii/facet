import { describe, expect, it } from "vitest";
import { THINKING_LEVELS, toggleThinkingLevel, topThinkingLevel } from "./provider-thinking-levels.ts";

describe("模型行的思考档位", () => {
	it("勾上一档按七档顺序插进去", () => {
		expect(toggleThinkingLevel(["high"], "low")).toEqual(["low", "high"]);
		expect(toggleThinkingLevel(["off", "max"], "medium")).toEqual(["off", "medium", "max"]);
	});

	it("再勾一次就去掉", () => {
		expect(toggleThinkingLevel(["off", "low", "high"], "low")).toEqual(["off", "high"]);
		expect(toggleThinkingLevel(["max"], "max")).toEqual([]);
	});

	it("格子里写最高一档,一档都没有时为空", () => {
		expect(topThinkingLevel([])).toBeUndefined();
		expect(topThinkingLevel(["off"])).toBe("off");
		expect(topThinkingLevel(["off", "medium", "xhigh"])).toBe("xhigh");
		expect(topThinkingLevel(THINKING_LEVELS)).toBe("max");
	});
});
