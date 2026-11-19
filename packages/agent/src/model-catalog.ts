/**
 * facet 的模型信息库。
 *
 * 数据是 `models.dev/api.json` 里 pi 内置 provider 的快照，由
 * `tools/model-catalog/fetch-models.mjs` 人工更新（`npm run catalog:update`）。这里只给数据套上
 * 类型、提供按键取模型的入口，不参与请求：真正发请求用的模型目录仍是 pi SDK 的
 * `ModelRuntime`（内置目录 + `models.json`），这份数据只用来展示与预填。
 *
 * 导入会被 esbuild 内联进 server 产物，打包后不依赖任何运行时路径。
 */
import catalog from "../data/models.json";

/** 思考深度的形态：`effort` 给档位，`budget_tokens` 给 token 预算，`toggle` 只有开关。 */
export interface ModelInfoReasoningOption {
	/** 形态判别字段 */
	type: "effort" | "budget_tokens" | "toggle";
	/** `effort` 可开的档位，如 `["low", "medium", "high"]` */
	values?: string[];
	/**
	 * `budget_tokens` 的下限与上限，单位 token。上游用 `-1` 表示不给下限，缺省表示没写；
	 * 上限也可能单独出现。
	 */
	min?: number;
	max?: number;
}

/** 一个模型在上游记录里的样子；只列 facet 目前会用到的字段，其余字段仍在数据里。 */
export interface ModelInfo {
	/** 模型 id，与所在 provider 的模型表键一致 */
	id: string;
	/** 展示名 */
	name: string;
	/**
	 * 模型类别。缺省是聊天模型；`image`、`embedding`、`speech` 这类非聊天模型没有上下文窗口，
	 * 上游给的 `limit.context` 是 0。
	 */
	type?: "chat" | "image" | "embedding" | "reranking" | "video" | "speech" | "transcription" | "realtime";
	/** 是否思考模型 */
	reasoning: boolean;
	/** 思考深度选项；空数组表示这个模型没有档位可调 */
	reasoning_options?: ModelInfoReasoningOption[];
	/** 是否支持工具调用 */
	tool_call: boolean;
	/** 是否支持结构化输出 */
	structured_output?: boolean;
	/** 是否支持附件输入 */
	attachment: boolean;
	/** 输入与输出模态，如 `text`、`image`、`audio`、`video`、`pdf` */
	modalities: { input: string[]; output: string[] };
	/** 上下文窗口与单次输出上限，单位 token */
	limit: { context: number; input?: number; output: number };
	/** 每百万 token 单价，可能带分档 */
	cost?: Record<string, unknown>;
	/** 说明文字 */
	description?: string;
	/** 官方条目的规范名，形如 `provider/model` */
	canonical_model_id?: string;
	/** 发布日期与最近更新日期，形如 `2026-04-20` */
	release_date?: string;
	last_updated?: string;
}

/** 一个 provider 在上游记录里的样子。 */
export interface ModelInfoProvider {
	/** provider id，与 pi 的 provider id 一致 */
	id: string;
	/** 展示名 */
	name: string;
	/** 存 key 的环境变量名 */
	env: string[];
	/** API 端点，可直接当 pi `models.json` 里的 `baseUrl`；部分 provider 上游没给 */
	api?: string;
	/** 官方文档地址 */
	doc?: string;
	/** 模型表，键是模型 id */
	models: Record<string, ModelInfo>;
}

/** 全部 provider，键是 provider id。 */
export const modelCatalog = catalog as Record<string, ModelInfoProvider>;

/** 按 id 取一个 provider。 */
export function modelProvider(providerId: string): ModelInfoProvider | undefined {
	return modelCatalog[providerId];
}

/** 按 provider 与模型 id 取一个模型。 */
export function modelInfo(providerId: string, modelId: string): ModelInfo | undefined {
	return modelCatalog[providerId]?.models[modelId];
}
