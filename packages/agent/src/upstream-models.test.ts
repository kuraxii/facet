import { describe, expect, it } from "vitest";
import type { ModelInfo, ModelInfoProvider, ModelInfoReasoningOption } from "./model-catalog.ts";
import {
	buildCatalogIndex,
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

/** 造一份小目录：同一个标识挂在两个 provider 下，厂商官方那条才算正主。 */
function catalog(
	entries: {
		provider: string;
		models: Record<
			string,
			Partial<ModelInfo> & { canonical?: string; reasoningOptions?: ModelInfoReasoningOption[] }
		>;
	}[],
): Record<string, ModelInfoProvider> {
	const providers: Record<string, ModelInfoProvider> = {};
	for (const { provider, models } of entries) {
		providers[provider] = {
			id: provider,
			name: provider,
			env: [],
			models: Object.fromEntries(
				Object.entries(models).map(([id, model]) => [
					id,
					{
						id,
						name: model.name ?? id,
						reasoning: model.reasoning ?? false,
						tool_call: true,
						attachment: false,
						modalities: { input: ["text"], output: ["text"] },
						limit: { context: model.limit?.context ?? 0, output: model.limit?.output ?? 0 },
						...(model.canonical === undefined ? {} : { canonical_model_id: model.canonical }),
						...(model.reasoningOptions === undefined ? {} : { reasoning_options: model.reasoningOptions }),
					} satisfies ModelInfo,
				]),
			),
		};
	}
	return providers;
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
							limit: { context: 1050000, output: 128000 },
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

	it("信息库写了思考档位就一起补上", () => {
		const index = buildCatalogIndex(
			catalog([
				{
					provider: "deepseek",
					models: {
						"deepseek-flash": {
							name: "DeepSeek V4.1 Flash",
							reasoning: true,
							reasoningOptions: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
							limit: { context: 1048576, output: 393216 },
						},
						"deepseek-plain": { name: "DeepSeek Plain", limit: { context: 128000, output: 8192 } },
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
				thinkingLevels: ["off", "low", "high", "max"],
			},
			{ id: "deepseek-plain", name: "DeepSeek Plain", contextWindow: 128000, maxTokens: 8192 },
		]);
	});

	it("上游给了展示名就以上游为准", () => {
		const index = buildCatalogIndex(
			catalog([{ provider: "openai", models: { "gpt-6-astra": { name: "GPT-6 Astra" } } }]),
		);
		expect(enrichUpstreamModels([{ id: "gpt-6-astra", name: "我的名字" }], index)[0]?.name).toBe("我的名字");
	});

	it("同一标识多来源时优先厂商官方条目", () => {
		const index = buildCatalogIndex(
			catalog([
				{
					provider: "opencode",
					models: {
						"claude-x": { canonical: "anthropic/claude-x", limit: { context: 1000000, output: 64000 } },
					},
				},
				{
					provider: "anthropic",
					models: {
						"claude-x": { canonical: "anthropic/claude-x", limit: { context: 200000, output: 64000 } },
					},
				},
			]),
		);
		expect(enrichUpstreamModels([{ id: "claude-x" }], index)[0]?.contextWindow).toBe(200000);
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
