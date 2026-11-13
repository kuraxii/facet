import type { ClientEntry } from "@facet/protocol";
import { contextBridge, ipcRenderer } from "electron";

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
	/** 打开系统的目录选择窗口,取消时返回空 */
	pickDirectory: (): Promise<string | undefined> => ipcRenderer.invoke("facet:pick-directory"),
	/** 用系统的保存窗口把一段文本写到文件,取消时返回 false */
	saveText: (suggestedName: string, text: string): Promise<boolean> =>
		ipcRenderer.invoke("facet:save-text", suggestedName, text),
};

contextBridge.exposeInMainWorld("facet", api);

export type FacetApi = typeof api;
