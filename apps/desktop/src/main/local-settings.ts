/**
 * 桌面本地的窗口记录。
 *
 * 窗口位置与尺寸跟这一台机器的显示器有关，存在桌面的用户配置目录，与主机侧的应用设置分开：
 * 换一台显示器或远端主机时，这边仍然用本机上次的大小。
 */
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "@facet/agent";

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

/** 桌面本地设置。 */
export interface LocalSettings {
	/** 文件格式版本 */
	version: 1;
	/** 上次退出时的窗口位置与尺寸，缺省时用应用默认值 */
	window?: WindowBounds;
}

/** 缺省宽度，没有记录时用。 */
export const DEFAULT_WINDOW_WIDTH = 1100;

/** 缺省高度，没有记录时用。 */
export const DEFAULT_WINDOW_HEIGHT = 760;

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
	const record = data as { version?: unknown; window?: unknown };
	const window = readWindowBounds(record.window);
	return {
		version: 1,
		...(window === undefined ? {} : { window }),
	};
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

/** 取整数，NaN 与非有限值视为没有记录。 */
function readInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}
