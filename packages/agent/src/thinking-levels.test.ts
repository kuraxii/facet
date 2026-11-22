import { describe, expect, it } from "vitest";
import {
	hasThinking,
	levelsFromCatalog,
	levelsFromMap,
	levelsToMap,
	normalizeLevels,
} from "./thinking-levels.ts";

describe("档位集合与 models.json 的映射", () => {
	it("可用的低档不写、不可用的一律写 null，xhigh 与 max 必须显式写值", () => {
		expect(levelsToMap(["off", "low", "high"])).toEqual({
			minimal: null,
			medium: null,
			xhigh: null,
			max: null,
		});
		expect(levelsToMap(["off", "low", "high", "max"])).toEqual({
			minimal: null,
			medium: null,
			xhigh: null,
			max: "max",
		});
		expect(levelsToMap(["minimal", "low", "medium", "high", "xhigh", "max"])).toEqual({
			off: null,
			xhigh: "xhigh",
			max: "max",
		});
	});

	it("七档全开时只写 xhigh 与 max，与 pi 自己目录里的形状一致", () => {
		expect(levelsToMap(["off", "minimal", "low", "medium", "high", "xhigh", "max"])).toEqual({
			xhigh: "xhigh",
			max: "max",
		});
	});

	it("不会思考时不写映射，交给 reasoning: false", () => {
		expect(hasThinking(["off"])).toBe(false);
		expect(hasThinking([])).toBe(false);
		expect(levelsToMap(["off"])).toBeUndefined();
		expect(levelsToMap([])).toBeUndefined();
	});

	it("读回来与写出去是一回事", () => {
		// 只有 off 的那一组读出空集：两者都写成 reasoning: false，pi 给出的档位也只有 off
		for (const levels of [
			["off", "low", "high"],
			["minimal", "low", "medium", "high", "xhigh"],
			["off", "minimal", "low", "medium", "high", "xhigh", "max"],
		] as const) {
			const map = levelsToMap(levels);
			expect(levelsFromMap(map, hasThinking(levels))).toEqual(normalizeLevels(levels));
		}
	});

	it("没写映射时按 pi 的缺省判：off 到 high 可用，xhigh 与 max 不可用", () => {
		expect(levelsFromMap(undefined, true)).toEqual(["off", "minimal", "low", "medium", "high"]);
		expect(levelsFromMap({}, true)).toEqual(["off", "minimal", "low", "medium", "high"]);
	});

	it("关不掉思考的模型读回来没有 off", () => {
		expect(levelsFromMap({ off: null }, true)).toEqual(["minimal", "low", "medium", "high"]);
	});

	it("reasoning 为假时没有档位可选", () => {
		expect(levelsFromMap({ xhigh: "xhigh", max: "max" }, false)).toEqual([]);
		expect(levelsFromMap(undefined, undefined)).toEqual([]);
	});

	it("顺序与去重都按七档规范来", () => {
		expect(normalizeLevels(["max", "off", "max", "high"])).toEqual(["off", "high", "max"]);
	});
});

describe("模型信息库的思考选项", () => {
	it("effort 给了清单就照抄，none 当作 off", () => {
		expect(levelsFromCatalog([{ type: "effort", values: ["none", "low", "high"] }])).toEqual([
			"off",
			"low",
			"high",
		]);
		expect(
			levelsFromCatalog([{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }]),
		).toEqual(["low", "medium", "high", "xhigh", "max"]);
	});

	it("带 toggle 时补上 off", () => {
		expect(
			levelsFromCatalog([{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }]),
		).toEqual(["off", "low", "high", "max"]);
	});

	it("只有 toggle 时给 off 与 high", () => {
		expect(levelsFromCatalog([{ type: "toggle" }])).toEqual(["off", "high"]);
	});

	it("只写了 token 预算时不造档位", () => {
		expect(levelsFromCatalog([{ type: "budget_tokens", max: 32000 }])).toBeUndefined();
		expect(levelsFromCatalog([])).toBeUndefined();
		expect(levelsFromCatalog(undefined)).toBeUndefined();
	});

	it("库里写了不认识的取值就丢掉", () => {
		expect(levelsFromCatalog([{ type: "effort", values: ["low", "ultra"] }])).toEqual(["low"]);
	});
});
