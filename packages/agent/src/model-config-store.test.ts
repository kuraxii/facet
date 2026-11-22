import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidBaseUrlError, ModelConfigStore, normalizeBaseUrl } from "./model-config-store.ts";

let root: string;
let file: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "facet-model-config-"));
	file = join(root, "models.json");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("接口地址", () => {
	it("去掉末尾斜杠,空串表示没有地址", () => {
		expect(normalizeBaseUrl("  https://api.example.com/v1/  ")).toBe("https://api.example.com/v1");
		expect(normalizeBaseUrl("   ")).toBeUndefined();
		expect(() => normalizeBaseUrl("ftp://x")).toThrow(InvalidBaseUrlError);
		expect(() => normalizeBaseUrl("不是地址")).toThrow(InvalidBaseUrlError);
	});

	it("内容读不懂时留档并当作空配置", async () => {
		await writeFile(file, "{ 坏掉的", "utf8");
		const store = new ModelConfigStore({ file });
		expect(await store.customProviders()).toEqual([]);
		const names = await readdir(root);
		expect(names.some((name) => name.startsWith("models.json.broken-"))).toBe(true);
	});
});

describe("自定义提供方", () => {
	const entry = {
		id: "my-gateway",
		name: "我的网关",
		baseUrl: "https://gateway.example.com/v1",
		api: "openai-completions",
		models: [{ id: "local-llama", contextWindow: 32000 }],
	};

	it("保存后读得到,只认带模型清单的条目", async () => {
		const store = new ModelConfigStore({ file });
		await store.saveProvider(entry);

		expect(await store.customProviders()).toEqual([entry]);
		expect(await store.isCustom("my-gateway")).toBe(true);
		expect(await store.isCustom("anthropic")).toBe(false);
	});

	it("思考档位写成 reasoning 与逐档映射,读回来是同一组", async () => {
		const store = new ModelConfigStore({ file });
		await store.saveProvider({
			...entry,
			models: [
				{
					id: "deepseek-flash",
					name: "DeepSeek V4.1 Flash 1017",
					thinkingLevels: ["off", "low", "high", "max"],
				},
			],
		});

		const written = JSON.parse(await readFile(file, "utf8")) as {
			providers: Record<string, { models: Record<string, unknown>[] }>;
		};
		expect(written.providers["my-gateway"]?.models[0]).toEqual({
			id: "deepseek-flash",
			name: "DeepSeek V4.1 Flash 1017",
			reasoning: true,
			thinkingLevelMap: { minimal: null, medium: null, xhigh: null, max: "max" },
		});
		expect((await store.customProviders())[0]?.models[0]?.thinkingLevels).toEqual([
			"off",
			"low",
			"high",
			"max",
		]);
	});

	it("只有 off 时写 reasoning: false,不写映射", async () => {
		const store = new ModelConfigStore({ file });
		await store.saveProvider({ ...entry, models: [{ id: "plain", thinkingLevels: ["off"] }] });

		const written = JSON.parse(await readFile(file, "utf8")) as {
			providers: Record<string, { models: Record<string, unknown>[] }>;
		};
		expect(written.providers["my-gateway"]?.models[0]).toEqual({ id: "plain", reasoning: false });
		expect((await store.customProviders())[0]?.models[0]?.thinkingLevels).toBeUndefined();
	});

	it("收图片写 input，只收文字不写", async () => {
		const store = new ModelConfigStore({ file });
		await store.saveProvider({
			...entry,
			models: [
				{ id: "vision", input: ["text", "image"] },
				{ id: "plain", input: ["text"] },
			],
		});
		const written = JSON.parse(await readFile(file, "utf8")) as {
			providers: Record<string, { models: Record<string, unknown>[] }>;
		};
		expect(written.providers["my-gateway"]?.models).toEqual([
			{ id: "vision", input: ["text", "image"] },
			{ id: "plain" },
		]);
		expect((await store.customProviders())[0]?.models[0]?.input).toEqual(["text", "image"]);
		expect((await store.customProviders())[0]?.models[1]?.input).toBeUndefined();
	});

	it("手写的映射读成同一组档位", async () => {
		await writeFile(
			file,
			JSON.stringify({
				providers: {
					"my-gateway": {
						models: [
							{ id: "a", reasoning: true, thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" } },
							{ id: "b", reasoning: true },
						],
					},
				},
			}),
			"utf8",
		);
		const store = new ModelConfigStore({ file });
		expect((await store.customProviders())[0]?.models).toEqual([
			{ id: "a", thinkingLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] },
			{ id: "b", thinkingLevels: ["off", "minimal", "low", "medium", "high"] },
		]);
	});

	it("修改时保留其他字段", async () => {
		await writeFile(
			file,
			JSON.stringify({ providers: { "my-gateway": { apiKey: "!echo sk", models: [{ id: "old" }] } } }),
			"utf8",
		);
		const store = new ModelConfigStore({ file });
		await store.saveProvider(entry);
		const written = JSON.parse(await readFile(file, "utf8")) as {
			providers: Record<string, { apiKey?: string; models?: { id: string }[] }>;
		};
		expect(written.providers["my-gateway"]?.apiKey).toBe("!echo sk");
		expect(written.providers["my-gateway"]?.models?.map((model) => model.id)).toEqual(["local-llama"]);
	});

	it("删除时连同地址一起清掉", async () => {
		const store = new ModelConfigStore({ file });
		await store.saveProvider(entry);
		await store.removeProvider("my-gateway");
		expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ providers: {} });
	});

	it("空着或不是正数的可选字段不写进配置", async () => {
		// pi 对 models.json 是整份校验：写进一条 `name: ""` 或 `contextWindow: 0`，整份文件
		// 都会被它拒收，自定义提供方连同模型一起从目录里消失
		const store = new ModelConfigStore({ file });
		await store.saveProvider({
			...entry,
			models: [{ id: "local-llama", name: "   ", contextWindow: 0, maxTokens: -1, reasoning: false }],
		});
		const written = JSON.parse(await readFile(file, "utf8")) as {
			providers: Record<string, { models?: unknown }>;
		};
		expect(written.providers["my-gateway"]?.models).toEqual([{ id: "local-llama", reasoning: false }]);
	});

	it("展示名去掉首尾空白后写进配置", async () => {
		const store = new ModelConfigStore({ file });
		await store.saveProvider({ ...entry, models: [{ id: "local-llama", name: "  Llama 本地 " }] });
		const written = JSON.parse(await readFile(file, "utf8")) as {
			providers: Record<string, { models?: unknown }>;
		};
		expect(written.providers["my-gateway"]?.models).toEqual([{ id: "local-llama", name: "Llama 本地" }]);
	});
});

describe("配置里写的密钥", () => {
	it("认明文与 $ENV 引用,不展开 !命令", async () => {
		await writeFile(
			file,
			JSON.stringify({
				providers: {
					plain: { apiKey: "sk-plain" },
					env: { apiKey: "$FACET_TEST_KEY" },
					braced: { apiKey: "$" + "{FACET_TEST_KEY}" },
					command: { apiKey: "!echo sk" },
					missing: {},
				},
			}),
			"utf8",
		);
		const store = new ModelConfigStore({ file });
		process.env.FACET_TEST_KEY = "sk-env";
		expect(await store.apiKey("plain")).toBe("sk-plain");
		expect(await store.apiKey("env")).toBe("sk-env");
		expect(await store.apiKey("braced")).toBe("sk-env");
		// 命令要执行才拿得到,属于 pi 的运行时职责
		expect(await store.apiKey("command")).toBeUndefined();
		expect(await store.apiKey("missing")).toBeUndefined();
		process.env.FACET_TEST_KEY = "";
		expect(await store.apiKey("env")).toBeUndefined();
	});
});
