import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * facet 自己的包只有 TS 源码，必须打进主进程；node_modules 里的实现保持外置。
 * ws 由内嵌的主机用到，因此列进桌面应用的依赖，运行时从 node_modules 解析，
 * 避免把它自带的可选原生依赖打进包里。
 */
const WORKSPACE_PACKAGES = [
	"@facet/agent",
	"@facet/client-core",
	"@facet/protocol",
	"@facet/server",
	"@facet/services",
];

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
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
