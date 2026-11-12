import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import { HostProcess, type HostReadyInfo } from "./host-process.ts";
import { countBusySessions } from "./host-query.ts";
import {
	DEFAULT_WINDOW_HEIGHT,
	DEFAULT_WINDOW_WIDTH,
	type LocalSettings,
	readLocalSettings,
	type WindowBounds,
	writeLocalSettings,
} from "./local-settings.ts";

// 用户配置目录按应用名落到 facet 下；桌面包名带作用域，不改名会建出 @facet 这样的目录
app.setName("facet");

const isDev = !app.isPackaged;

/** 默认打开的项目目录,可用 FACET_PROJECT_DIR 覆盖 */
const projectDir = process.env.FACET_PROJECT_DIR?.trim() || process.cwd();

/**
 * 外部主机端点。
 *
 * 给出时桌面只当客户端连过去（开发时把主机单独跑起来调试）；不给时由主进程拉起嵌入主机。
 */
const externalEndpoint = process.env.FACET_ENDPOINT?.trim();

/** 嵌入模式下等待主机就绪的上限，超时照样开窗口，界面会显示连不上并允许重试。 */
const READY_WAIT_MS = 20_000;

let endpoint = externalEndpoint ?? "";
let host: HostProcess | undefined;
let localSettingsFile = "";
let localSettings: LocalSettings = { version: 1 };
/** 退出确认已通过，之后的关闭与退出不再询问 */
let quitConfirmed = false;
/** 正在确认退出，避免关闭事件与 before-quit 各弹一次对话框 */
let quitting = false;

/** 等待主机就绪的兑现函数，就绪或超时时清掉。 */
let resolveReady: ((info: HostReadyInfo | undefined) => void) | undefined;

/**
 * 由窗口记录得到创建参数。
 *
 * 上次的位置可能已经在拔掉的显示器上，落在所有屏幕之外时只给尺寸、让系统居中。
 */
function windowOptions(bounds: WindowBounds | undefined): {
	width: number;
	height: number;
	x?: number;
	y?: number;
} {
	if (bounds === undefined) {
		return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT };
	}
	const size = { width: bounds.width, height: bounds.height };
	if (bounds.x === undefined || bounds.y === undefined || !isOnScreen(bounds.x, bounds.y)) {
		return size;
	}
	return { ...size, x: bounds.x, y: bounds.y };
}

/** 这个位置是否落在某块屏幕的可见区域内。 */
function isOnScreen(x: number, y: number): boolean {
	return screen.getAllDisplays().some(({ workArea }) => {
		return (
			x >= workArea.x &&
			y >= workArea.y &&
			x < workArea.x + workArea.width &&
			y < workArea.y + workArea.height
		);
	});
}

/** 记下窗口位置与尺寸，关闭与退出时各存一次。 */
function saveWindowBounds(window: BrowserWindow): void {
	const isMaximized = window.isMaximized();
	// 最大化时记的是还原后的尺寸，否则再打开会一直停在最大化
	const bounds = isMaximized ? window.getNormalBounds() : window.getBounds();
	const next: LocalSettings = {
		version: 1,
		window: {
			width: bounds.width,
			height: bounds.height,
			x: bounds.x,
			y: bounds.y,
			maximized: isMaximized,
		},
	};
	localSettings = next;
	void writeLocalSettings(localSettingsFile, next).catch((error: unknown) => {
		console.log(`[main] 保存窗口尺寸失败 ${String(error)}`);
	});
}

/** 退出前确认：有正在跑的会话时问一句，别把任务带走。 */
async function confirmQuit(window: BrowserWindow): Promise<boolean> {
	if (endpoint.length === 0) {
		return true;
	}
	const busy = await countBusySessions(endpoint);
	if (busy === 0) {
		return true;
	}
	const choice = dialog.showMessageBoxSync(window, {
		type: "warning",
		buttons: ["取消", "仍然退出"],
		defaultId: 0,
		cancelId: 0,
		message: "有会话还在运行",
		detail: `退出会终止 ${busy} 个会话上正在进行的任务。`,
	});
	return choice === 1;
}

