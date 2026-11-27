/**
 * 桌面本地的窗口记录。
 *
 * 窗口位置与尺寸跟这一台机器的显示器有关，存在桌面的用户配置目录，与主机侧的应用设置分开：
 * 换一台显示器或远端主机时，这边仍然用本机上次的大小。
 */
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "@facet/agent";
import { type LanguageSetting, readLanguageSetting } from "@facet/i18n";
import {
	type AppearanceSettings,
	CODE_THEMES,
	type CodeTheme,
	DEFAULT_SETTINGS,
	type InputSettings,
	LIVE_MOTIONS,
	type LiveMotion,
	type SendKey,
	type ThemeMode,
	UI_THEMES,
} from "@facet/protocol";

/** 窗口位置与尺寸。x、y 缺省时由系统决定位置。 */
export interface WindowBounds {
	/** 宽度，单位 px */
	width: number;
	/** 高度，单位 px */
	height: number;
	/** 距屏幕左边距 */
	x?: number;
	/** 距屏幕上边距 */
	y?: number;
	/** 是否最大化 */
	maximized: boolean;
}

/** 分作用域存储数据：对标 VS Code `StorageScope.APPLICATION` 与 `StorageScope.WORKSPACE`。 */
export interface ScopedStorageData {
	/** 应用级键值（跨主机共享：主机列表、左侧栏宽与收起状态等） */
	app?: Record<string, string>;
	/** 按主机端点隔离的工作区键值（当前会话、右栏标签与宽度、文件树开关、输入草稿等） */
	workspaces?: Record<string, Record<string, string>>;
}

/** 桌面本地设置。 */
export interface LocalSettings {
	/** 文件格式版本 */
	version: 1;
	/** 上次退出时的窗口位置与尺寸，缺省时用应用默认值 */
	window?: WindowBounds;
	/** 界面缩放百分比，缺省 100 */
	uiScale?: number;
	/** 界面语言设置；缺省跟随系统 */
	language?: LanguageSetting;
	/** 本机优先的外观配置，独立于远端主机设置 */
	appearance?: AppearanceSettings;
	/** 本机优先的输入偏好（如发送键位） */
	input?: InputSettings;
	/** 渲染层分作用域持久化键值表 */
	storage?: ScopedStorageData;
}

/** 缺省宽度，没有记录时用。 */
export const DEFAULT_WINDOW_WIDTH = 1100;

/** 缺省高度，没有记录时用。 */
export const DEFAULT_WINDOW_HEIGHT = 760;

/** 缺省界面缩放百分比。 */
export const DEFAULT_UI_SCALE = 100;

/** 界面缩放的允许范围。 */
export const UI_SCALE_MIN = 80;
export const UI_SCALE_MAX = 150;

/** 界面缩放的离散档位。 */
const UI_SCALE_STEPS = [80, 90, 100, 110, 125, 135, 150];

const MIN_WIDTH = 640;
const MAX_WIDTH = 8000;
const MIN_HEIGHT = 480;
const MAX_HEIGHT = 8000;

/** 读取本地设置，文件不存在或内容读不懂时给空设置。 */
export async function readLocalSettings(file: string): Promise<LocalSettings> {
	try {
		return parseLocalSettings(await readFile(file, "utf8"));
	} catch {
		return { version: 1 };
	}
}

