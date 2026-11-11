import { join } from "node:path";
import { type ServerHandle, startServer } from "@facet/server";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

const isDev = !app.isPackaged;

/** `npm run dev` 启动时 electron-vite 会给出渲染进程地址，用它区分开发启动与打包运行 */
const isDevServer = isDev && process.env.ELECTRON_RENDERER_URL !== undefined;

/** 默认打开的项目目录,可用 FACET_PROJECT_DIR 覆盖 */
const projectDir = process.env.FACET_PROJECT_DIR?.trim() || process.cwd();

let server: ServerHandle | undefined;

function createWindow(endpoint: string): BrowserWindow {
	const window = new BrowserWindow({
		width: 1100,
		height: 760,
		minWidth: 640,
		minHeight: 480,
		show: false,
		autoHideMenuBar: true,
		backgroundColor: "#0c0c0d",
		title: "facet",
		webPreferences: {
			preload: join(app.getAppPath(), "out/preload/index.cjs"),
			contextIsolation: true,
			sandbox: true,
			additionalArguments: [
				`--facet-endpoint=${endpoint}`,
				`--facet-project=${projectDir}`,
				`--facet-platform=${process.platform}`,
			],
		},
	});

	window.once("ready-to-show", () => {
		window.show();
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	if (isDev) {
		// 渲染进程的日志默认只在开发者工具里,开发时转一分到终端便于排查
		window.webContents.on("console-message", (event) => {
			const message = (event as unknown as { message?: unknown }).message;
			if (typeof message === "string") {
				console.log(`[renderer] ${message}`);
			}
		});
		window.webContents.on("did-fail-load", (_event, code, description, url) => {
			console.log(`[renderer] 加载失败 ${code} ${description} ${url}`);
		});
	}

	const rendererUrl = process.env.ELECTRON_RENDERER_URL;
	if (isDev && rendererUrl) {
		void window.loadURL(rendererUrl);
	} else {
		void window.loadFile(join(app.getAppPath(), "out/renderer/index.html"));
	}

	return window;
}

ipcMain.handle("facet:pick-directory", async (event) => {
	const window = BrowserWindow.fromWebContents(event.sender);
	const options = {
		title: "选择项目文件夹",
		properties: ["openDirectory", "createDirectory"],
	} as const;
	const result = window
		? await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
		: await dialog.showOpenDialog({ ...options, properties: [...options.properties] });
	return result.canceled ? undefined : result.filePaths[0];
});

app.whenReady().then(async () => {
	server = await startServer({ port: 0, host: "127.0.0.1", debug: isDevServer });
	const endpoint = `ws://${server.host}:${server.port}/endpoint`;
	console.log(`设备 ${server.hostId} 监听 ${endpoint}`);
	console.log(`数据目录 ${server.agentDir}`);
	console.log(`项目目录 ${projectDir}`);

	createWindow(endpoint);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow(endpoint);
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	void server?.close();
	server = undefined;
});
