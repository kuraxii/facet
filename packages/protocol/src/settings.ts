/**
 * 界面与新建会话的偏好设置。
 *
 * 这些设置存在主机的应用数据目录里，与 pi 的模型配置、凭证分开：pi 管的是运行时怎么调模型，
 * 这里管的是界面怎么显示、新建会话用哪个模型。整份设置作为一个对象读写，避免逐字段合并
 * 带来的半新半旧。
 */
import type { ModelRef, ThinkingLevel } from "./model.ts";

/**
 * 具体的界面配色方案。
 *
 * light 为唯一浅色，zinc 为缺省的深色，其余是同一套语义色板的深色变体。
 */
export const UI_THEMES = ["light", "zinc", "midnight", "claude", "ghostty", "pureBlack"] as const;

/** 一个配色方案。 */
export type UiTheme = (typeof UI_THEMES)[number];

/** 主题。system 表示跟随系统深浅色，深色一侧用缺省的 zinc。 */
export type ThemeMode = UiTheme | "system";

/** 代码高亮配色，浅深两版跟随界面主题的深浅。 */
export const CODE_THEMES = [
	"github",
	"catppuccin",
	"dracula",
	"tokyo-night",
	"one",
	"nord",
	"gruvbox",
	"solarized",
] as const;

/** 一套代码高亮配色。 */
export type CodeTheme = (typeof CODE_THEMES)[number];

/** 发送键位。enter 为回车发送，shiftEnter 为回车换行、⌘/Ctrl+回车发送。 */
export type SendKey = "enter" | "shiftEnter";

/** 外观设置。 */
export interface AppearanceSettings {
	/** 主题 */
	theme: ThemeMode;
	/** 代码块与差异视图的高亮配色 */
	codeTheme: CodeTheme;
	/** 界面字体：侧栏、弹窗、控件与聊天正文，空串表示用内置的 Inter 栈 */
	uiFont: string;
	/** 界面字号，单位 px */
	uiFontSize: number;
	/** 聊天里代码块与补丁用的等宽字体，空串表示用内置的 Maple Mono */
	codeFont: string;
	/** 编辑器字体，空串表示跟代码字体 */
	editorFont: string;
	/** 编辑器字号，单位 px */
	editorFontSize: number;
	/** 终端字体，空串表示跟代码字体 */
	terminalFont: string;
	/** 终端字号，单位 px */
	terminalFontSize: number;
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
}

/** 缺省设置。 */
export const DEFAULT_SETTINGS: FacetSettings = {
	version: 1,
	hiddenModels: [],
	appearance: {
		theme: "zinc",
		codeTheme: "github",
		uiFont: "",
		uiFontSize: 13,
		codeFont: "",
		editorFont: "",
		editorFontSize: 13,
		terminalFont: "",
		terminalFontSize: 12.5,
		reducedMotion: false,
	},
	input: { sendKey: "enter" },
	layout: { sidebarWidth: 272 },
};
