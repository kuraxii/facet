import type { LanguageSetting, SupportedLanguage } from "@facet/i18n";
import type { AppearanceSettings, ClientEntry, InputSettings } from "@facet/protocol";
import { contextBridge, ipcRenderer } from "electron";

/** 渲染层在预加载阶段拿到的本机持久化快照。 */
export interface InitialLocalState {
	readonly appearance?: AppearanceSettings;
	readonly input?: InputSettings;
	readonly storage?: {
		readonly app?: Record<string, string>;
		readonly workspaces?: Record<string, Record<string, string>>;
	};
}

const initialLocalState = ipcRenderer.sendSync("facet:local-state-init") as InitialLocalState | undefined;

/** 一张选中的图片，字节以 base64 交回界面。 */
export interface PickedImageFile {
	readonly name: string;
	readonly mimeType: string;
	readonly data: string;
	readonly byteSize: number;
}

/** 从主进程传进来的启动参数,预加载脚本读命令行拿到后再交给界面 */
function readArgument(name: string): string {
	const prefix = `--${name}=`;
	const found = process.argv.find((argument) => argument.startsWith(prefix));
	return found === undefined ? "" : found.slice(prefix.length);
}

/** 去掉 Electron 给 IPC 失败加的前缀，界面只看到自己的说明。 */
function cleanIpcError(error: unknown): Error {
	const text = error instanceof Error ? error.message : String(error);
	return new Error(text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ""));
}

/** 开通道的结果：成功给通道本身，失败给分类码与说明。 */
export type HostChannelResult =
	| {
			ok: true;
			id: number;
			token: string | undefined;
			role: "operator" | "viewer" | undefined;
			entry: ClientEntry;
			write: (text: string) => void;
			close: () => void;
	  }
	| { ok: false; code: string; message: string };

