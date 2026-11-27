/**
 * 界面与新建会话的偏好设置。
 *
 * 这些设置存在主机的应用数据目录里，与 pi 的模型配置、凭证分开：pi 管的是运行时怎么调模型、
 * 新建会话默认用哪个模型，这里管的是界面怎么显示与其它会话偏好。整份设置作为一个对象读写，
 * 避免逐字段合并带来的半新半旧。
 */

/**
 * 具体的界面配色方案。
 *
 * light 为 GitHub Copilot 浅色，dark 为缺省的 GitHub Copilot 深色，claude 为暖棕深色变体。
 */
export const UI_THEMES = ["light", "dark", "claude"] as const;

/** 一个配色方案。 */
export type UiTheme = (typeof UI_THEMES)[number];

/** 主题。system 表示跟随系统深浅色，深色一侧用缺省的 dark。 */
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

/** 运行中状态的表现方式。pulse 为文字不透明度呼吸，shimmer 为一道光带扫过。 */
export type LiveMotion = "pulse" | "shimmer";

/** 可选的运行中动效，设置页按这个顺序列出。 */
export const LIVE_MOTIONS: readonly LiveMotion[] = ["pulse", "shimmer"];

/** 外观设置。 */
export interface AppearanceSettings {
	/** 主题 */
	theme: ThemeMode;
	/** 代码块与差异视图的高亮配色 */
	codeTheme: CodeTheme;
	/** 聊天里代码块与补丁用的等宽字体，空串表示用内置的 Maple Mono NF */
	codeFont: string;
	/** 编辑器字体，空串表示跟代码字体走同一个字体栈 */
	editorFont: string;
	/** 编辑器字号，单位 px */
	editorFontSize: number;
	/** 终端字体，空串表示跟代码字体 */
	terminalFont: string;
	/** 终端字号，单位 px */
	terminalFontSize: number;
	/** 是否减少动效，开启后界面不做过渡与动画 */
	reducedMotion: boolean;
	/** 运行中状态用哪种动效；呼吸只改不透明度，扫光逐帧重绘文字，更费电 */
	liveMotion: LiveMotion;
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

/** 终端设置。 */
export interface TerminalSettings {
	/**
	 * 新建终端用哪种 shell。
	 *
	 * 空串表示「自动」：主机按探测顺序取第一个（Windows 上 pwsh 7 → Windows PowerShell →
	 * Git Bash → WSL → cmd，POSIX 上是 `$SHELL`）。取值是主机上报的 profile 标识，主机那边
	 * 认不出来时同样回落到「自动」。
	 */
	profile: string;
}

/** 本机终端交互偏好，不随主机切换而改变。 */
export interface TerminalLocalSettings {
	/** 光标是否闪烁 */
	cursorBlink: boolean;
	/** 终端回滚缓冲行数，取值 500 到 50000 */
	scrollback: number;
}

/** 缺省的本机终端交互偏好。 */
export const DEFAULT_TERMINAL_LOCAL_SETTINGS: TerminalLocalSettings = {
	cursorBlink: true,
	scrollback: 5000,
};

/** 桌面通知偏好，只在桌面端生效。 */
export interface NotificationSettings {
	/** 窗口未聚焦时是否发送系统通知 */
	enabled: boolean;
	/** 任务完成或出错时通知 */
	onSettled: boolean;
	/** 需要用户审批或输入时通知 */
	onNeedsInput: boolean;
}

/** 缺省的桌面通知偏好。 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
	enabled: true,
	onSettled: true,
	onNeedsInput: true,
};

/** 一整份设置。 */
export interface FacetSettings {
	/** 文件格式版本 */
	version: 1;
	/** 外观 */
	appearance: AppearanceSettings;
	/** 输入 */
	input: InputSettings;
	/** 界面布局 */
	layout: LayoutSettings;
	/** 终端 */
	terminal: TerminalSettings;
}

/** 缺省设置。 */
export const DEFAULT_SETTINGS: FacetSettings = {
	version: 1,
	appearance: {
		theme: "dark",
		codeTheme: "github",
		codeFont: "",
		editorFont: "",
		editorFontSize: 13,
		terminalFont: "",
		terminalFontSize: 12.5,
		reducedMotion: false,
		liveMotion: "pulse",
	},
	input: { sendKey: "enter" },
	layout: { sidebarWidth: 272 },
	terminal: { profile: "" },
};
