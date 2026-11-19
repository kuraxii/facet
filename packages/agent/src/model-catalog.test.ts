import { describe, expect, it } from "vitest";
import { modelCatalog, modelInfo, modelProvider } from "./model-catalog.ts";

/**
 * 数据是人工更新的快照，格式错了不会有人当场发现——这些用例盯住「换一份新数据之后仍然可用」：
 * 键与条目对得上、每个模型都有展示需要的字段、思考深度的形态在上游定义的范围内。
 */
describe("模型信息库", () => {
	it("provider 与模型的键和条目 id 一致", () => {
		const providers = Object.entries(modelCatalog);
		expect(providers.length).toBeGreaterThan(0);
		for (const [providerId, provider] of providers) {
			expect(provider.id).toBe(providerId);
			for (const [modelId, model] of Object.entries(provider.models)) {
				expect(model.id).toBe(modelId);
			}
		}
	});

	it("每个模型都能回答名字、上下文与模态", () => {
		let withContext = 0;
		let total = 0;
		for (const provider of Object.values(modelCatalog)) {
			for (const model of Object.values(provider.models)) {
				total += 1;
				expect(model.name.length).toBeGreaterThan(0);
				expect(model.modalities.input.length).toBeGreaterThan(0);
				expect(model.modalities.output.length).toBeGreaterThan(0);
				// 图像、语音、检测类模型没有上下文窗口，上游给的是 0，不要求它们大于 0
				expect(model.limit.context).toBeGreaterThanOrEqual(0);
				expect(model.limit.output).toBeGreaterThanOrEqual(0);
				if (model.limit.context > 0) withContext += 1;
			}
		}
		// 绝大多数条目是聊天模型；剩下的零上下文条目只该是少数
		expect(withContext / total).toBeGreaterThan(0.9);
	});

	it("思考深度只有上游定义的三种形态", () => {
		const kinds = new Set<string>();
		for (const provider of Object.values(modelCatalog)) {
			for (const model of Object.values(provider.models)) {
				for (const option of model.reasoning_options ?? []) {
					kinds.add(option.type);
					if (option.type === "effort") {
						expect(option.values?.length).toBeGreaterThan(0);
					}
					if (option.type === "budget_tokens") {
						// 上游用 -1 表示不给下限，也可能两个边界都不写，只要求写了的必须是数字
						if (option.min !== undefined) expect(typeof option.min).toBe("number");
						if (option.max !== undefined) expect(typeof option.max).toBe("number");
					}
				}
			}
		}
		expect([...kinds].sort()).toEqual(["budget_tokens", "effort", "toggle"]);
	});

	it("按 provider 与模型 id 取值，取不到时给 undefined", () => {
		// moonshotai-cn 这类直接给端点的 provider 才有 api；anthropic 走 SDK 内置默认值
		const provider = modelProvider("moonshotai-cn");
		expect(provider?.api).toMatch(/^https:\/\//);
		const model = modelInfo("moonshotai-cn", Object.keys(provider?.models ?? {})[0] ?? "");
		expect(model?.id).toBeTruthy();
		expect(modelInfo("moonshotai-cn", "不存在的模型")).toBeUndefined();
		expect(modelProvider("不存在的 provider")).toBeUndefined();
	});
});