function createWindow(initialEndpoint: string): BrowserWindow {
	const window = new BrowserWindow({
		...windowOptions(localSettings.window),
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
				`--facet-endpoint=${initialEndpoint}`,
				`--facet-project=${projectDir}`,
				`--facet-platform=${process.platform}`,
				`--facet-version=${app.getVersion()}`,
			],
		},
	});

	window.once("ready-to-show", () => {
		if (localSettings.window?.maximized === true) {
			window.maximize();
		}
		window.show();
	});

	// 关闭时先确认有没有正在跑的会话，再记下窗口尺寸
	window.on("close", (event) => {
		if (quitConfirmed) {
			saveWindowBounds(window);
			return;
		}
		event.preventDefault();
		if (quitting) {
			return;
		}
		quitting = true;
		void (async () => {
			const allowed = await confirmQuit(window);
			quitting = false;
			if (!allowed) {
				return;
			}
			saveWindowBounds(window);
			quitConfirmed = true;
			app.quit();
		})();
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

/** 主机换成新端点，通知已开的窗口重连。 */
function broadcastEndpoint(next: string): void {
	endpoint = next;
	for (const window of BrowserWindow.getAllWindows()) {
		window.webContents.send("facet:endpoint-changed", next);
	}
}

/** 等嵌入主机就绪，超时返回 undefined。 */
async function waitForHostReady(): Promise<HostReadyInfo | undefined> {
	if (host === undefined) {
		return undefined;
	}
	return new Promise<HostReadyInfo | undefined>((resolve) => {
		const timer = setTimeout(() => {
			resolveReady = undefined;
			console.log("[main] 等待主机就绪超时，先打开窗口");
			resolve(undefined);
		}, READY_WAIT_MS);
		resolveReady = (info) => {
			clearTimeout(timer);
			resolveReady = undefined;
			resolve(info);
		};
	});
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
	// 本地设置放在桌面自己的配置目录（Linux 上是 ~/.config/facet），与主机侧的应用设置分开
	localSettingsFile = join(app.getPath("userData"), "desktop.json");
	localSettings = await readLocalSettings(localSettingsFile);

	if (externalEndpoint === undefined) {
		host = new HostProcess({
			entry: join(app.getAppPath(), "out/main/host.js"),
			// 开发启动打开主机侧调试日志，打包运行留给 FACET_DEBUG 手动开启
			env: isDev ? { FACET_DEBUG: "1" } : {},
			onReady: (info) => {
				console.log(`主机 ${info.hostId} 监听 ${info.endpoint}`);
				console.log(`数据目录 ${info.agentDir}`);
				if (endpoint.length === 0) {
					endpoint = info.endpoint;
					resolveReady?.(info);
					return;
				}
				broadcastEndpoint(info.endpoint);
			},
			onExit: (code, restarting) => {
				console.log(restarting ? `[main] 主机进程退出 ${code}，稍后重启` : `[main] 主机进程退出 ${code}`);
			},
			log: (line) => console.log(`[host] ${line}`),
			error: (line) => console.log(`[host:err] ${line}`),
		});
		host.start();
		await waitForHostReady();
	} else {
		console.log(`连接外部主机 ${externalEndpoint}`);
	}

	console.log(`项目目录 ${projectDir}`);
	console.log(`本地设置 ${localSettingsFile}`);
	createWindow(endpoint);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow(endpoint);
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
	if (quitConfirmed) {
		void host?.stop();
		return;
	}
	const window = BrowserWindow.getAllWindows()[0];
	if (window === undefined) {
		quitConfirmed = true;
		return;
	}
	event.preventDefault();
	if (quitting) {
		return;
	}
	quitting = true;
	void (async () => {
		const allowed = await confirmQuit(window);
		quitting = false;
		if (!allowed) {
			return;
		}
		saveWindowBounds(window);
		quitConfirmed = true;
		app.quit();
	})();
});
