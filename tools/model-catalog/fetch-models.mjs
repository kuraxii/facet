#!/usr/bin/env node
/**
 * 把 models.dev 的模型目录抓下来，存成 facet 自己的模型信息库。
 *
 * 数据源固定为 `https://models.dev/api.json`：以 provider 为键，每个 provider 带端点、环境
 * 变量、文档链接与模型清单；每个模型带能力位、模态、上下文与输出上限、思考深度选项与价格。
 * 比 `models.json` 多出 `reasoning_options`（effort / budget_tokens / toggle）与 `cost`，
 * 这两样是选模型时真正要看的。
 *
 * 上游有 324 个 provider，其中大量是网关与转售——同一个模型换个 provider 再列一遍，9996 条
 * 里大多数是重复。这里只留 pi SDK 内置的 provider（从运行时的 `ModelRuntime` 取，不写死列表，
 * 跟着 pi 升级自动变），provider 下的模型全部保留：模型条目本身不改，只统一成两格缩进，让
 * 上游的变化在 diff 里看得见。
 *
 * 更新是人工的：上游改动不会自动进来，谁要新模型就手动跑一次、看一眼 diff 再提交。流水线不
 * 跑这个脚本——目录数据的时效性由维护者决定，不由构建时间决定。
 *
 * 用法：
 *   node tools/model-catalog/fetch-models.mjs           # 抓取并覆盖 models.json
 *   node tools/model-catalog/fetch-models.mjs --check   # 只比较，有差异时以退出码 1 结束
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** 数据源。换地址等于换语义，改动前先确认新地址里每个 provider 与模型的结构仍然可用。 */
const SOURCE_URL = "https://models.dev/api.json";

/**
 * 落盘位置：数据归 `packages/agent` 所有——模型知识的消费方是这一层，脚本只是抓取工具，
 * 留在这里。文件被 `packages/agent` 里的模块 import，打包时由 esbuild 内联进 server 产物，
 * 不需要运行时再找路径。
 */
const OUT_FILE = join(import.meta.dirname, "..", "..", "packages", "agent", "data", "models.json");

/**
 * 上游任何一次改版都不该悄悄进来，这里给最低限度的形状检查。三个条数下限分工不同：
 * 原始数据的 provider 数挡住「拿到错误页或半截数据」，过滤后的 provider 与模型数挡住
 * 「pi 的名单取不到、或过滤规则失效」导致库被抽空。
 */
const MIN_PROVIDERS = 100;
const MIN_KEPT_PROVIDERS = 20;
const MIN_MODELS = 500;

/** 抓取超时，避免脚本卡死在没有响应的地址上。 */
const TIMEOUT_MS = 60_000;

/**
 * 取 pi SDK 内置的 provider id。
 *
 * 不写死列表：`ModelRuntime` 建出来就是内置目录加 `models.json`，这里禁掉网络刷新、
 * 不读任何 `models.json`（`modelsPath: null`），拿到的就是内置那一份。pi 升级后名单自然跟上。
 */
async function piProviderIds() {
	const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
	return new Set(runtime.getProviders().map((provider) => provider.id));
}

/** 只留 pi 内置的 provider；它们名下的模型全部保留，不再按 canonical 归属做二次过滤。 */
function keepPiProviders(catalog, providerIds) {
	const kept = {};
	for (const [providerId, provider] of Object.entries(catalog)) {
		if (providerIds.has(providerId)) {
			kept[providerId] = provider;
		}
	}
	return kept;
}

/** 把响应体解析成 provider 表，并校验它确实像模型目录。 */
function parseCatalog(text) {
	let data;
	try {
		data = JSON.parse(text);
	} catch (error) {
		throw new Error(`响应不是合法 JSON：${error instanceof Error ? error.message : error}`);
	}
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		throw new Error("响应顶层不是对象");
	}
	const providers = Object.keys(data);
	if (providers.length < MIN_PROVIDERS) {
		throw new Error(`只有 ${providers.length} 个 provider，少于 ${MIN_PROVIDERS} 个，拒绝写入`);
	}
	for (const providerId of providers) {
		const provider = data[providerId];
		if (provider === null || typeof provider !== "object") {
			throw new Error(`${providerId} 不是对象`);
		}
		if (typeof provider.id !== "string" || typeof provider.name !== "string") {
			throw new Error(`${providerId} 缺 id 或 name`);
		}
		if (provider.models === null || typeof provider.models !== "object") {
			throw new Error(`${providerId} 缺 models`);
		}
		for (const [modelId, model] of Object.entries(provider.models)) {
			if (model === null || typeof model !== "object") {
				throw new Error(`${providerId}/${modelId} 不是对象`);
			}
			if (typeof model.id !== "string" || typeof model.name !== "string") {
				throw new Error(`${providerId}/${modelId} 缺 id 或 name`);
			}
			if (model.id !== modelId) {
				throw new Error(`${providerId}/${modelId} 的 id 与键不一致（${model.id}）`);
			}
		}
	}
	return data;
}

/** 下载数据源、校验形状，返回只留 pi 内置 provider 的目录。 */
async function fetchCatalog() {
	const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!response.ok) {
		throw new Error(`${SOURCE_URL} 返回 ${response.status} ${response.statusText}`);
	}
	const raw = parseCatalog(await response.text());
	const providerIds = await piProviderIds();
	const catalog = keepPiProviders(raw, providerIds);
	const providers = Object.keys(catalog).length;
	const models = Object.values(catalog).reduce(
		(sum, provider) => sum + Object.keys(provider.models).length,
		0,
	);
	if (providers < MIN_KEPT_PROVIDERS) {
		throw new Error(`过滤后只剩 ${providers} 个 provider，少于 ${MIN_KEPT_PROVIDERS} 个，拒绝写入`);
	}
	if (models < MIN_MODELS) {
		throw new Error(`过滤后只剩 ${models} 个模型，少于 ${MIN_MODELS} 个，拒绝写入`);
	}
	// 上游没有的 provider 不是错误：pi 认识的 service 不一定被 models.dev 收录，列出来只为知情
	const missing = [...providerIds].filter((id) => !(id in catalog)).sort();
	return { rawProviders: Object.keys(raw).length, catalog, models, missing };
}

