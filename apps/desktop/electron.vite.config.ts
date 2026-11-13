import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/** 桌面应用的 package.json，依赖清单从它读 */
const PACKAGE = JSON.parse(readFileSync(fileURLToPath(new URL("package.json", import.meta.url)), "utf8")) as {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

/**
 * 主进程入口：桌面本体与嵌入主机的独立入口各一个。
 *
 * `pty-host` 是主机再往下起的终端子进程，必须单独产出一个文件：它在自己的进程里加载
 * node-pty，崩溃与大量输出都关在里面。
 */
const MAIN_ENTRIES = {
	index: fileURLToPath(new URL("src/main/index.ts", import.meta.url)),
	host: fileURLToPath(new URL("../../apps/server/src/main.ts", import.meta.url)),
	"pty-host": fileURLToPath(new URL("../../apps/server/src/pty-host-child.ts", import.meta.url)),
};

/**
 * 工作区的包只有 TS 源码，必须打进主进程，否则运行时要现去解析 .ts 文件。
 * 这里按桌面应用的依赖里 `@facet/` 前缀取出，新增工作区依赖不用再改这份清单。
 * node_modules 里的实现保持外置：ws 由内嵌的主机用到，运行时从 node_modules 解析，
 * 避免把它自带的可选原生依赖打进包里。
 */
const WORKSPACE_PACKAGES = Object.keys({ ...PACKAGE.dependencies, ...PACKAGE.devDependencies }).filter(
	(name) => name.startsWith("@facet/"),
);

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
		build: {
			rollupOptions: {
				input: MAIN_ENTRIES,
				output: { entryFileNames: "[name].js" },
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				output: {
					format: "cjs",
					entryFileNames: "[name].cjs",
				},
			},
		},
	},
	renderer: {
		plugins: [react()],
	},
});
