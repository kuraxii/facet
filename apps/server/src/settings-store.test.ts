import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "@facet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSettings, SettingsStore } from "./settings-store.ts";

let root: string;
let file: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "facet-settings-"));
	file = join(root, "settings.json");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("设置读取", () => {
	it("文件不存在时用缺省值", async () => {
		const store = await SettingsStore.open({ file });
		expect(store.get()).toEqual(DEFAULT_SETTINGS);
	});

	it("保存后重新打开读得到", async () => {
		const store = await SettingsStore.open({ file });
		const saved = await store.save({
			...store.get(),
			defaultModel: { provider: "new api", id: "deepseek-v4-flash" },
			appearance: { ...store.get().appearance, theme: "light", fontSize: 15 },
		});
		expect(saved.appearance.theme).toBe("light");

		const reopened = await SettingsStore.open({ file });
		expect(reopened.get().defaultModel).toEqual({ provider: "new api", id: "deepseek-v4-flash" });
		expect(reopened.get().appearance.fontSize).toBe(15);
	});

	it("内容读不懂时留档并回到缺省值", async () => {
		await writeFile(file, "这不是 JSON", "utf8");
		const store = await SettingsStore.open({ file });
		expect(store.get()).toEqual(DEFAULT_SETTINGS);
		const names = await readdir(root);
		expect(names.some((name) => name.startsWith("settings.json.broken-"))).toBe(true);
	});

	it("不合法的字段回落缺省值,其余保留", async () => {
		await writeFile(
			file,
			JSON.stringify({
				version: 1,
				defaultModel: { provider: "p" },
				hiddenModels: ["a/b", 3],
				appearance: { theme: "紫色", fontSize: 999, reducedMotion: true },
				input: { sendKey: "??? " },
				layout: { sidebarWidth: 10 },
			}),
			"utf8",
		);
		const settings = (await SettingsStore.open({ file })).get();
		expect(settings.defaultModel).toBeUndefined();
		expect(settings.hiddenModels).toEqual(["a/b"]);
		expect(settings.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
		expect(settings.appearance.fontSize).toBe(20);
		expect(settings.appearance.reducedMotion).toBe(true);
		expect(settings.input.sendKey).toBe(DEFAULT_SETTINGS.input.sendKey);
		expect(settings.layout.sidebarWidth).toBe(200);
	});

	it("版本不认识时回到缺省值", () => {
		expect(parseSettings({ version: 99 })).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("写盘失败时内存保持原样,也不留临时文件", async () => {
		const directory = join(root, "dir");
		await mkdir(directory);
		const nested = join(directory, "settings.json");
		const store = await SettingsStore.open({ file: nested });
		const before = store.get();
		// 把设置路径换成目录,改名到它上面必然失败
		await mkdir(nested, { recursive: true });

		await expect(
			store.save({ ...before, appearance: { ...before.appearance, theme: "light" } }),
		).rejects.toThrow();
		expect(store.get()).toEqual(before);
		const names = await readdir(directory);
		expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	it("写出的文件带版本号", async () => {
		const store = await SettingsStore.open({ file: join(root, "nested", "settings.json") });
		await store.save({ ...store.get(), hiddenModels: ["a/b"] });
		const written = JSON.parse(await readFile(join(root, "nested", "settings.json"), "utf8")) as {
			version: number;
			hiddenModels: string[];
		};
		expect(written.version).toBe(1);
		expect(written.hiddenModels).toEqual(["a/b"]);
	});
});