/**
 * 序列化：provider 的元数据逐行缩进，每个模型压成一行紧凑 JSON。
 *
 * 上游字段又多又深（`modalities.input` 三个模态就能撑出五行），全量缩进会有近七万行，上游每次
 * 更新都变成一整片 diff。一个模型一行之后，改哪个模型就只有那一行变色，信息一点不丢。
 */
function serialize(catalog) {
	const lines = ["{"];
	const providerIds = Object.keys(catalog);
	providerIds.forEach((providerId, index) => {
		const provider = catalog[providerId];
		lines.push(`  ${JSON.stringify(providerId)}: {`);
		for (const [key, value] of Object.entries(provider)) {
			if (key === "models") continue;
			lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
		}
		lines.push('    "models": {');
		const modelIds = Object.keys(provider.models);
		modelIds.forEach((modelId, modelIndex) => {
			const body = JSON.stringify(provider.models[modelId]);
			const comma = modelIndex === modelIds.length - 1 ? "" : ",";
			lines.push(`      ${JSON.stringify(modelId)}: ${body}${comma}`);
		});
		lines.push("    }");
		lines.push(`  }${index === providerIds.length - 1 ? "" : ","}`);
	});
	lines.push("}");
	return `${lines.join("\n")}\n`;
}

/** 统计 provider 数与模型数，打印时用得上。 */
function summarize(catalog) {
	const models = Object.values(catalog).reduce(
		(sum, provider) => sum + Object.keys(provider.models).length,
		0,
	);
	return { providers: Object.keys(catalog).length, models };
}

/**
 * 比较新旧两份目录。
 *
 * 分两层看：provider 本身增删，和同一 provider 下模型的增删改。模型整体是一张新表，所以
 * 差异只用来判断「这次更新值不值得提交」，不追求逐字段说明。
 */
function diff(oldCatalog, newCatalog) {
	const result = {
		providersAdded: [],
		providersRemoved: [],
		modelsAdded: [],
		modelsRemoved: [],
		modelsChanged: [],
	};
	for (const [providerId, provider] of Object.entries(newCatalog)) {
		const previous = oldCatalog[providerId];
		if (!previous) {
			result.providersAdded.push(providerId);
			continue;
		}
		for (const [modelId, model] of Object.entries(provider.models)) {
			const key = `${providerId}/${modelId}`;
			const before = previous.models?.[modelId];
			if (!before) {
				result.modelsAdded.push(key);
			} else if (JSON.stringify(before) !== JSON.stringify(model)) {
				result.modelsChanged.push(key);
			}
		}
		for (const modelId of Object.keys(previous.models ?? {})) {
			if (!provider.models[modelId]) {
				result.modelsRemoved.push(`${providerId}/${modelId}`);
			}
		}
	}
	for (const providerId of Object.keys(oldCatalog)) {
		if (!newCatalog[providerId]) {
			result.providersRemoved.push(providerId);
		}
	}
	return result;
}

/** 打印差异摘要：条数 + 前几条名字，够判断要不要更新。 */
function printDiff(result) {
	const groups = [
		["provider 新增", result.providersAdded],
		["provider 删除", result.providersRemoved],
		["模型新增", result.modelsAdded],
		["模型删除", result.modelsRemoved],
		["模型改动", result.modelsChanged],
	];
	const total = groups.reduce((sum, [, list]) => sum + list.length, 0);
	if (total === 0) {
		console.log("与本地 models.json 一致");
		return;
	}
	for (const [label, list] of groups) {
		if (list.length === 0) continue;
		console.log(`${label} ${list.length} 条：${list.slice(0, 5).join("、")}${list.length > 5 ? " …" : ""}`);
	}
}

/** 读本地已有的目录；文件不存在时返回空对象。 */
function readExisting() {
	try {
		return JSON.parse(readFileSync(OUT_FILE, "utf8"));
	} catch {
		return {};
	}
}

const checkOnly = process.argv.includes("--check");
const { rawProviders, catalog, models, missing } = await fetchCatalog();
const { providers } = summarize(catalog);

if (checkOnly) {
	const result = diff(readExisting(), catalog);
	printDiff(result);
	const changed =
		result.providersAdded.length +
		result.providersRemoved.length +
		result.modelsAdded.length +
		result.modelsRemoved.length +
		result.modelsChanged.length;
	process.exit(changed === 0 ? 0 : 1);
}

const text = serialize(catalog);
// 手写的序列化器不能只靠眼看：写盘前读回来比一遍条目数，形状不对就不落盘
const recheck = JSON.parse(text);
const recheckModels = Object.values(recheck).reduce(
	(sum, provider) => sum + Object.keys(provider.models).length,
	0,
);
if (Object.keys(recheck).length !== providers || recheckModels !== models) {
	throw new Error(
		`序列化后条目数对不上：${Object.keys(recheck).length}/${providers}、${recheckModels}/${models}`,
	);
}
mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, text);
console.log(
	`写入 ${OUT_FILE}：上游 ${rawProviders} 个 provider 中留下 ${providers} 个、${models} 个模型，${(text.length / 1024).toFixed(0)} KiB`,
);
if (missing.length > 0) {
	console.log(`pi 认识但上游没有的 provider：${missing.join("、")}`);
}
