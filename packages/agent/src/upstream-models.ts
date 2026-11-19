/**
 * 从上游拉模型清单，并用 facet 的模型信息库补齐能力字段。
 *
 * 各家 `/models` 并不统一：地址可能要不要 `/v1`、认证头按协议分叉（OpenAI 兼容是
 * `Authorization: Bearer`，Anthropic 是 `x-api-key` + 版本头）。更重要的是 New API 这类中转站
 * 对未知路径回 **200 + 前端 HTML 首页**，只看状态码会被一张首页骗过去，所以响应还要判形状。
 *
 * 上游通常只给模型标识（个别带展示名），上下文窗口、最大输出、是否思考这些它不给；这些字段从
 * `packages/agent/data/models.json`（models.dev 快照）里补，补的是**预填**，用户可以改。
 * 请求由主机发出：渲染进程在沙箱里，跨域直接打上游会被拦。
 */
import type { UpstreamModel } from "@facet/protocol";
import { type ModelInfo, type ModelInfoProvider, modelCatalog } from "./model-catalog.ts";

/** 请求超时：上游不通时不让弹窗一直转。 */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** 条数上限：有的网关会把几百个模型一次吐回来。 */
const MAX_MODELS = 500;

/** 接口协议 → 认证头。缺省按 OpenAI 兼容处理。 */
const ANTHROPIC_API = "anthropic-messages";

/** 拉取参数。 */
export interface FetchUpstreamModelsOptions {
	/** 用户填的接口地址，允许带或不带 `/v1` */
	baseUrl: string;
	/** 密钥；为空时不带认证头 */
	apiKey?: string;
	/** 接口协议，决定认证头怎么放 */
	api?: string;
	/** 已经解析出来的额外认证头；值为 null 表示不发这个头 */
	headers?: Record<string, string | null>;
	/** 测试里换成本地实现 */
	fetchImpl?: typeof fetch;
	/** 测试里换掉超时 */
	timeoutMs?: number;
}

/** 拉取结果。 */
export interface FetchUpstreamModelsResult {
	/** 补过能力字段的模型清单 */
	models: UpstreamModel[];
	/** 实际可用的基址：裸站点根补上 `/v1` 之后与用户填的不同，界面据此回填 */
	baseUrl: string;
}

/** 去掉末尾斜杠。 */
function trimBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "");
}

/** 地址末尾已经是版本段（`/v1`、`/v1beta`、`/v2`…）。 */
function hasVersionSegment(pathname: string): boolean {
	return /\/v\d+[a-z0-9.]*$/i.test(pathname);
}

/**
 * 该试哪几个列表地址。
 *
 * - 已经是版本段收尾（`…/v1`、`…/v1beta/openai` 这种以路径收尾的按用户输入走）→ 只补 `/models`；
 * - 裸站点根 → 先试根（有的网关根上就给了清单），再试 `/v1`（多数网关的意图地址）；
 * - 带路径但没有版本段（azure 的 `/openai/deployments/…`）→ 只按用户写的来，不乱拼。
 */
export function modelListCandidates(baseUrl: string): string[] {
	const base = trimBaseUrl(baseUrl);
	let url: URL;
	try {
		url = new URL(base);
	} catch {
		return [`${base}/models`];
	}
	const path = url.pathname.replace(/\/+$/, "");
	if (hasVersionSegment(path)) {
		return [`${base}/models`];
	}
	const isRoot = path === "";
	return isRoot ? [`${base}/models`, `${base}/v1/models`] : [`${base}/models`];
}

/**
 * 响应是不是「模型清单」。
 *
 * 认三种形状：裸数组、`{ data: [...] }`（OpenAI / Anthropic）、`{ models: [...] }`（本地网关
 * 改写过一层）。New API 这类中转站对未知路径回 200 + 前端 HTML，解析出来不是清单，按失败处理。
 */
