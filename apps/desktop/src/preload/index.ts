import { contextBridge } from "electron";

/** 从主进程传进来的启动参数,预加载脚本读命令行拿到后再交给界面 */
function readArgument(name: string): string {
	const prefix = `--${name}=`;
	const found = process.argv.find((argument) => argument.startsWith(prefix));
	return found === undefined ? "" : found.slice(prefix.length);
}

const api = {
	/** 设备端点地址 */
	endpoint: readArgument("facet-endpoint"),
	/** 默认打开的项目目录 */
	projectDir: readArgument("facet-project"),
	platform: readArgument("facet-platform") || process.platform,
};

contextBridge.exposeInMainWorld("facet", api);

export type FacetApi = typeof api;
