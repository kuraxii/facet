/**
 * 桌面本地窗口记录的测试。
 *
 * 覆盖缺省值、越界收回、坏文件回落，以及写入后读回一致。
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	boundsVisibleOnScreen,
	DEFAULT_WINDOW_HEIGHT,
	DEFAULT_WINDOW_WIDTH,
	parseLocalSettings,
	readAppearanceSettings,
	readInputSettings,
	readLocalSettings,
	readScopedStorage,
	readUiScale,
	readWindowBounds,
	resolveWindowBackgroundColor,
	writeLocalSettings,
} from "./local-settings.ts";

describe("parseLocalSettings", () => {
	it("内容不是 JSON 时给空设置", () => {
		expect(parseLocalSettings("{ 坏内容")).toEqual({ version: 1 });
	});

	it("兼容旧内容：只认窗口字段，其余丢掉", () => {
		const parsed = parseLocalSettings(
			JSON.stringify({
				version: 1,
				window: { width: 900, height: 700, x: 10, y: 20, maximized: false },
				other: 1,
			}),
		);
		expect(parsed).toEqual({
			version: 1,
			window: { width: 900, height: 700, x: 10, y: 20, maximized: false },
		});
	});

	it("没有窗口记录时只有版本", () => {
		expect(parseLocalSettings(JSON.stringify({ version: 1 }))).toEqual({ version: 1 });
	});

	it("读取界面缩放并收回允许范围", () => {
		expect(parseLocalSettings(JSON.stringify({ version: 1, uiScale: 125 }))).toEqual({
			version: 1,
			uiScale: 125,
		});
		expect(parseLocalSettings(JSON.stringify({ version: 1, uiScale: 999 }))).toEqual({
			version: 1,
			uiScale: 150,
		});
		expect(parseLocalSettings(JSON.stringify({ version: 1, uiScale: 10 }))).toEqual({
			version: 1,
			uiScale: 80,
		});
	});

	it("界面缩放不是数字时丢掉", () => {
		expect(readUiScale("125")).toBeUndefined();
		expect(readUiScale(Number.NaN)).toBeUndefined();
	});

	it("读取语言设置，未知值丢掉", () => {
		expect(parseLocalSettings(JSON.stringify({ version: 1, language: "zh-CN" }))).toEqual({
			version: 1,
			language: "zh-CN",
		});
		expect(parseLocalSettings(JSON.stringify({ version: 1, language: "fr" }))).toEqual({
			version: 1,
		});
	});
});

describe("readWindowBounds", () => {
	it("缺字段时用缺省宽高", () => {
		expect(readWindowBounds({})).toEqual({
			width: DEFAULT_WINDOW_WIDTH,
			height: DEFAULT_WINDOW_HEIGHT,
			maximized: false,
		});
	});

	it("越界的宽高收回范围，非数字的坐标丢掉", () => {
		expect(readWindowBounds({ width: 100, height: 9000, x: "左", y: 12.6, maximized: "yes" })).toEqual({
			width: 640,
			height: 8000,
			y: 13,
			maximized: false,
		});
	});

	it("不是对象时没有窗口记录", () => {
		expect(readWindowBounds(42)).toBeUndefined();
		expect(readWindowBounds(null)).toBeUndefined();
	});
});

describe("读写本地设置", () => {
	it("写进去能读回来", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-local-"));
		const file = join(root, "nested", "desktop.json");
		await writeLocalSettings(file, {
			version: 1,
			uiScale: 125,
			language: "zh-CN",
			window: { width: 1200, height: 800, x: 5, y: 6, maximized: true },
		});
		expect(await readLocalSettings(file)).toEqual({
			version: 1,
			uiScale: 125,
			language: "zh-CN",
			window: { width: 1200, height: 800, x: 5, y: 6, maximized: true },
		});
		const written = JSON.parse(await readFile(file, "utf8")) as { version: number };
		expect(written.version).toBe(1);
	});

	it("文件不存在时给空设置", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-local-"));
		expect(await readLocalSettings(join(root, "missing.json"))).toEqual({ version: 1 });
	});

	it("文件内容读不懂时给空设置", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-local-"));
		const file = join(root, "desktop.json");
		await writeFile(file, "不是 JSON", "utf8");
		expect(await readLocalSettings(file)).toEqual({ version: 1 });
	});

	it("解析本机外观、输入偏好与分作用域存储表并过滤脏数据", () => {
		expect(readAppearanceSettings(undefined)).toBeUndefined();
		expect(
			readAppearanceSettings({
				theme: "claude",
				codeTheme: "nord",
				editorFontSize: 99,
				outlineScale: 123,
				reducedMotion: true,
			}),
		).toMatchObject({
			theme: "claude",
			codeTheme: "nord",
			editorFontSize: 20,
			outlineScale: 125,
			reducedMotion: true,
		});
		expect(readInputSettings({ sendKey: "shiftEnter" })).toEqual({ sendKey: "shiftEnter" });
		expect(readInputSettings({ sendKey: "other" })).toEqual({ sendKey: "enter" });
		expect(
			readScopedStorage({
				app: { ok: "1", bad: 2 },
				workspaces: { local: { a: "x" }, empty: { bad: true } },
			}),
		).toEqual({
			app: { ok: "1" },
			workspaces: { local: { a: "x" } },
		});
	});

	it("按主题解析窗口底色并用矩形交集判断是否落入屏幕内", () => {
		expect(resolveWindowBackgroundColor("light", true)).toBe("#ffffff");
		expect(resolveWindowBackgroundColor("claude", false)).toBe("#1f1f1e");
		expect(resolveWindowBackgroundColor("system", false)).toBe("#ffffff");
		expect(resolveWindowBackgroundColor("system", true)).toBe("#0d1117");

		const areas = [{ x: 0, y: 0, width: 1920, height: 1080 }];
		// 左上角有阴影负偏移的贴边窗口仍算可见
		expect(boundsVisibleOnScreen({ width: 1200, height: 800, x: -8, y: -4, maximized: false }, areas)).toBe(
			true,
		);
		// 完全拖到已拔掉的显示器坐标外算不可见
		expect(
			boundsVisibleOnScreen({ width: 1200, height: 800, x: 2500, y: 100, maximized: false }, areas),
		).toBe(false);
	});
});
