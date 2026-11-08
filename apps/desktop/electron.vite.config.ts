import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		// facet 自己的包是 TS 源码，必须一起打包；node_modules 里的实现保持外置
		plugins: [
			externalizeDepsPlugin({
				exclude: ["@facet/agent", "@facet/protocol", "@facet/server", "@facet/services"],
			}),
		],
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