export function looksLikeModelList(payload: unknown): boolean {
	if (Array.isArray(payload)) {
		return true;
	}
	if (typeof payload !== "object" || payload === null) {
		return false;
	}
	const record = payload as Record<string, unknown>;
	return Array.isArray(record.data) || Array.isArray(record.models);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * 把清单收成条目：按标识去重并保持上游顺序。
 *
 * 条目标识可能叫 `id`，也可能叫 `name`（Ollama 风格）；展示名认 `display_name` / `displayName`。
 */
export function parseUpstreamModels(payload: unknown): UpstreamModel[] {
	const entries: unknown[] = Array.isArray(payload)
		? payload
		: looksLikeModelList(payload)
			? (((payload as Record<string, unknown>).data ??
					(payload as Record<string, unknown>).models) as unknown[])
			: [];
	const seen = new Set<string>();
	const models: UpstreamModel[] = [];
	for (const entry of entries) {
		const id =
			typeof entry === "string"
				? readString(entry)
				: typeof entry === "object" && entry !== null
					? (readString((entry as Record<string, unknown>).id) ??
						readString((entry as Record<string, unknown>).name))
					: undefined;
		if (id === undefined || seen.has(id)) {
			continue;
		}
		seen.add(id);
		const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
		const name = readString(record.display_name) ?? readString(record.displayName);
		models.push(name === undefined ? { id } : { id, name });
		if (models.length >= MAX_MODELS) {
			break;
		}
	}
	return models;
}

/** 目录索引：精确标识与退化别名分开存，精确的优先。 */
export interface CatalogIndex {
	/** 原标识 → 目录条目 */
	exact: Map<string, { provider: string; model: ModelInfo }>;
	/** 退化标识（去厂商前缀、去日期后缀）→ 目录条目 */
	alias: Map<string, { provider: string; model: ModelInfo }>;
}

/**
 * 目录条目的可信度排序。
 *
 * 同一个标识会挂在多个 provider 下（`azure`、`openrouter`、`github-copilot`…），能力与思考档位
 * 各家并不一致；`canonical_model_id` 形如 `anthropic/claude-…`，前缀对上 provider id 的那条就是
 * 厂商官方条目，优先用它，免得把转售方的语义当成模型本身的能力。
 */
function rank(providerId: string, model: ModelInfo): number {
	const canonical = readString(model.canonical_model_id)?.toLowerCase();
	return canonical?.startsWith(`${providerId.toLowerCase()}/`) === true ? 2 : 1;
}

/** 退化键：去厂商前缀（`vendor/model`）、去日期后缀（`-261017`）。 */
export function catalogLookupKeys(id: string): string[] {
	const key = id.trim().toLowerCase();
	if (key.length === 0) {
		return [];
	}
	const keys = new Set<string>([key]);
	const tail = key.split("/").pop();
	if (tail !== undefined && tail !== key) {
		keys.add(tail);
	}
	for (const candidate of [...keys]) {
		const undated = candidate.replace(/[-_.]?(19|20)\d{6}$/, "").replace(/[-_.]?\d{6}$/, "");
		if (undated.length > 0 && undated !== candidate) {
			keys.add(undated);
		}
	}
	return [...keys];
}

/** 建一次目录索引；默认用随包分发的 models.dev 快照。 */
export function buildCatalogIndex(providers: Record<string, ModelInfoProvider> = modelCatalog): CatalogIndex {
	const exact: CatalogIndex["exact"] = new Map();
	const alias: CatalogIndex["alias"] = new Map();
	const put = (
		target: Map<string, { provider: string; model: ModelInfo }>,
		key: string,
		providerId: string,
		model: ModelInfo,
	): void => {
		const existing = target.get(key);
		if (existing === undefined || rank(providerId, model) > rank(existing.provider, existing.model)) {
			target.set(key, { provider: providerId, model });
		}
	};
	for (const [providerId, provider] of Object.entries(providers)) {
		for (const [modelId, model] of Object.entries(provider.models)) {
			put(exact, modelId.trim().toLowerCase(), providerId, model);
		}
	}
	// 别名只补精确里没有的键，不能把后面的精确模型顶掉
	for (const [providerId, provider] of Object.entries(providers)) {
		for (const [modelId, model] of Object.entries(provider.models)) {
			for (const key of catalogLookupKeys(modelId)) {
				if (!exact.has(key)) {
					put(alias, key, providerId, model);
				}
			}
		}
	}
	return { exact, alias };
}

/** 用目录把能力字段补上：上游给了的以它为准，查不到就留空（空 = 让 pi 用 SDK 默认）。 */
export function enrichUpstreamModels(raw: readonly UpstreamModel[], index: CatalogIndex): UpstreamModel[] {
	return raw.map((model) => {
		let hit: { provider: string; model: ModelInfo } | undefined;
		for (const key of catalogLookupKeys(model.id)) {
			hit = index.exact.get(key) ?? index.alias.get(key);
			if (hit !== undefined) {
				break;
			}
		}
		if (hit === undefined) {
			return model;
		}
		const { model: meta } = hit;
		const contextWindow = meta.limit?.context;
		const maxTokens = meta.limit?.output;
		return {
			...model,
			...(model.name === undefined && meta.name !== undefined ? { name: meta.name } : {}),
			...(contextWindow !== undefined && contextWindow > 0 ? { contextWindow } : {}),
			...(maxTokens !== undefined && maxTokens > 0 ? { maxTokens } : {}),
			...(meta.reasoning ? { reasoning: true } : {}),
		};
	});
}

/** 按协议放认证头。 */
function authHeaders(api: string | undefined, apiKey: string): Record<string, string> {
	if (api === ANTHROPIC_API) {
		return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
	}
	return { authorization: `Bearer ${apiKey}` };
}

/** 打一个列表地址，拿到清单或抛错。 */
async function requestModels(
	endpoint: string,
	options: FetchUpstreamModelsOptions,
): Promise<UpstreamModel[]> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(options.headers ?? {})) {
		if (typeof value === "string") {
			headers[name] = value;
		}
	}
	Object.assign(headers, { accept: "application/json" });
	const key = options.apiKey?.trim();
	if (key !== undefined && key.length > 0) {
		Object.assign(headers, authHeaders(options.api, key));
	}

	const response = await fetchImpl(endpoint, {
		headers,
		signal: AbortSignal.timeout(options.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
	});
	if (!response.ok) {
		// 401/403 时把「这次请求带没带密钥」写出来，不然分不清是密钥错了还是压根没取到
		const hint =
			response.status === 401 || response.status === 403
				? key === undefined || key.length === 0
					? "（这次请求没有带密钥）"
					: "（这次请求带了密钥，可能已失效）"
				: "";
		throw new Error(`上游 /models 返回 HTTP ${response.status}${hint}`);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new Error("上游 /models 没有返回 JSON（地址可能少写 /v1，或这不是 API 端点）");
	}
	if (!looksLikeModelList(payload)) {
		throw new Error("上游 /models 返回的不是模型清单（地址可能少写 /v1，或这不是 API 端点）");
	}
	return parseUpstreamModels(payload);
}

