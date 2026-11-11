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
	it("去掉末尾斜杠,空串表示恢复默认", () => {
		expect(normalizeBaseUrl("  https://api.example.com/v1/  ")).toBe("https://api.example.com/v1");
		expect(normalizeBaseUrl("   ")).toBeUndefined();
		expect(() => normalizeBaseUrl("ftp://x")).toThrow(InvalidBaseUrlError);
		expect(() => normalizeBaseUrl("不是地址")).toThrow(InvalidBaseUrlError);
	});

	it("写入后读得到,其他字段原样保留", async () => {
		await writeFile(
			file,
			JSON.stringify({ providers: { aimao: { api: "openai-completions", models: [{ id: "m1" }] } } }),
			"utf8",
		);
		const store = new ModelConfigStore({ file });
		await store.setBaseUrl("aimao", "https://gateway.example.com/v1");
		const written = JSON.parse(await readFile(file, "utf8")) as {
			providers: Record<string, { baseUrl?: string; api?: string; models?: unknown[] }>;
		};
		expect(written.providers.aimao?.baseUrl).toBe("https://gateway.example.com/v1");
		expect(written.providers.aimao?.api).toBe("openai-completions");
		expect(written.providers.aimao?.models).toHaveLength(1);
	});

	it("恢复默认时删掉地址,条目空了就整条去掉", async () => {
		const store = new ModelConfigStore({ file });
		await store.setBaseUrl("aimao", "https://gateway.example.com/v1");
		expect(await store.overrides()).toEqual({ aimao: "https://gateway.example.com/v1" });

		await store.setBaseUrl("aimao", "");
		expect(await store.overrides()).toEqual({});
		expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ providers: {} });
	});

	it("内容读不懂时留档并当作空配置", async () => {
		await writeFile(file, "{ 坏掉的", "utf8");
		const store = new ModelConfigStore({ file });
		expect(await store.overrides()).toEqual({});
		const names = await readdir(root);
		expect(names.some((name) => name.startsWith("models.json.broken-"))).toBe(true);
	});

	it("并发写地址不互相覆盖", async () => {
		const store = new ModelConfigStore({ file });
		await Promise.all([
			store.setBaseUrl("a", "https://a.example.com"),
			store.setBaseUrl("b", "https://b.example.com"),
			store.setBaseUrl("c", "https://c.example.com"),
		]);
		expect(await store.overrides()).toEqual({
			a: "https://a.example.com",
			b: "https://b.example.com",
			c: "https://c.example.com",
		});
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
		await store.setBaseUrl("anthropic", "https://proxy.example.com");
		await store.saveProvider(entry);

		expect(await store.customProviders()).toEqual([entry]);
		expect(await store.isCustom("my-gateway")).toBe(true);
		expect(await store.isCustom("anthropic")).toBe(false);
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
});
