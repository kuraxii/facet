import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ServerHandle, startServer } from "@facet/server";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

const isDev = !app.isPackaged;

/** `npm run dev` 启动时 electron-vite 会给出渲染进程地址，用它区分开发启动与打包运行 */
const isDevServer = isDev && process.env.ELECTRON_RENDERER_URL !== undefined;

/** 默认打开的项目目录,可用 FACET_PROJECT_DIR 覆盖 */
const projectDir = process.env.FACET_PROJECT_DIR?.trim() || process.cwd();

let server: ServerHandle | undefined;

/** 上次退出时的窗口位置与尺寸，没有记录时用应用默认值。 */
function windowBounds(): { width: number; height: number; x?: number; y?: number } {
	const saved = server?.settingsStore.get().window;
	if (saved === undefined) {
		return { width: 1100, height: 760 };
	}
	return {
		width: saved.width,
		height: saved.height,
		...(saved.x === undefined ? {} : { x: saved.x }),
		...(saved.y === undefined ? {} : { y: saved.y }),
	};
}

/** 记下窗口位置与尺寸，退出与关闭时各存一次。 */
function saveWindowBounds(window: BrowserWindow): void {
	const store = server?.settingsStore;
	if (store === undefined) {
		return;
	}
	const isMaximized = window.isMaximized();
	// 最大化时记的是还原后的尺寸，否则再打开会一直停在最大化
	const bounds = isMaximized ? window.getNormalBounds() : window.getBounds();
	const current = store.get();
	void store
		.save({
			...current,
			window: {
				width: bounds.width,
				height: bounds.height,
				x: bounds.x,
				y: bounds.y,
				maximized: isMaximized,
			},
		})
		.catch((error: unknown) => {
			console.log(`[main] 保存窗口尺寸失败 ${String(error)}`);
		});
}

function createWindow(endpoint: string): BrowserWindow {
	const saved = server?.settingsStore.get().window;
	const window = new BrowserWindow({
		...windowBounds(),
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
				`--facet-version=${app.getVersion()}`,
			],
		},
	});

	window.once("ready-to-show", () => {
		if (saved?.maximized === true) {
			window.maximize();
		}
		window.show();
	});

	// 关闭时先确认有没有正在跑的会话，再记下窗口尺寸
	window.on("close", (event) => {
		const busy = server?.hub.busyFiles() ?? [];
		if (busy.length > 0) {
			const choice = dialog.showMessageBoxSync(window, {
				type: "warning",
				buttons: ["取消", "仍然退出"],
				defaultId: 0,
				cancelId: 0,
				message: "有会话还在运行",
				detail: `退出会终止 ${busy.length} 个会话上正在进行的任务。`,
			});
			if (choice === 0) {
				event.preventDefault();
				return;
			}
		}
		saveWindowBounds(window);
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

ipcMain.handle("facet:save-text", async (event, suggestedName: string, text: string) => {
	const window = BrowserWindow.fromWebContents(event.sender);
	const options = {
		title: "保存文件",
		defaultPath: suggestedName,
	};
	const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
	if (result.canceled || result.filePath === undefined) {
		return false;
	}
	await writeFile(result.filePath, text, "utf8");
	return true;
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
	const window = BrowserWindow.getAllWindows()[0];
	if (window !== undefined) {
		saveWindowBounds(window);
	}
	void server?.close();
	server = undefined;
});
