import { describe, expect, it } from "vitest";
import {
	buildCatalogIndex,
	type CatalogModel,
	catalogLookupKeys,
	enrichUpstreamModels,
	fetchUpstreamModels,
	looksLikeModelList,
	modelListCandidates,
	parseUpstreamModels,
} from "./upstream-models.ts";

/** 造一个只回固定内容的 fetch，并记下请求。 */
function fakeFetch(handler: (url: string) => unknown) {
	const seen: { url: string; headers: Record<string, string> }[] = [];
	const impl = (async (url: string, init: { headers?: Record<string, string> }) => {
		const headers = init.headers ?? {};
		seen.push({ url: String(url), headers });
		const payload = handler(String(url));
		if (payload instanceof Error) {
			throw payload;
		}
		if (payload === "html") {
			return { ok: true, status: 200, json: async () => JSON.parse("<!doctype html>") };
		}
		if (typeof payload === "object" && payload !== null && "status" in payload) {
			const { status } = payload as { status: number };
			return { ok: false, status, json: async () => ({}) };
		}
		return { ok: true, status: 200, json: async () => payload };
	}) as unknown as typeof fetch;
	return { impl, seen };
}

/**
 * 造一份小目录。
 *
 * 形状照 pi 运行时目录里的 chat 模型，只留预填用得到的字段：同一个标识可以挂在多个 provider
 * 下，用来验证「多来源时挑哪一条」。
 */
function catalog(
	entries: { provider: string; models: Record<string, Partial<CatalogModel>> }[],
): CatalogModel[] {
	return entries.flatMap(({ provider, models }) =>
		Object.entries(models).map(([id, model]) => ({
			id,
			provider,
			name: model.name ?? id,
			contextWindow: model.contextWindow ?? 0,
			maxTokens: model.maxTokens ?? 0,
			reasoning: model.reasoning ?? false,
			...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: model.thinkingLevelMap }),
			input: model.input ?? ["text"],
		})),
	);
}

describe("列表地址", () => {
	it("裸站点根试两个候选,带版本段的只补 /models", () => {
		expect(modelListCandidates("https://relay.example.com")).toEqual([
			"https://relay.example.com/models",
			"https://relay.example.com/v1/models",
		]);
		expect(modelListCandidates("https://relay.example.com/v1///")).toEqual([
			"https://relay.example.com/v1/models",
		]);
		expect(modelListCandidates("https://api.anthropic.com/v1beta")).toEqual([
			"https://api.anthropic.com/v1beta/models",
		]);
	});

	it("带路径但没有版本段的按用户写的来,不乱拼", () => {
		expect(modelListCandidates("https://x.azure.com/openai/deployments/gpt4")).toEqual([
			"https://x.azure.com/openai/deployments/gpt4/models",
		]);
	});
});

describe("解析上游响应", () => {
	it("认 data / models / 裸数组三种形状", () => {
		expect(parseUpstreamModels({ data: [{ id: "a", display_name: "A" }] })).toEqual([{ id: "a", name: "A" }]);
		expect(parseUpstreamModels({ models: [{ id: "b" }] })).toEqual([{ id: "b" }]);
		expect(parseUpstreamModels(["c", { name: "d" }])).toEqual([{ id: "c" }, { id: "d" }]);
	});

	it("去重、丢掉读不懂的条目", () => {
		expect(parseUpstreamModels({ data: [{ id: "a" }, { id: "a" }, { nope: 1 }, 42, { id: "  " }] })).toEqual([
			{ id: "a" },
		]);
	});

	it("只有清单形状才算数,HTML 解析出来的字符串不算", () => {
		expect(looksLikeModelList({ data: [] })).toBe(true);
		expect(looksLikeModelList([])).toBe(true);
		expect(looksLikeModelList("<!doctype html>")).toBe(false);
		expect(looksLikeModelList({ error: "nope" })).toBe(false);
	});
});