const api = {
	/** 主机是本机管的（local），还是外面跑着、这里只当客户端（external） */
	hostMode: readArgument("facet-host-mode") || "local",
	/** 关掉窗口后本机主机是否继续运行，来自桌面本地设置 */
	/**
	 * 本机主机的连接信息：目标、展示地址与连接令牌。
	 *
	 * 界面不自己解析发现文件，也不直连主机——所有帧都经主进程的通道转。
	 */
	getLocalHost: (): Promise<{ target: string; address: string; token: string | undefined } | undefined> =>
		ipcRenderer.invoke("facet:local-host"),
	/** 订阅本机主机变化（重启或重新拉起），界面据此重连 */
	onLocalHostChanged: (listener: () => void): (() => void) => {
		const handler = (): void => listener();
		ipcRenderer.on("facet:host-changed", handler);
		return () => {
			ipcRenderer.off("facet:host-changed", handler);
		};
	},
	/**
	 * 打开一条到主机的字节流。
	 *
	 * 主进程负责真正的连接（本机 unix socket 或 TCP、远程 TCP），这里只按帧搬运。
	 */
	openHostChannel: async (
		target: string,
		handlers: { onData: (chunk: string) => void; onClose: (reason: string) => void },
		/** SSH 登录密码；主进程会留着供重连使用 */
		password?: string,
	): Promise<HostChannelResult> => {
		const opened = (await ipcRenderer.invoke("facet:host-open", target, password).catch((error: unknown) => {
			throw cleanIpcError(error);
		})) as HostChannelResult;
		// 失败原因按值交回界面：跨 contextBridge 抛错误会把自定义的分类码丢掉
		if (!opened.ok) {
			return opened;
		}
		const id = opened.id;
		const onData = (_event: unknown, channel: number, chunk: string): void => {
			if (channel === id) {
				handlers.onData(chunk);
			}
		};
		const onClose = (_event: unknown, channel: number, reason: string): void => {
			if (channel === id) {
				stop();
				handlers.onClose(reason);
			}
		};
		const stop = (): void => {
			ipcRenderer.off("facet:host-data", onData);
			ipcRenderer.off("facet:host-close", onClose);
		};
		ipcRenderer.on("facet:host-data", onData);
		ipcRenderer.on("facet:host-close", onClose);
		return {
			ok: true,
			id,
			token: opened.token,
			role: opened.role,
			// 桌面主进程开的通道，本机 socket 与 SSH 隧道都是这个入口
			entry: "desktop",
			write: (text: string) => ipcRenderer.send("facet:host-write", id, text),
			close: () => {
				ipcRenderer.send("facet:host-close", id);
				stop();
			},
		};
	},
	/** 最小化窗口 */
	minimize: (): void => ipcRenderer.send("facet:window-minimize"),
	/** 最大化与还原之间切换 */
	toggleMaximize: (): void => ipcRenderer.send("facet:window-toggle-maximize"),
	/** 关闭窗口 */
	close: (): void => ipcRenderer.send("facet:window-close"),
	/** 订阅最大化状态，界面据此切换按钮图标；返回取消订阅的函数 */
	onWindowState: (listener: (maximized: boolean) => void): (() => void) => {
		const handler = (_event: unknown, maximized: boolean): void => listener(maximized);
		ipcRenderer.on("facet:window-state", handler);
		return () => {
			ipcRenderer.off("facet:window-state", handler);
		};
	},
	/** 默认打开的项目目录 */
	projectDir: readArgument("facet-project"),
	platform: readArgument("facet-platform") || process.platform,
	/** 应用版本，关于页展示用 */
	appVersion: readArgument("facet-version"),
	/** 当前窗口的界面缩放百分比，由主进程在创建窗口时写入 */
	uiScale: Number.parseInt(readArgument("facet-ui-scale"), 10) || 100,
	/** 设置界面缩放；主进程同步窗口 zoom 并写入本机设置 */
	setUiScale: (scale: number): void => ipcRenderer.send("facet:ui-scale", scale),
	/** 本机保存的语言设置，由主进程在创建窗口时写入 */
	languageSetting: (readArgument("facet-language-setting") || "auto") as LanguageSetting,
	/** 主进程解析后的实际语言，首帧直接用它 */
	language: (readArgument("facet-language") || "en") as SupportedLanguage,
	/** 修改语言；主进程按本机设置解析并返回实际语言 */
	setLanguage: async (setting: LanguageSetting): Promise<SupportedLanguage> => {
		return (await ipcRenderer.invoke("facet:language", setting)) as SupportedLanguage;
	},
	/** 启动时主进程注入的本机状态与分作用域存储快照 */
	localState: initialLocalState ?? {},
	/** 写入或删除本机持久化作用域键值 */
	setScopedStorage: (scope: string, key: string, value: string | null): void => {
		ipcRenderer.send("facet:storage-set", scope, key, value);
	},
	/** 保存本机优先的外观配置并同步窗口背景色 */
	setLocalAppearance: (appearance: AppearanceSettings): void => {
		ipcRenderer.send("facet:local-appearance", appearance);
	},
	/** 保存本机优先的输入偏好 */
	setLocalInput: (input: InputSettings): void => {
		ipcRenderer.send("facet:local-input", input);
	},
	/** 打开系统的目录选择窗口,取消时返回空 */
	pickDirectory: (): Promise<string | undefined> => ipcRenderer.invoke("facet:pick-directory"),
	/** 打开系统的选图窗口，取消时返回空数组；给了内容的图片以 base64 交回 */
	pickImages: (): Promise<readonly PickedImageFile[]> => ipcRenderer.invoke("facet:pick-images"),
	/** 用系统的保存窗口把一段文本写到文件,取消时返回 false */
	saveText: (suggestedName: string, text: string): Promise<boolean> =>
		ipcRenderer.invoke("facet:save-text", suggestedName, text),
	/** 弹一条系统通知；窗口在前台时主进程直接丢掉，返回 false */
	notify: (request: { file: string; body: string }): Promise<boolean> =>
		ipcRenderer.invoke("facet:notify", request) as Promise<boolean>,
	/** 订阅「点了某条系统通知」：参数是会话文件，界面据此切过去 */
	onNotifyClick: (listener: (file: string) => void): (() => void) => {
		const handler = (_event: unknown, file: string): void => listener(file);
		ipcRenderer.on("facet:notify-click", handler);
		return () => {
			ipcRenderer.off("facet:notify-click", handler);
		};
	},
	/** 右侧栏内嵌 `WebContentsView` 控制通道 */
	browser: {
		syncBounds: (bounds: { x: number; y: number; width: number; height: number; visible: boolean }): void =>
			ipcRenderer.send("facet:browser-bounds", bounds),
		navigate: (url: string): void => ipcRenderer.send("facet:browser-navigate", url),
		back: (): void => ipcRenderer.send("facet:browser-back"),
		forward: (): void => ipcRenderer.send("facet:browser-forward"),
		reload: (): void => ipcRenderer.send("facet:browser-reload"),
		stop: (): void => ipcRenderer.send("facet:browser-stop"),
		dispose: (): void => ipcRenderer.send("facet:browser-dispose"),
		openExternal: (url: string): void => ipcRenderer.send("facet:browser-open-external", url),
		onState: (
			listener: (state: {
				url: string;
				title: string;
				canGoBack: boolean;
				canGoForward: boolean;
				isLoading: boolean;
			}) => void,
		): (() => void) => {
			const handler = (
				_event: unknown,
				state: { url: string; title: string; canGoBack: boolean; canGoForward: boolean; isLoading: boolean },
			): void => listener(state);
			ipcRenderer.on("facet:browser-state", handler);
			return () => {
				ipcRenderer.off("facet:browser-state", handler);
			};
		},
	},
};

contextBridge.exposeInMainWorld("facet", api);

export type FacetApi = typeof api;
