import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import {
	findRunningHost,
	HostDaemon,
	type HostDiscovery,
	resolveDataDir,
	stopDiscoveredHost,
} from "./host-daemon.ts";
import { countBusySessions } from "./host-query.ts";
import {
	DEFAULT_WINDOW_HEIGHT,
	DEFAULT_WINDOW_WIDTH,
	type HostPrefs,
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

/** 开发时主机的固定端口，与 `npm run dev:host`、`dev:split` 用的是同一个。 */
const DEV_HOST_PORT = process.env.FACET_PORT?.trim() || "4319";

/**
 * 外部主机端点。
 *
 * 开发时缺省连到本机固定的那个端口，主机用 `npm run dev:host` 单独起；给出 FACET_ENDPOINT
 * 时连它；打包运行不给时由主进程拉起嵌入主机。开发时想跑嵌入模式用 FACET_EMBEDDED=1。
 */
const externalEndpoint =
	process.env.FACET_ENDPOINT?.trim() ||
	(isDev && process.env.FACET_EMBEDDED !== "1" ? `ws://127.0.0.1:${DEV_HOST_PORT}/endpoint` : undefined);

/** 等待主机就绪的上限，超时照样开窗口，界面会显示连不上并允许重试。 */
const READY_WAIT_MS = 20_000;

/** 主机数据目录，发现文件与主机日志都在这里 */
const dataDir = resolveDataDir(process.env);

let endpoint = externalEndpoint ?? "";
let host: HostDaemon | undefined;
let localSettingsFile = "";
let localSettings: LocalSettings = { version: 1 };
/** 退出确认已通过，之后的关闭与退出不再询问 */
let quitConfirmed = false;
/** 正在确认退出，避免关闭事件与 before-quit 各弹一次对话框 */
let quitting = false;

/** 等待主机就绪的兑现函数，就绪或超时时清掉。 */
let resolveReady: ((info: HostDiscovery | undefined) => void) | undefined;

/** 本机主机的开关，缺省关窗后继续运行 */
function hostPrefs(): HostPrefs {
	return localSettings.host ?? { keepOnClose: true };
}

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

/**
 * 真正退出。
 *
 * 关掉窗口后继续运行时主机留在后台，下次启动按发现文件接上；否则先请主机收尾再退出，
 * 不能只发一个不等的请求——进程先没了，主机就留了下来。
 */
async function finishQuit(window: BrowserWindow | undefined): Promise<void> {
	if (window !== undefined && !window.isDestroyed()) {
		saveWindowBounds(window);
	}
	if (!hostPrefs().keepOnClose) {
		await stopDiscoveredHost(dataDir);
	}
	quitConfirmed = true;
	app.exit(0);
}

/** 退出前确认：有正在跑的会话时问一句，别把任务带走。 */
async function confirmQuit(window: BrowserWindow | undefined): Promise<boolean> {
	if (endpoint.length === 0) {
		return true;
	}
	const busy = await countBusySessions(endpoint);
	if (busy === 0) {
		return true;
	}
	const keepsRunning = hostPrefs().keepOnClose;
	const options = {
		type: "warning",
		buttons: ["取消", keepsRunning ? "关闭窗口" : "仍然退出"],
		defaultId: 0,
		cancelId: 0,
		message: "有会话还在运行",
		detail: keepsRunning
			? `${busy} 个会话上有任务正在运行。关闭窗口后主机继续在后台运行，任务不受影响，下次打开应用回到这里。`
			: `退出会终止 ${busy} 个会话上正在进行的任务。`,
	} as const;
	const choice =
		window === undefined
			? dialog.showMessageBoxSync({ ...options, buttons: [...options.buttons] })
			: dialog.showMessageBoxSync(window, { ...options, buttons: [...options.buttons] });
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
				`--facet-host-mode=${externalEndpoint === undefined ? "local" : "external"}`,
				`--facet-keep-host=${hostPrefs().keepOnClose ? "1" : "0"}`,
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
			await finishQuit(window);
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
async function waitForHostReady(): Promise<HostDiscovery | undefined> {
	if (host === undefined) {
		return undefined;
	}
	return new Promise<HostDiscovery | undefined>((resolve) => {
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

ipcMain.handle("facet:host-prefs", () => hostPrefs());

ipcMain.handle("facet:stop-host", async () => {
	// 用户主动结束主机：本进程拉起的那台不再自动重启，上一次留下的那台按发现文件结束
	if (host !== undefined) {
		await host.stop();
		return;
	}
	await stopDiscoveredHost(dataDir);
});

ipcMain.handle("facet:set-host-prefs", async (_event, patch: unknown) => {
	const next: HostPrefs = {
		keepOnClose: (patch as HostPrefs | undefined)?.keepOnClose !== false,
	};
	localSettings = { ...localSettings, host: next };
	await writeLocalSettings(localSettingsFile, localSettings);
	return next;
});

app.whenReady().then(async () => {
	// 本地设置放在桌面自己的配置目录（Linux 上是 ~/.config/facet），与主机侧的应用设置分开
	localSettingsFile = join(app.getPath("userData"), "desktop.json");
	localSettings = await readLocalSettings(localSettingsFile);

	if (externalEndpoint === undefined) {
		await mkdir(dataDir, { recursive: true }).catch(() => undefined);
		// 上次留下的主机还在跑就直接接上，会话与运行中的任务都还在
		const running = await findRunningHost({ dataDir });
		if (running !== undefined) {
			endpoint = running.endpoint;
			console.log(`接上已在运行的主机 ${running.hostId} 监听 ${running.endpoint}`);
			resolveReady = undefined;
		} else {
			host = new HostDaemon({
				entry: join(app.getAppPath(), "out/main/host.js"),
				dataDir,
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
			});
			host.start();
			await waitForHostReady();
		}
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
		return;
	}
	const window = BrowserWindow.getAllWindows()[0];
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
		await finishQuit(window);
	})();
});
