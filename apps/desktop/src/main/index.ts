import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { DEFAULT_AGENT_DIR, DEV_AGENT_DIR } from "@facet/agent";
import { createI18n, readLanguageSetting, resolveLanguage, translate } from "@facet/i18n";
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import { HostChannels, LOCAL_TARGET } from "./host-channel.ts";
import {
	findRunningHost,
	HostDaemon,
	hostSocketPath,
	type LocalHost,
	readDiscovery,
	resolveDataDir,
} from "./host-daemon.ts";
import { countBusySessions } from "./host-query.ts";
import {
	DEFAULT_UI_SCALE,
	DEFAULT_WINDOW_HEIGHT,
	DEFAULT_WINDOW_WIDTH,
	type LocalSettings,
	readLocalSettings,
	readUiScale,
	type WindowBounds,
	writeLocalSettings,
} from "./local-settings.ts";
import { SshHostError } from "./ssh-host.ts";

// 用户配置目录按应用名落到 facet 下；桌面包名带作用域，不改名会建出 @facet 这样的目录
app.setName("facet");

const isDev = !app.isPackaged;

// 开发实例的配置目录跟着数据目录一起带 -dev 后缀，`desktop.json` 与发布实例分开
if (isDev) {
	app.setPath("userData", `${app.getPath("userData")}-dev`);
}

/** 默认打开的项目目录,可用 FACET_PROJECT_DIR 覆盖 */
const projectDir = process.env.FACET_PROJECT_DIR?.trim() || process.cwd();

/**
 * 外部主机端点。
 *
 * 只有给出 `FACET_ENDPOINT` 时才连别处的主机。不给就按本机处理：数据目录里有本机的发现
 * 文件就接上（`npm run dev:host` 起的主机也是这个入口），没有就由主进程拉起一个。开发与
 * 打包走同一条路，差别只在数据目录带 `-dev` 后缀。
 */
const externalEndpoint = process.env.FACET_ENDPOINT?.trim() || undefined;

/** 等待主机就绪的上限，超时照样开窗口，界面会显示连不上并允许重试。 */
const READY_WAIT_MS = 20_000;

/** 主机数据目录，发现文件与主机日志都在这里；开发实例带 -dev 后缀，与发布实例分开 */
const dataDir = resolveDataDir(process.env, { isDev });

/** 本机 pi 数据目录：发布版与 pi 共用，开发态用独立的 agent-dev */
const agentDir = process.env.FACET_AGENT_DIR?.trim() || (isDev ? DEV_AGENT_DIR : DEFAULT_AGENT_DIR);

/** server 怎么起：用独立产物里自带的 Node；没有产物时为空，界面会显示连不上并能重试 */
const hostLaunch = resolveHostLaunch();

/** 本机当前连着的主机，界面通过主进程的通道访问它 */
let localHost: LocalHost | undefined;
let hostChannels: HostChannels | undefined;
let host: HostDaemon | undefined;
let localSettingsFile = "";
let localSettings: LocalSettings = { version: 1 };
/** 主进程侧的语言实例，原生弹窗与渲染进程共用同一份资源 */
let mainI18n = createI18n("en");
/** 主进程侧的轻量翻译函数，语言实例更换时一起重建 */
let mainT = translate(mainI18n);
/** 退出确认已通过，之后的关闭与退出不再询问 */
let quitConfirmed = false;
/** 正在确认退出，避免关闭事件与 before-quit 各弹一次对话框 */
let quitting = false;

/** 等待主机就绪的兑现函数，就绪或超时时清掉。 */
let resolveReady: ((info: LocalHost | undefined) => void) | undefined;

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
		...(localSettings.uiScale === undefined ? {} : { uiScale: localSettings.uiScale }),
		...(localSettings.language === undefined ? {} : { language: localSettings.language }),
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
		console.log(`[main] Failed to save window bounds: ${String(error)}`);
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
		buttons: [mainT("dialog.quit.cancel"), mainT("dialog.quit.close")],
		defaultId: 0,
		cancelId: 0,
		message: mainT("dialog.quit.title"),
		detail: mainT("dialog.quit.detail", { count: busy }),
	} as const;
	const choice =
		window === undefined
			? dialog.showMessageBoxSync({ ...options, buttons: [...options.buttons] })
			: dialog.showMessageBoxSync(window, { ...options, buttons: [...options.buttons] });
	return choice === 1;
}

