/**
 * 界面偏好设置的持久化。
 *
 * 写在 `$XDG_DATA_HOME/facet/settings.json`，与项目清单分开：偏好读不出来时全部回到缺省，
 * 不影响项目与会话。整份设置一次读写，改动串行执行，写盘成功之后才替换内存。
 */
import { readFile, rename } from "node:fs/promises";
import { writeFileAtomic } from "@facet/agent";
import {
	CODE_THEMES,
	type CodeTheme,
	DEFAULT_SETTINGS,
	type FacetSettings,
	type SendKey,
	type ThemeMode,
	UI_THEMES,
} from "@facet/protocol";

/** 文件格式版本，读取时按它判断能否兼容。 */
const FILE_VERSION = 1;

/** 打开设置的参数。 */
export interface SettingsStoreOptions {
	/** 设置文件路径 */
	file: string;
}

/** 字号允许的范围，超出时按边界处理。 */
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 20;
/** 侧栏宽度允许的范围。 */
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 520;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 取一个落在范围内的数字，不合法时用缺省值。 */
function readNumber(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, Math.round(value)))
		: fallback;
}

/** 取一个受限的字符串，不在允许集合里时用缺省值。 */
function readChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

/** 取一个字符串，非字符串时用缺省值。 */
function readString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

/** 读出模型引用，字段不全时视为未设置。 */
function readModelRef(value: unknown): FacetSettings["defaultModel"] {
	if (!isRecord(value) || typeof value.provider !== "string" || typeof value.id !== "string") {
		return undefined;
	}
	return { provider: value.provider, id: value.id };
}

/** 思考档位。 */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * 把读进来的内容收成一份设置。
 *
 * 逐项校验，读不懂的字段回落到缺省值而不是整份丢弃：少一项设置不该让用户重填全部。
 */
export function parseSettings(value: unknown): FacetSettings {
	if (!isRecord(value) || value.version !== FILE_VERSION) {
		return structuredClone(DEFAULT_SETTINGS);
	}
	const appearance = isRecord(value.appearance) ? value.appearance : {};
	const input = isRecord(value.input) ? value.input : {};
	const layout = isRecord(value.layout) ? value.layout : {};
	const defaultThinkingLevel = readChoice(value.defaultThinkingLevel, THINKING_LEVELS, "medium");
	return {
		version: FILE_VERSION,
		...(readModelRef(value.defaultModel) === undefined
			? {}
			: { defaultModel: readModelRef(value.defaultModel) }),
		...(typeof value.defaultThinkingLevel === "string" && THINKING_LEVELS.includes(defaultThinkingLevel)
			? { defaultThinkingLevel }
			: {}),
		appearance: {
			theme: readChoice<ThemeMode>(
				appearance.theme,
				[...UI_THEMES, "system"],
				DEFAULT_SETTINGS.appearance.theme,
			),
			codeTheme: readChoice<CodeTheme>(
				appearance.codeTheme,
				CODE_THEMES,
				DEFAULT_SETTINGS.appearance.codeTheme,
			),
			// 老版本把界面字体叫 bodyFont、界面字号叫 fontSize，读的时候兼容过来
			uiFont: readString(appearance.uiFont ?? appearance.bodyFont, DEFAULT_SETTINGS.appearance.uiFont),
			uiFontSize: readNumber(
				appearance.uiFontSize ?? appearance.fontSize,
				DEFAULT_SETTINGS.appearance.uiFontSize,
				MIN_FONT_SIZE,
				MAX_FONT_SIZE,
			),
			codeFont: readString(appearance.codeFont, DEFAULT_SETTINGS.appearance.codeFont),
			editorFont: readString(appearance.editorFont, DEFAULT_SETTINGS.appearance.editorFont),
			editorFontSize: readNumber(
				appearance.editorFontSize,
				DEFAULT_SETTINGS.appearance.editorFontSize,
				MIN_FONT_SIZE,
				MAX_FONT_SIZE,
			),
			terminalFont: readString(appearance.terminalFont, DEFAULT_SETTINGS.appearance.terminalFont),
			terminalFontSize: readNumber(
				appearance.terminalFontSize,
				DEFAULT_SETTINGS.appearance.terminalFontSize,
				MIN_FONT_SIZE,
				MAX_FONT_SIZE,
			),
			reducedMotion:
				typeof appearance.reducedMotion === "boolean"
					? appearance.reducedMotion
					: DEFAULT_SETTINGS.appearance.reducedMotion,
		},
		input: {
			sendKey: readChoice<SendKey>(input.sendKey, ["enter", "shiftEnter"], DEFAULT_SETTINGS.input.sendKey),
		},
		layout: {
			sidebarWidth: readNumber(
				layout.sidebarWidth,
				DEFAULT_SETTINGS.layout.sidebarWidth,
				MIN_SIDEBAR_WIDTH,
				MAX_SIDEBAR_WIDTH,
			),
		},
	};
}

export class SettingsStore {
	private readonly file: string;
	/** 当前设置。改动写盘成功之后才替换 */
	private current: FacetSettings = structuredClone(DEFAULT_SETTINGS);
	/** 串行化的操作队列 */
	private tail: Promise<unknown> = Promise.resolve();

	private constructor(file: string) {
		this.file = file;
	}

	/** 打开设置。文件不存在时用缺省值，内容读不懂时把原文件改名留档。 */
	static async open(options: SettingsStoreOptions): Promise<SettingsStore> {
		const store = new SettingsStore(options.file);
		await store.load();
		return store;
	}

	/** 设置文件路径。 */
	get path(): string {
		return this.file;
	}

	/** 当前设置。 */
	get(): FacetSettings {
		return structuredClone(this.current);
	}

	/**
	 * 整份替换。
	 *
	 * 写盘失败时内存保持原样并把错误抛给调用方，界面保留输入直接重试。
	 */
	async save(next: FacetSettings): Promise<FacetSettings> {
		return await this.exclusive(async () => {
			const parsed = parseSettings(next);
			await writeFileAtomic(this.file, `${JSON.stringify(parsed, null, 2)}\n`);
			this.current = parsed;
			return structuredClone(parsed);
		});
	}

	private async exclusive<T>(work: () => Promise<T>): Promise<T> {
		const run = this.tail.catch(() => undefined).then(work);
		this.tail = run.catch(() => undefined);
		return await run;
	}

	private async load(): Promise<void> {
		let text: string;
		try {
			text = await readFile(this.file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw error;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			await this.keepBrokenFile();
			return;
		}
		this.current = parseSettings(parsed);
	}

	/** 把读不懂的文件改名留档，下次写入不会覆盖它。 */
	private async keepBrokenFile(): Promise<void> {
		await rename(this.file, `${this.file}.broken-${Date.now()}`).catch(() => undefined);
	}
}
