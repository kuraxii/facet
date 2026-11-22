import { describe, expect, it } from "vitest";
import { modelRow, rewriteModelRow } from "./provider-model-row.ts";

describe("从上游拉回同一标识的模型", () => {
	const row = modelRow({
		id: "deepseek-flash",
		name: "我自己起的名字",
		contextWindow: 64000,
		maxTokens: 4096,
		thinkingLevels: ["off", "high"],
	});

	it("整行按拉回来的那份重写", () => {
		const next = rewriteModelRow(row, {
			id: "deepseek-flash",
			name: "DeepSeek V4.1 Flash 1017",
			contextWindow: 1048576,
			maxTokens: 393216,
			thinkingLevels: ["off", "low", "high", "max"],
		});
		expect(next.key).toBe(row.key);
		expect(next.model).toEqual({
			id: "deepseek-flash",
			name: "DeepSeek V4.1 Flash 1017",
			contextWindow: 1048576,
			maxTokens: 393216,
			thinkingLevels: ["off", "low", "high", "max"],
		});
	});

	it("信息库里查不到时窗口与档位跟着清空", () => {
		const next = rewriteModelRow(row, { id: "deepseek-flash" });
		expect(next.model).toEqual({ id: "deepseek-flash", name: "我自己起的名字" });
	});

	it("展示名没给过就保留原来的,空名字存不进 models.json", () => {
		const named = modelRow({ id: "deepseek-flash", name: "原名" });
		expect(rewriteModelRow(named, { id: "deepseek-flash" }).model.name).toBe("原名");
		expect(rewriteModelRow(modelRow({ id: "x" }), { id: "x" }).model.name).toBeUndefined();
	});
});
