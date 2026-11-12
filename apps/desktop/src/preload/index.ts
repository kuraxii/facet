import { contextBridge, ipcRenderer } from "electron";

/** 从主进程传进来的启动参数,预加载脚本读命令行拿到后再交给界面 */
function readArgument(name: string): string {
	const prefix = `--${name}=`;
	const found = process.argv.find((argument) => argument.startsWith(prefix));
	return found === undefined ? "" : found.slice(prefix.length);
}

const api = {
	/** 主机端点地址 */
	endpoint: readArgument("facet-endpoint"),
	/** 主机是本机管的（local），还是外面跑着、这里只当客户端（external） */
	hostMode: readArgument("facet-host-mode") || "local",
	/** 关掉窗口后本机主机是否继续运行，来自桌面本地设置 */
	keepHostOnClose: readArgument("facet-keep-host") !== "0",
	/** 读本机主机的开关 */
	getHostPrefs: (): Promise<{ keepOnClose: boolean }> => ipcRenderer.invoke("facet:host-prefs"),
	/** 结束本机主机，之后不再自动重启 */
	stopHost: (): Promise<void> => ipcRenderer.invoke("facet:stop-host"),
	/** 改本机主机的开关，返回保存后的值 */
	setHostPrefs: (prefs: { keepOnClose: boolean }): Promise<{ keepOnClose: boolean }> =>
		ipcRenderer.invoke("facet:set-host-prefs", prefs),
	/** 默认打开的项目目录 */
	projectDir: readArgument("facet-project"),
	platform: readArgument("facet-platform") || process.platform,
	/** 应用版本，关于页展示用 */
	appVersion: readArgument("facet-version"),
	/**
	 * 订阅主机端点变化。
	 *
	 * 嵌入主机被重新拉起后端口会变，界面收到新地址要重新握手。返回值用于取消订阅。
	 */
	onEndpointChanged: (listener: (endpoint: string) => void): (() => void) => {
		const handler = (_event: unknown, next: string): void => listener(next);
		ipcRenderer.on("facet:endpoint-changed", handler);
		return () => {
			ipcRenderer.off("facet:endpoint-changed", handler);
		};
	},
	/** 打开系统的目录选择窗口,取消时返回空 */
	pickDirectory: (): Promise<string | undefined> => ipcRenderer.invoke("facet:pick-directory"),
	/** 用系统的保存窗口把一段文本写到文件,取消时返回 false */
	saveText: (suggestedName: string, text: string): Promise<boolean> =>
		ipcRenderer.invoke("facet:save-text", suggestedName, text),
};

contextBridge.exposeInMainWorld("facet", api);

export type FacetApi = typeof api;