/** 写入本地设置，整个文件替换。 */
export async function writeLocalSettings(file: string, settings: LocalSettings): Promise<void> {
	await writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** 把文件内容收成一份设置；字段不合规的丢掉，不因此丢整份。 */
export function parseLocalSettings(text: string): LocalSettings {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return { version: 1 };
	}
	if (typeof data !== "object" || data === null) {
		return { version: 1 };
	}
	const record = data as {
		version?: unknown;
		window?: unknown;
		uiScale?: unknown;
		language?: unknown;
		appearance?: unknown;
		input?: unknown;
		storage?: unknown;
	};
	const window = readWindowBounds(record.window);
	const uiScale = readUiScale(record.uiScale);
	const language = readLanguageSetting(record.language);
	const appearance = readAppearanceSettings(record.appearance);
	const input = readInputSettings(record.input);
	const storage = readScopedStorage(record.storage);
	return {
		version: 1,
		...(window === undefined ? {} : { window }),
		...(uiScale === undefined ? {} : { uiScale }),
		...(language === undefined ? {} : { language }),
		...(appearance === undefined ? {} : { appearance }),
		...(input === undefined ? {} : { input }),
		...(storage === undefined ? {} : { storage }),
	};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

function readSteppedNumber(value: unknown, fallback: number, min: number, max: number, step: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	const stepped = Math.round(value / step) * step;
	return Math.min(max, Math.max(min, stepped));
}

/** 读取本机外观设置；未落盘时返回 undefined，供首次运行从本机主机迁移。 */
export function readAppearanceSettings(value: unknown): AppearanceSettings | undefined {
	if (!isPlainRecord(value)) {
		return undefined;
	}
	const def = DEFAULT_SETTINGS.appearance;
	return {
		theme: readChoice<ThemeMode>(value.theme, [...UI_THEMES, "system"], def.theme),
		codeTheme: readChoice<CodeTheme>(value.codeTheme, CODE_THEMES, def.codeTheme),
		codeFont: typeof value.codeFont === "string" ? value.codeFont : def.codeFont,
		editorFont: typeof value.editorFont === "string" ? value.editorFont : def.editorFont,
		editorFontSize: readSteppedNumber(value.editorFontSize, def.editorFontSize, 11, 20, 0.5),
		terminalFont: typeof value.terminalFont === "string" ? value.terminalFont : def.terminalFont,
		terminalFontSize: readSteppedNumber(value.terminalFontSize, def.terminalFontSize, 11, 20, 0.5),
		reducedMotion: typeof value.reducedMotion === "boolean" ? value.reducedMotion : def.reducedMotion,
		liveMotion: readChoice<LiveMotion>(value.liveMotion, LIVE_MOTIONS, def.liveMotion),
		outlineScale: readSteppedNumber(value.outlineScale, def.outlineScale, 50, 200, 5),
	};
}

/** 读取本机输入设置；未落盘时返回 undefined。 */
export function readInputSettings(value: unknown): InputSettings | undefined {
	if (!isPlainRecord(value)) {
		return undefined;
	}
	return {
		sendKey: readChoice<SendKey>(value.sendKey, ["enter", "shiftEnter"], DEFAULT_SETTINGS.input.sendKey),
	};
}

function readStringMap(value: unknown): Record<string, string> | undefined {
	if (!isPlainRecord(value)) {
		return undefined;
	}
	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof v === "string") {
			result[k] = v;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

/** 读取分作用域存储表，过滤掉非字符串条目。 */
export function readScopedStorage(value: unknown): ScopedStorageData | undefined {
	if (!isPlainRecord(value)) {
		return undefined;
	}
	const app = readStringMap(value.app);
	let workspaces: Record<string, Record<string, string>> | undefined;
	if (isPlainRecord(value.workspaces)) {
		const mapped: Record<string, Record<string, string>> = {};
		for (const [scope, table] of Object.entries(value.workspaces)) {
			const clean = readStringMap(table);
			if (clean !== undefined) {
				mapped[scope] = clean;
			}
		}
		if (Object.keys(mapped).length > 0) {
			workspaces = mapped;
		}
	}
	if (app === undefined && workspaces === undefined) {
		return undefined;
	}
	return {
		...(app === undefined ? {} : { app }),
		...(workspaces === undefined ? {} : { workspaces }),
	};
}

/** 根据主题与系统深浅色给出首屏窗口底色（对应 `theme.css` 中的 `--bg-canvas`），避免启动闪黑或闪白。 */
export function resolveWindowBackgroundColor(
	theme: ThemeMode | undefined,
	systemShouldUseDark: boolean,
): string {
	const resolved =
		theme === undefined || theme === "system" ? (systemShouldUseDark ? "dark" : "light") : theme;
	switch (resolved) {
		case "light":
			return "#ffffff";
		case "claude":
			return "#1f1f1e";
		case "dark":
			return "#0d1117";
	}
}

/** 屏幕矩形，与 Electron `Display.workArea` 对齐。 */
export interface ScreenRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * 判断恢复的窗口矩形是否与屏幕工作区存在足够可见的交集。
 *
 * 贴边或带系统阴影偏移的窗口左上角可能出现几像素负值，改用交集面积判断以免坐标被误判丢弃。
 */
export function boundsVisibleOnScreen(bounds: WindowBounds, workAreas: readonly ScreenRect[]): boolean {
	if (bounds.x === undefined || bounds.y === undefined) {
		return false;
	}
	const minVisibleW = Math.min(100, bounds.width);
	const minVisibleH = Math.min(40, bounds.height);
	const left = bounds.x;
	const top = bounds.y;
	const right = bounds.x + bounds.width;
	const bottom = bounds.y + bounds.height;
	return workAreas.some((area) => {
		const overlapW = Math.min(right, area.x + area.width) - Math.max(left, area.x);
		const overlapH = Math.min(bottom, area.y + area.height) - Math.max(top, area.y);
		return overlapW >= minVisibleW && overlapH >= minVisibleH;
	});
}

/** 读窗口记录，缺字段或越界时收回合理范围。 */
export function readWindowBounds(value: unknown): WindowBounds | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	return {
		width: clamp(record.width, DEFAULT_WINDOW_WIDTH, MIN_WIDTH, MAX_WIDTH),
		height: clamp(record.height, DEFAULT_WINDOW_HEIGHT, MIN_HEIGHT, MAX_HEIGHT),
		...(readInteger(record.x) === undefined ? {} : { x: readInteger(record.x) as number }),
		...(readInteger(record.y) === undefined ? {} : { y: readInteger(record.y) as number }),
		maximized: record.maximized === true,
	};
}

/** 取数字并收进范围，不是数字时用缺省值。 */
function clamp(value: unknown, fallback: number, min: number, max: number): number {
	const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
	return Math.min(Math.max(number, min), max);
}

/** 读界面缩放百分比；没有记录或不是数字时返回 undefined。 */
export function readUiScale(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	return normalizeUiScale(clamp(value, DEFAULT_UI_SCALE, UI_SCALE_MIN, UI_SCALE_MAX));
}

/** 取最接近的完整档位。 */
function normalizeUiScale(value: number): number {
	return UI_SCALE_STEPS.reduce((closest, candidate) =>
		Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest,
	);
}

/** 取整数，NaN 与非有限值视为没有记录。 */
function readInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}
