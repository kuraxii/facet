import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import { addressOf, HostChannels, LOCAL_TARGET } from "./host-channel.ts";
import {
	findRunningHost,
	HostDaemon,
	type HostDiscovery,
	readDiscovery,
	resolveDataDir,
} from "./host-daemon.ts";
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

// 开发实例的配置目录跟着数据目录一起带 -dev 后缀，`desktop.json` 与发布实例分开
if (isDev) {
	app.setPath("userData", `${app.getPath("userData")}-dev`);
}

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

/** 主机数据目录，发现文件与主机日志都在这里；开发实例带 -dev 后缀，与发布实例分开 */
const dataDir = resolveDataDir(process.env, { isDev });

/** 本机当前连着的主机，界面通过主进程的通道访问它 */
let localHost: HostDiscovery | undefined;
let hostChannels: HostChannels | undefined;
let host: HostDaemon | undefined;
let localSettingsFile = "";
let localSettings: LocalSettings = { version: 1 };
/** 退出确认已通过，之后的关闭与退出不再询问 */
let quitConfirmed = false;
/** 正在确认退出，避免关闭事件与 before-quit 各弹一次对话框 */
let quitting = false;

/** 等待主机就绪的兑现函数，就绪或超时时清掉。 */
let resolveReady: ((info: HostDiscovery | undefined) => void) | undefined;

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

