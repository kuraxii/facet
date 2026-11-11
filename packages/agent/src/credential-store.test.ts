import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileCredentialStore } from "./credential-store.ts";

let root: string;
let file: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "facet-credentials-"));
	file = join(root, "auth.json");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("凭证文件", () => {
	it("文件不存在时没有凭证", async () => {
		const store = new FileCredentialStore(file);
		expect(await store.read("anthropic")).toBeUndefined();
		expect(await store.list()).toEqual([]);
	});

	it("写入后读得到,落盘内容带类型标签", async () => {
		const store = new FileCredentialStore(file);
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-1" }));
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "sk-1" });
		const written = JSON.parse(await readFile(file, "utf8")) as Record<string, { type: string }>;
		expect(written.anthropic?.type).toBe("api_key");
		expect(await store.list()).toEqual([{ providerId: "anthropic", type: "api_key" }]);
	});

	it("替换凭证时看到的是上一次写入的内容", async () => {
		const store = new FileCredentialStore(file);
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-1" }));
		let seen: unknown;
		await store.modify("anthropic", async (current) => {
			seen = current;
			return { type: "api_key", key: "sk-2" };
		});
		expect(seen).toEqual({ type: "api_key", key: "sk-1" });
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "sk-2" });
	});

	it("返回 undefined 表示不改动", async () => {
		const store = new FileCredentialStore(file);
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-1" }));
		await store.modify("anthropic", async () => undefined);
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "sk-1" });
	});

	it("删除后不再有凭证,再删一次也不报错", async () => {
		const store = new FileCredentialStore(file);
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-1" }));
		await store.delete("anthropic");
		expect(await store.read("anthropic")).toBeUndefined();
		await store.delete("anthropic");
		expect(JSON.parse(await readFile(file, "utf8"))).toEqual({});
	});

	it("并发写入按顺序执行,不丢凭证", async () => {
		const store = new FileCredentialStore(file);
		await Promise.all([
			store.modify("a", async () => ({ type: "api_key", key: "ka" })),
			store.modify("b", async () => ({ type: "api_key", key: "kb" })),
			store.modify("c", async () => ({ type: "api_key", key: "kc" })),
		]);
		const written = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
		expect(Object.keys(written).sort()).toEqual(["a", "b", "c"]);
	});

	it("内容读不懂时留档并当作没有凭证", async () => {
		await writeFile(file, "这不是 JSON", "utf8");
		const store = new FileCredentialStore(file);
		expect(await store.list()).toEqual([]);
		const names = await readdir(root);
		expect(names.some((name) => name.startsWith("auth.json.broken-"))).toBe(true);
	});

	it("写盘失败时不留临时文件,原凭证仍在", async () => {
		const store = new FileCredentialStore(file);
		await store.modify("a", async () => ({ type: "api_key", key: "ka" }));
		const onDisk = await readFile(file, "utf8");
		await rename(file, join(root, "backup.json"));
		await mkdir(file, { recursive: true });

		await expect(store.modify("a", async () => ({ type: "api_key", key: "kb" }))).rejects.toThrow();
		const names = await readdir(root);
		expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
		expect(onDisk).toContain("ka");
	});
});
