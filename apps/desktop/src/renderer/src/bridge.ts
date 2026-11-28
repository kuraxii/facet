/**
 * 预加载脚本装上的桥与它带的类型。
 *
 * 这里只放「这台机器上的界面能做什么」：读写设置、选文件、控制窗口。与主机有关的运行时
 * 按主机各一套，见 `host-runtime.ts`。
 */
import type { LanguageSetting, SupportedLanguage } from "@facet/i18n";
import type { AppearanceSettings, InputSettings } from "@facet/protocol";
import type { HostChannelBridge } from "./host-connection.ts";

/** 本机持久化初始快照，由预加载脚本或 Web 桥提供。 */
export interface BridgeLocalState {
	appearance?: AppearanceSettings;
	input?: InputSettings;
	storage?: {
		app?: Record<string, string>;
		workspaces?: Record<string, Record<string, string>>;
	};
}

/** 一张选中的图片，字节以 base64 交回界面 */
export interface PickedImageFile {
	readonly name: string;
	readonly mimeType: string;
	readonly data: string;
	readonly byteSize: number;
}

/** 预加载脚本注入的启动参数 */
export interface FacetBridge extends HostChannelBridge {
	projectDir: string;
	platform: string;
	/** 应用版本 */
	appVersion: string;
	/** 当前窗口的界面缩放百分比 */
	uiScale: number;
	/** 设置本机界面缩放 */
	setUiScale?: (scale: number) => void;
	/** 本机保存的语言设置 */
	languageSetting: LanguageSetting;
	/** 主进程解析后的实际语言 */
	language: SupportedLanguage;
	/** 修改语言，返回实际使用的语言 */
	setLanguage: (setting: LanguageSetting) => Promise<SupportedLanguage>;
	/** 本机持久化的初始快照 */
	localState?: BridgeLocalState;
	/** 写入或删除指定作用域下的持久化键值 */
	setScopedStorage?: (scope: string, key: string, value: string | null) => void;
	/** 更新本机优先的外观偏好 */
	setLocalAppearance?: (appearance: AppearanceSettings) => void;
	/** 更新本机优先的输入偏好 */
	setLocalInput?: (input: InputSettings) => void;
	/** 主机是本机管的（local），还是外面给的（external） */
	hostMode: string;
	/** 打开系统的目录选择窗口,取消时返回空 */
	pickDirectory: () => Promise<string | undefined>;
	/** 打开系统的选图窗口，取消时返回空数组 */
	pickImages: () => Promise<readonly PickedImageFile[]>;
	/** 用系统的保存窗口写一段文本,取消时返回 false */
	saveText: (suggestedName: string, text: string) => Promise<boolean>;
	/** 最小化窗口；浏览器端没有 */
	minimize?: () => void;
	/** 最大化与还原之间切换；浏览器端没有 */
	toggleMaximize?: () => void;
	/** 关闭窗口；浏览器端没有 */
	close?: () => void;
	/** 订阅最大化状态；浏览器端没有 */
	onWindowState?: (listener: (maximized: boolean) => void) => () => void;
	/** 弹一条系统通知；浏览器端没有 */
	notify?: (request: { file: string; body: string }) => Promise<boolean>;
	/** 订阅「点了某条系统通知」；浏览器端没有 */
	onNotifyClick?: (listener: (file: string) => void) => () => void;
	/** 桌面端右侧栏内嵌浏览器通道；Web 端没有 */
	browser?: {
		syncBounds: (bounds: { x: number; y: number; width: number; height: number; visible: boolean }) => void;
		navigate: (url: string) => void;
		back: () => void;
		forward: () => void;
		reload: () => void;
		stop: () => void;
		dispose: () => void;
		openExternal: (url: string) => void;
		onState: (
			listener: (state: {
				url: string;
				title: string;
				canGoBack: boolean;
				canGoForward: boolean;
				isLoading: boolean;
			}) => void,
		) => () => void;
	};
}

declare global {
	interface Window {
		facet: FacetBridge;
	}
}

export const bridge = window.facet;