function createWindow(): BrowserWindow {
	const uiScale = localSettings.uiScale ?? DEFAULT_UI_SCALE;
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
			zoomFactor: uiScale / 100,
			additionalArguments: [
				`--facet-host-mode=${externalEndpoint === undefined ? "local" : "external"}`,
				`--facet-project=${projectDir}`,
				`--facet-platform=${process.platform}`,
				`--facet-version=${app.getVersion()}`,
				`--facet-ui-scale=${uiScale}`,
				`--facet-language-setting=${localSettings.language ?? "auto"}`,
				`--facet-language=${mainI18n.language}`,
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
			console.log(`[renderer] Failed to load ${code} ${description} ${url}`);
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
async function waitForHostReady(): Promise<LocalHost | undefined> {
	if (host === undefined) {
		return undefined;
	}
	return new Promise<LocalHost | undefined>((resolve) => {
		const timer = setTimeout(() => {
			resolveReady = undefined;
			console.log("[main] Timed out waiting for the host; opening the window first");
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
		title: mainT("dialog.pickDirectory.title"),
		properties: ["openDirectory", "createDirectory"],
	} as const;
	const result = window
		? await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
		: await dialog.showOpenDialog({ ...options, properties: [...options.properties] });
	return result.canceled ? undefined : result.filePaths[0];
});

/** 选图窗口接受的扩展名。只做光栅图，矢量图与动图之外的格式交给会话自己判断。 */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

/** 扩展名到媒体类型。选中的文件可能没有正确扩展名，这里只按扩展名给。 */
const IMAGE_MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

/** 一张选中的图片。字节以 base64 交给界面，界面侧不必再碰文件系统。 */
interface PickedImage {
	name: string;
	mimeType: string;
	data: string;
	byteSize: number;
}

ipcMain.handle("facet:pick-images", async (event): Promise<PickedImage[]> => {
	const window = BrowserWindow.fromWebContents(event.sender);
	const options = {
		title: mainT("dialog.pickImages.title"),
		properties: ["openFile", "multiSelections"] as const,
		filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
	};
	const mutable = { ...options, properties: [...options.properties] };
	const result = window ? await dialog.showOpenDialog(window, mutable) : await dialog.showOpenDialog(mutable);
	if (result.canceled) {
		return [];
	}
	const picked: PickedImage[] = [];
	for (const path of result.filePaths) {
		const mimeType = IMAGE_MIME_TYPES[extname(path).slice(1).toLowerCase()];
		if (mimeType === undefined) {
			continue;
		}
		// 读之前先看大小：整张图要经 IPC 传成 base64，几十兆的文件不该往这条路上塞
		const info = await stat(path);
		if (!info.isFile()) {
			continue;
		}
		const bytes = await readFile(path);
		picked.push({
			name: basename(path),
			mimeType,
			data: bytes.toString("base64"),
			byteSize: info.size,
		});
	}
	return picked;
});

ipcMain.handle("facet:save-text", async (event, suggestedName: string, text: string) => {
	const window = BrowserWindow.fromWebContents(event.sender);
	const options = {
		title: mainT("dialog.saveFile.title"),
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

/** 界面缩放只改当前窗口，同时记进本机桌面设置。 */
ipcMain.on("facet:ui-scale", (event, value: unknown) => {
	const window = BrowserWindow.fromWebContents(event.sender);
	if (window === null || window.isDestroyed()) {
		return;
	}
	const uiScale = readUiScale(value) ?? DEFAULT_UI_SCALE;
	window.webContents.setZoomFactor(uiScale / 100);
	localSettings = { ...localSettings, uiScale };
	void writeLocalSettings(localSettingsFile, localSettings).catch((error: unknown) => {
		console.log(`[main] Failed to save interface scale: ${String(error)}`);
	});
});

/** 切换界面语言；用户选择写进本机设置，系统语言与自动识别的结果由主进程返回。 */
ipcMain.handle("facet:language", async (_event, value: unknown) => {
	const setting = readLanguageSetting(value) ?? "auto";
	localSettings = { ...localSettings, language: setting };
	await writeLocalSettings(localSettingsFile, localSettings);
	const language = resolveLanguage(setting, app.getLocale());
	await mainI18n.changeLanguage(language);
	return language;
});

/** 本机主机的连接信息：界面只知道「本机」这个目标与展示地址，具体端口与令牌在主进程。 */
ipcMain.handle("facet:local-host", () => {
	if (externalEndpoint !== undefined) {
		return { target: externalEndpoint, address: externalEndpoint, token: undefined };
	}
	// 本机是固定路径上的 unix socket：身份由文件权限保证，界面不需要令牌
	return {
		target: LOCAL_TARGET,
		address: hostSocketPath(dataDir),
		token: undefined,
	};
});

/**
 * 这一轮运行里问过的 SSH 密码。
 *
 * 只放在主进程内存里，退出即丢：认证过一次之后重连不必再问，也不把密码写进任何清单。
 */
const sshPasswords = new Map<string, string>();

ipcMain.handle("facet:host-open", async (event, target: string, password?: string) => {
	const channels = hostChannels;
	if (channels === undefined) {
		return { ok: false, code: "not_ready", message: mainT("host.notReady") };
	}
	const secret = password ?? sshPasswords.get(target);
	try {
		const opened = await channels.open(event.sender, target, secret);
		if (password !== undefined && password.length > 0) {
			sshPasswords.set(target, password);
		}
		return { ok: true, ...opened };
	} catch (error) {
		return {
			ok: false,
			code: error instanceof SshHostError ? error.code : "connect_failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
});

ipcMain.on("facet:host-write", (_event, id: number, text: string) => {
	hostChannels?.write(id, text);
});

ipcMain.on("facet:host-close", (_event, id: number) => {
	hostChannels?.close(id);
});

/**
 * server 的启动方式。
 *
 * 打包后是随包的独立产物 `resources/server`，开发时是同一份产物的构建结果
 * `apps/desktop/dist-server`。两边都用官方 Node 跑 `lib/server.mjs`：原生模块（`node-pty`）
 * 只针对 Node ABI 构建一次，不必再为 Electron 的 ABI 编一遍。
 *
 * 开发态没打过产物时直接报错，而不是悄悄换成别的运行时——那会把两种 ABI 混在一起。
 */
function resolveHostLaunch(): { command: string; args: string[]; env: NodeJS.ProcessEnv } | undefined {
	const bundled = app.isPackaged
		? join(process.resourcesPath, "server")
		: join(app.getAppPath(), "dist-server");
	const node = join(bundled, "bin", "node");
	if (!existsSync(node)) {
		console.error(`Cannot find the server build: ${bundled}. Run npm run build:server first.`);
		return undefined;
	}
	return { command: node, args: [join(bundled, "lib", "server.mjs")], env: {} };
}

/** `host:port` 写法拆成 TCP 目标，拆不出来时返回 undefined。 */
function parseTcpTarget(text: string): { host: string; port: number } | undefined {
	const matched = /^([^:]+):(\d+)$/.exec(text);
	return matched === null ? undefined : { host: matched[1] as string, port: Number(matched[2]) };
}

app.whenReady().then(async () => {
	// 本地设置放在桌面自己的配置目录（Linux 上是 ~/.config/facet），与主机侧的应用设置分开
	localSettingsFile = join(app.getPath("userData"), "desktop.json");
	localSettings = await readLocalSettings(localSettingsFile);
	mainI18n = createI18n(resolveLanguage(localSettings.language, app.getLocale()));
	mainT = translate(mainI18n);

	if (externalEndpoint === undefined) {
		await mkdir(dataDir, { recursive: true }).catch(() => undefined);
		// 上次留下的主机还在跑就直接接上，会话与运行中的任务都还在
		const running = await findRunningHost({ dataDir });
		if (running !== undefined) {
			localHost = running;
			const info = await readDiscovery(dataDir).catch(() => undefined);
			console.log(`Connected to running host ${info?.hostId ?? "?"} at ${running.path}`);
			resolveReady = undefined;
		} else if (hostLaunch === undefined) {
			console.error("No server build is available; skipping startup");
		} else {
			host = new HostDaemon({
				...hostLaunch,
				dataDir,
				// 开发启动打开主机侧调试日志，打包运行留给 FACET_DEBUG 手动开启
				env: {
					...hostLaunch.env,
					FACET_AGENT_DIR: agentDir,
					...(isDev ? { FACET_DEBUG: "1" } : {}),
					// 开发态自己拉起的 server 跟着桌面一起退，免得留下一堆进程；打包后由主机自己管生命周期
					...(isDev ? { FACET_PARENT_PID: String(process.pid) } : {}),
				},
				onReady: (info) => {
					localHost = info;
					// 发现文件只用于日志：主机标识与 pi 数据目录在那里，不参与连接
					void readDiscovery(dataDir).then((record) => {
						console.log(`Host ${record?.hostId ?? "?"} listening at ${info.path}`);
						console.log(`Data directory ${record?.agentDir ?? "unknown"}`);
					});
					if (resolveReady !== undefined) {
						resolveReady(info);
						return;
					}
					// 已经是第二份主机：界面按新的发现记录重连
					broadcastLocalHost();
				},
				onExit: (code, restarting) => {
					console.log(
						restarting
							? `[main] Host process exited with ${code}; restarting shortly`
							: `[main] Host process exited with ${code}`,
					);
				},
				log: (line) => console.log(`[host] ${line}`),
			});
			host.start();
			await waitForHostReady();
		}
	} else {
		console.log(`Connecting to external host ${externalEndpoint}`);
	}

	// 界面不直连主机：主进程按目标建通道，本机走固定 socket，远程按 host:port
	hostChannels = new HostChannels(async (target) => {
		if (target === LOCAL_TARGET) {
			return externalEndpoint === undefined
				? { path: hostSocketPath(dataDir) }
				: parseTcpTarget(externalEndpoint);
		}
		return parseTcpTarget(target);
	});

	console.log(`Project directory ${projectDir}`);
	console.log(`Local settings ${localSettingsFile}`);
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