/**
 * 拉一次模型清单。
 *
 * 多个候选地址并发试，按候选顺序取第一个成功的，并把那个地址回给界面（裸站点根补上 `/v1`
 * 之后与用户填的不同，回填给用户才看得见）。全部失败时抛最后一个候选的错误——那是多数网关的
 * 意图地址，说清 `/v1` 的可能，比只丢一个状态码有用。
 */
export async function fetchUpstreamModels(
	options: FetchUpstreamModelsOptions,
): Promise<FetchUpstreamModelsResult> {
	const baseUrl = trimBaseUrl(options.baseUrl);
	const candidates = modelListCandidates(baseUrl);
	const settled = await Promise.allSettled(candidates.map((candidate) => requestModels(candidate, options)));

	const index = buildCatalogIndex();
	for (const [position, result] of settled.entries()) {
		if (result.status === "fulfilled") {
			const endpoint = candidates[position] ?? `${baseUrl}/models`;
			return {
				models: enrichUpstreamModels(result.value, index),
				// 回给界面的是基址，不是列表端点
				baseUrl: endpoint.replace(/\/models$/, ""),
			};
		}
	}
	const failure = settled[settled.length - 1];
	throw failure !== undefined && failure.status === "rejected"
		? failure.reason
		: new Error("上游没有返回模型");
}
