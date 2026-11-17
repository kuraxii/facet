/**
 * 渲染进程里长期活着的对象。
 *
 * 传输、会话客户端、终端客户端与连接链路都是整窗口一份，不属于任何一次渲染；放在这里
 * 让各个 Hook 直接取用，不必彼此传递，也不必从 `App.tsx` 反向导入。
 */
import { ConnectionLink, type LinkHooks, SessionClient, TerminalClient } from "@facet/client-core";
import type { LanguageSetting, SupportedLanguage } from "@facet/i18n";
import { type HostChannelBridge, LOCAL_TARGET, makeTransport } from "./host-connection.ts";

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
}

declare global {
	interface Window {
		facet: FacetBridge;
	}
}

export const bridge = window.facet;

/** 连接屏显示哪一屏。ready 表示主机已经可以收发。 */
export type Phase = "connecting" | "ready" | "failed";

/**
 * 当前要连的目标。
 *
 * 本机是固定标识，具体地址与令牌由主进程按发现文件给出；在清单里换主机时改这里，
 * 下一次 connect 就换目标。
 */
let hostTarget: string = LOCAL_TARGET;

/**
 * 本次连接要用的 SSH 密码。
 *
 * 由密码弹窗填进来，主进程收到后会自己留着供重连使用；这里只是把「这一次握手用哪个密码」
 * 交给通道，不写进本地存储。
 */
let sshPassword: string | undefined;

/** 换下一个要连的端点，下一次 connect 生效。 */
export function setHostTarget(target: string): void {
	hostTarget = target;
}

/** 读出这一次握手要用的 SSH 密码。 */
export function currentSshPassword(): string | undefined {
	return sshPassword;
}

/** 记下这一次握手要用的 SSH 密码，没有密码时清空。 */
export function setSshPassword(password: string | undefined): void {
	sshPassword = password;
}

export const transport = makeTransport(
	bridge,
	() => hostTarget,
	() => sshPassword,
);

export const client = new SessionClient({ transport, pageSize: 200, initialPages: 2 });
export const terminalClient = new TerminalClient({ transport });

/**
 * 重连期间宿主自己要做的事。
 *
 * 链路负责退避、续订与状态快照；连上之后要不要重取会话清单、项目与设置属于界面，从这里挂进去。
 * 字段在组件挂载之后才填上，链路每次都读当时那一份。
 */
export const linkHooks: LinkHooks = {};

export const connection = new ConnectionLink({
	transport,
	session: client,
	hooks: linkHooks,
	// 缺密码时重试没有意义，停下来让界面问一次
	retryable: (error) => (error as { code?: unknown } | undefined)?.code !== "need_password",
});