/** 记下窗口位置与尺寸，关闭与退出时各存一次。窗口已经销毁时直接跳过。 */
function saveWindowBounds(window: BrowserWindow): void {
	if (window.isDestroyed()) {
		return;
	}
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
 * 主机一直留在后台：桌面退出只是断开自己那条通道，会话与运行中的任务都不受影响，下次
 * 启动按发现文件接上。
 */
async function finishQuit(window: BrowserWindow | undefined): Promise<void> {
	if (window !== undefined && !window.isDestroyed()) {
		saveWindowBounds(window);
	}
	hostChannels?.dispose();
	quitConfirmed = true;
	app.exit(0);
}

/** 退出前确认：有正在跑的会话时问一句，别把任务带走。 */
async function confirmQuit(window: BrowserWindow | undefined): Promise<boolean> {
	const local = localHost;
	if (local === undefined) {
		return true;
	}
	const busy = await countBusySessions(local);
	if (busy === 0) {
		return true;
	}
	const options = {
		type: "warning",
		buttons: ["取消", "关闭窗口"],
		defaultId: 0,
		cancelId: 0,
		message: "有会话还在运行",
		detail: `${busy} 个会话上有任务正在运行。关闭窗口后主机继续在后台运行，任务不受影响，下次打开应用回到这里。`,
	} as const;
	const choice =
		window === undefined
			? dialog.showMessageBoxSync({ ...options, buttons: [...options.buttons] })
			: dialog.showMessageBoxSync(window, { ...options, buttons: [...options.buttons] });
	return choice === 1;
}

function createWindow(): BrowserWindow {
	const window = new BrowserWindow({
		...windowOptions(localSettings.window),
		minWidth: 640,
		minHeight: 480,
		show: false,
		autoHideMenuBar: true,
		backgroundColor: "#0c0c0d",
		title: "facet",
		// 标题栏由界面自己画：最小化、最大化、关闭三个按钮走 IPC，拖动区由 CSS 指定
		frame: false,
		titleBarStyle: "hidden",
		webPreferences: {
			preload: join(app.getAppPath(), "out/preload/index.cjs"),
			contextIsolation: true,
			sandbox: true,
			additionalArguments: [
				`--facet-host-mode=${externalEndpoint === undefined ? "local" : "external"}`,
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

	// 退出时 app.exit 会同步销毁窗口，`closed` 里再读 webContents 已经拿不到，先把 id 取出来
	const contentsId = window.webContents.id;
	window.on("closed", () => {
		hostChannels?.closeFor(contentsId);
	});

	// 最大化状态由主进程推给界面，界面据此在两个图标之间切换
	const pushWindowState = (): void => {
		if (!window.isDestroyed()) {
			window.webContents.send("facet:window-state", window.isMaximized());
		}
	};
	window.on("maximize", pushWindowState);
	window.on("unmaximize", pushWindowState);
	window.webContents.on("did-finish-load", pushWindowState);

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

/**
 * 本机主机换了新的一份（重启或重新拉起），通知已开的窗口重连。
 *
 * 新主机的端口与令牌都可能变，界面通过主进程的通道重新连，只需要知道「本机换了」。
 */
function broadcastLocalHost(): void {
	for (const window of BrowserWindow.getAllWindows()) {
		window.webContents.send("facet:host-changed");
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

/** 自绘标题栏的三个按钮：界面只管发指令，窗口动作留在主进程。 */
ipcMain.on("facet:window-minimize", (event) => {
	BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("facet:window-toggle-maximize", (event) => {
	const window = BrowserWindow.fromWebContents(event.sender);
	if (window === null) {
		return;
	}
	if (window.isMaximized()) {
		window.unmaximize();
	} else {
		window.maximize();
	}
});

ipcMain.on("facet:window-close", (event) => {
	BrowserWindow.fromWebContents(event.sender)?.close();
});

/** 本机主机的连接信息：界面只知道「本机」这个目标与展示地址，具体端口与令牌在主进程。 */
ipcMain.handle("facet:local-host", () => {
	const local = localHost;
	if (local === undefined) {
		return externalEndpoint === undefined
			? undefined
			: { target: externalEndpoint, address: externalEndpoint, token: undefined };
	}
	return {
		target: LOCAL_TARGET,
		address: addressOf(local),
		token: local.token,
	};
});

ipcMain.handle("facet:host-open", async (event, target: string) => {
	const channels = hostChannels;
	if (channels === undefined) {
		throw new Error("主机通道还没准备好");
	}
	return await channels.open(event.sender, target);
});

ipcMain.on("facet:host-write", (_event, id: number, text: string) => {
	hostChannels?.write(id, text);
});

ipcMain.on("facet:host-close", (_event, id: number) => {
	hostChannels?.close(id);
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
			localHost = running;
			console.log(`接上已在运行的主机 ${running.hostId} 监听 ${addressOf(running)}`);
			resolveReady = undefined;
		} else {
			host = new HostDaemon({
				entry: join(app.getAppPath(), "out/main/host.js"),
				dataDir,
				// 开发启动打开主机侧调试日志，打包运行留给 FACET_DEBUG 手动开启
				env: isDev ? { FACET_DEBUG: "1" } : {},
				onReady: (info) => {
					console.log(`主机 ${info.hostId} 监听 ${addressOf(info)}`);
					console.log(`数据目录 ${info.agentDir}`);
					localHost = info;
					if (resolveReady !== undefined) {
						resolveReady(info);
						return;
					}
					// 已经是第二份主机：界面按新的发现记录重连
					broadcastLocalHost();
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
		// 开发时主机也写发现文件：地址对上就按它连，能拿到令牌
		const discovered = await findRunningHost({ dataDir }).catch(() => undefined);
		if (discovered !== undefined && addressOf(discovered).includes(externalEndpoint)) {
			localHost = discovered;
			console.log(`外部主机与发现文件一致，按发现文件连 ${addressOf(discovered)}`);
		}
	}

	// 界面不直连主机：主进程按目标建通道，本机按发现记录，远程按 host:port
	hostChannels = new HostChannels(async (target) => {
		if (target === LOCAL_TARGET) {
			// 每次都读最新的发现文件：主机重启后端口与令牌都会变，缓存的那份会连不上
			const fresh = await readDiscovery(dataDir).catch(() => undefined);
			if (fresh !== undefined) {
				return fresh;
			}
			if (localHost !== undefined) {
				return localHost;
			}
			const matched = externalEndpoint === undefined ? null : /^([^:]+):(\d+)$/.exec(externalEndpoint);
			return matched === null || matched === undefined
				? undefined
				: { host: matched[1] as string, port: Number(matched[2]) };
		}
		const matched = /^([^:]+):(\d+)$/.exec(target);
		if (matched === null) {
			return undefined;
		}
		return { host: matched[1] as string, port: Number(matched[2]) };
	});

	console.log(`项目目录 ${projectDir}`);
	console.log(`本地设置 ${localSettingsFile}`);
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