describe("目录补能力", () => {
	it("退化键去掉厂商前缀与日期后缀", () => {
		expect(catalogLookupKeys("vendor/gpt-6-astra-261017")).toEqual([
			"vendor/gpt-6-astra-261017",
			"gpt-6-astra-261017",
			"vendor/gpt-6-astra",
			"gpt-6-astra",
		]);
	});

	it("补展示名、上下文、输出与思考;查不到的只回标识", () => {
		const index = buildCatalogIndex(
			catalog([
				{
					provider: "openai",
					models: {
						"gpt-6-astra": {
							name: "GPT-6 Astra",
							reasoning: true,
							contextWindow: 1050000,
							maxTokens: 128000,
						},
					},
				},
			]),
		);
		expect(enrichUpstreamModels([{ id: "gpt-6-astra" }, { id: "unknown-9" }], index)).toEqual([
			{
				id: "gpt-6-astra",
				name: "GPT-6 Astra",
				contextWindow: 1050000,
				maxTokens: 128000,
				reasoning: true,
			},
			{ id: "unknown-9" },
		]);
	});

	it("目录写了思考档位就一起补上", () => {
		const index = buildCatalogIndex(
			catalog([
				{
					provider: "deepseek",
					models: {
						"deepseek-flash": {
							name: "DeepSeek V4.1 Flash",
							reasoning: true,
							thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
							contextWindow: 1048576,
							maxTokens: 393216,
						},
						"deepseek-plain": { name: "DeepSeek Plain", contextWindow: 128000, maxTokens: 8192 },
					},
				},
			]),
		);
		expect(enrichUpstreamModels([{ id: "deepseek-flash" }, { id: "deepseek-plain" }], index)).toEqual([
			{
				id: "deepseek-flash",
				name: "DeepSeek V4.1 Flash",
				contextWindow: 1048576,
				maxTokens: 393216,
				reasoning: true,
				// 映射里没写 off，按 pi 的规则「不写就是可用」；minimal 与 medium 写了 null 才排除
				thinkingLevels: ["off", "low", "high", "max"],
			},
			{
				id: "deepseek-plain",
				name: "DeepSeek Plain",
				contextWindow: 128000,
				maxTokens: 8192,
				// 目录说它不会思考：给空数组，保存时才会写 reasoning: false
				thinkingLevels: [],
			},
		]);
	});

	it("会思考但目录没写映射时档位留空,不猜也不关掉思考", () => {
		const index = buildCatalogIndex(
			catalog([{ provider: "amazon-bedrock", models: { "claude-x": { reasoning: true } } }]),
		);
		expect(enrichUpstreamModels([{ id: "claude-x" }], index)).toEqual([
			{ id: "claude-x", name: "claude-x", reasoning: true },
		]);
	});

	it("目录说收图片时补上 input，只收文字的不写", () => {
		const index = buildCatalogIndex(
			catalog([
				{
					provider: "deepseek",
					models: {
						"deepseek-flash": { name: "DeepSeek V4.1 Flash", input: ["text", "image"] },
						"deepseek-v4-pro": { name: "DeepSeek V4 Pro", input: ["text"] },
					},
				},
			]),
		);
		expect(enrichUpstreamModels([{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }], index)).toEqual([
			{
				id: "deepseek-flash",
				name: "DeepSeek V4.1 Flash",
				input: ["text", "image"],
				thinkingLevels: [],
			},
			{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", thinkingLevels: [] },
		]);
	});

	it("上游给了展示名就以上游为准", () => {
		const index = buildCatalogIndex(
			catalog([{ provider: "openai", models: { "gpt-6-astra": { name: "GPT-6 Astra" } } }]),
		);
		expect(enrichUpstreamModels([{ id: "gpt-6-astra", name: "我的名字" }], index)[0]?.name).toBe("我的名字");
	});

	it("同一标识多来源时优先本次要拉的那个提供方", () => {
		const models = catalog([
			{ provider: "opencode", models: { "claude-x": { contextWindow: 1000000, maxTokens: 64000 } } },
			{ provider: "anthropic", models: { "claude-x": { contextWindow: 200000, maxTokens: 64000 } } },
		]);
		const index = buildCatalogIndex(models, "anthropic");
		expect(enrichUpstreamModels([{ id: "claude-x" }], index)[0]?.contextWindow).toBe(200000);
	});

	it("没有同名提供方时挑档位写得最全的那条", () => {
		const models = catalog([
			{ provider: "amazon-bedrock", models: { "claude-x": { contextWindow: 200000, reasoning: true } } },
			{
				provider: "openrouter",
				models: {
					"claude-x": {
						contextWindow: 200000,
						reasoning: true,
						thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
					},
				},
			},
		]);
		const index = buildCatalogIndex(models);
		// 两家上下文一样，但 openrouter 那条写了档位，预填时更有用
		expect(enrichUpstreamModels([{ id: "claude-x" }], index)[0]?.thinkingLevels).toEqual([
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});

	it("同分时按 provider 名兜底,同样的输入永远挑到同一条", () => {
		const models = catalog([
			{ provider: "zeta", models: { "m-1": { contextWindow: 111 } } },
			{ provider: "alpha", models: { "m-1": { contextWindow: 222 } } },
		]);
		expect(enrichUpstreamModels([{ id: "m-1" }], buildCatalogIndex(models))[0]?.contextWindow).toBe(222);
		expect(
			enrichUpstreamModels([{ id: "m-1" }], buildCatalogIndex([...models].reverse()))[0]?.contextWindow,
		).toBe(222);
	});

	it("拉取时把目录传进去才会补字段", async () => {
		const { impl } = fakeFetch(() => ({ data: [{ id: "gpt-6-astra" }] }));
		const result = await fetchUpstreamModels({
			baseUrl: "https://relay.example.com/v1",
			fetchImpl: impl,
			catalog: catalog([{ provider: "openai", models: { "gpt-6-astra": { contextWindow: 400000 } } }]),
		});
		expect(result.models[0]?.contextWindow).toBe(400000);
	});
});

describe("拉取", () => {
	it("按协议分叉认证头", async () => {
		const { impl, seen } = fakeFetch(() => ({ data: [{ id: "m" }] }));
		await fetchUpstreamModels({
			baseUrl: "https://a.example.com/v1",
			apiKey: " sk-1 ",
			fetchImpl: impl,
			api: "openai-completions",
		});
		expect(seen[0]?.url).toBe("https://a.example.com/v1/models");
		expect(seen[0]?.headers.authorization).toBe("Bearer sk-1");

		await fetchUpstreamModels({
			baseUrl: "https://api.anthropic.com/v1",
			apiKey: "sk-ant",
			api: "anthropic-messages",
			fetchImpl: impl,
		});
		expect(seen[1]?.headers["x-api-key"]).toBe("sk-ant");
		expect(seen[1]?.headers["anthropic-version"]).toBe("2023-06-01");
		expect(seen[1]?.headers.authorization).toBeUndefined();
	});

	it("没有密钥时不带认证头", async () => {
		const { impl, seen } = fakeFetch(() => ({ data: [] }));
		await fetchUpstreamModels({ baseUrl: "http://127.0.0.1:11434/v1", fetchImpl: impl });
		expect(seen[0]?.headers.authorization).toBeUndefined();
	});

	it("裸站点根回 HTML 首页时改试 /v1,并把可用地址回填", async () => {
		const { impl, seen } = fakeFetch((url) =>
			url.endsWith("/v1/models") ? { data: [{ id: "gpt-x" }] } : "html",
		);
		const result = await fetchUpstreamModels({
			baseUrl: "https://relay.example.com",
			apiKey: "k",
			fetchImpl: impl,
		});
		expect(seen.map((entry) => entry.url).sort()).toEqual([
			"https://relay.example.com/models",
			"https://relay.example.com/v1/models",
		]);
		expect(result.baseUrl).toBe("https://relay.example.com/v1");
		expect(result.models[0]?.id).toBe("gpt-x");
	});

	it("两个候选都失败时,错误说清 /v1 的可能", async () => {
		const { impl } = fakeFetch(() => "html");
		await expect(
			fetchUpstreamModels({ baseUrl: "https://relay.example.com", apiKey: "k", fetchImpl: impl }),
		).rejects.toThrow(/\/v1/);
	});

	it("HTTP 失败时带上状态码", async () => {
		const { impl } = fakeFetch(() => ({ status: 401 }));
		await expect(
			fetchUpstreamModels({ baseUrl: "https://relay.example.com/v1", fetchImpl: impl }),
		).rejects.toThrow("HTTP 401");
	});
});
