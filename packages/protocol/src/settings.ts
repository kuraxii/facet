/**
 * 界面与新建会话的偏好设置。
 *
 * 这些设置存在主机的应用数据目录里，与 pi 的模型配置、凭证分开：pi 管的是运行时怎么调模型，
 * 这里管的是界面怎么显示、新建会话用哪个模型。整份设置作为一个对象读写，避免逐字段合并
 * 带来的半新半旧。
 */
import type { ModelRef, ThinkingLevel } from "./model.ts";

/** 主题。system 表示跟随系统深浅色。 */
export type ThemeMode = "dark" | "light" | "system";

/** 发送键位。enter 为回车发送，shiftEnter 为回车换行、⌘/Ctrl+回车发送。 */
export type SendKey = "enter" | "shiftEnter";

/** 外观设置。 */
export interface AppearanceSettings {
	/** 主题 */
	theme: ThemeMode;
	/** 正文字体，空串表示用界面默认字体 */
	bodyFont: string;
	/** 代码字体，空串表示用界面默认等宽字体 */
	codeFont: string;
	/** 正文字号，单位 px */
	fontSize: number;
	/** 是否减少动效，开启后界面不做过渡与动画 */
	reducedMotion: boolean;
}

/** 输入设置。 */
export interface InputSettings {
	/** 发送键位 */
	sendKey: SendKey;
}

/** 界面布局设置。 */
export interface LayoutSettings {
	/** 侧栏宽度，单位 px */
	sidebarWidth: number;
}

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

/** 一整份设置。 */
export interface FacetSettings {
	/** 文件格式版本 */
	version: 1;
	/** 新建会话采用的默认模型，缺省时取第一个可用模型 */
	defaultModel?: ModelRef;
	/** 新建会话采用的默认思考档位，缺省时由模型能力决定 */
	defaultThinkingLevel?: ThinkingLevel;
	/** 模型选择器里隐藏的模型，键为 `provider/model` */
	hiddenModels: string[];
	/** 外观 */
	appearance: AppearanceSettings;
	/** 输入 */
	input: InputSettings;
	/** 界面布局 */
	layout: LayoutSettings;
	/** 上次退出时的窗口位置与尺寸，缺省时用应用默认值 */
	window?: WindowBounds;
}

/** 缺省设置。 */
export const DEFAULT_SETTINGS: FacetSettings = {
	version: 1,
	hiddenModels: [],
	appearance: {
		theme: "dark",
		bodyFont: "",
		codeFont: "",
		fontSize: 13,
		reducedMotion: false,
	},
	input: { sendKey: "enter" },
	layout: { sidebarWidth: 272 },
};
