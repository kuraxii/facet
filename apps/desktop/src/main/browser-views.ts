/**
 * 主进程侧栏内嵌浏览器的 `WebContentsView` 管理器。
 *
 * 按主窗口 `webContents.id` 懒创建并复用单份 `WebContentsView`：
 * - 切到其他右栏标签或弹窗遮挡时只隐藏（保留页面滚动与登录态）；
 * - 关闭 browser 标签或主窗口销毁时彻底销毁释放 Chromium 进程；
 * - 仅允许 `http:` / `https:` / `about:blank`，隔离到独立持久化分区且不注入任何预加载桥。
 */
import { BrowserWindow, ipcMain, shell, WebContentsView } from "electron";

/** 推给渲染层地址栏的状态快照。 */
export interface MainBrowserViewState {
	/** 当前 URL */
	url: string;
	/** 页面标题 */
	title: string;
	/** 是否可后退 */
	canGoBack: boolean;
	/** 是否可前进 */
	canGoForward: boolean;
	/** 是否加载中 */
	isLoading: boolean;
}

/** 渲染层同步过来的右侧栏占位区坐标（DIP）。 */
export interface MainBrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	visible: boolean;
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

function isSafeBrowserUrl(raw: unknown): raw is string {
	if (typeof raw !== "string") {
		return false;
	}
	if (raw === "about:blank") {
		return true;
	}
	try {
		const parsed = new URL(raw);
		return ALLOWED_SCHEMES.has(parsed.protocol);
	} catch {
		return false;
	}
}

function readState(view: WebContentsView): MainBrowserViewState {
	const wc = view.webContents;
	const nav = wc.navigationHistory;
	return {
		url: wc.getURL() || "about:blank",
		title: wc.getTitle(),
		canGoBack: nav.canGoBack(),
		canGoForward: nav.canGoForward(),
		isLoading: wc.isLoadingMainFrame(),
	};
}

export class BrowserViewRegistry {
	private readonly views = new Map<number, WebContentsView>();

	/** 为主窗口获取或懒创建 `WebContentsView`，并订阅导航事件回推渲染层。 */
	private ensure(window: BrowserWindow): WebContentsView {
		const key = window.webContents.id;
		const existing = this.views.get(key);
		if (existing !== undefined && !existing.webContents.isDestroyed()) {
			return existing;
		}
		const view = new WebContentsView({
			webPreferences: {
				partition: "persist:facet-browser",
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
			},
		});
		view.setVisible(false);
		window.contentView.addChildView(view);
		this.views.set(key, view);

		const emitState = (): void => {
			if (window.isDestroyed() || view.webContents.isDestroyed()) {
				return;
			}
			window.webContents.send("facet:browser-state", readState(view));
		};

		view.webContents.on("will-navigate", (event, url) => {
			if (!isSafeBrowserUrl(url)) {
				event.preventDefault();
			}
		});
		view.webContents.on("will-redirect", (event, url) => {
			if (!isSafeBrowserUrl(url)) {
				event.preventDefault();
			}
		});
		view.webContents.setWindowOpenHandler(({ url }) => {
			if (isSafeBrowserUrl(url)) {
				void view.webContents.loadURL(url);
			}
			return { action: "deny" };
		});

		view.webContents.on("did-start-loading", emitState);
		view.webContents.on("did-stop-loading", emitState);
		view.webContents.on("did-navigate", emitState);
		view.webContents.on("did-navigate-in-page", emitState);
		view.webContents.on("page-title-updated", emitState);
		view.webContents.on("did-fail-load", emitState);
		return view;
	}

	/** 同步右侧栏容器的坐标与显隐。 */
	syncBounds(window: BrowserWindow, raw: unknown): void {
		if (typeof raw !== "object" || raw === null) {
			return;
		}
		const b = raw as Partial<MainBrowserBounds>;
		const visible = b.visible === true;
		const key = window.webContents.id;
		const existing = this.views.get(key);
		if (!visible) {
			if (existing !== undefined && !existing.webContents.isDestroyed()) {
				existing.setVisible(false);
			}
			return;
		}
		const view = this.ensure(window);
		const x = Math.max(0, Math.round(typeof b.x === "number" ? b.x : 0));
		const y = Math.max(0, Math.round(typeof b.y === "number" ? b.y : 0));
		const width = Math.max(0, Math.round(typeof b.width === "number" ? b.width : 0));
		const height = Math.max(0, Math.round(typeof b.height === "number" ? b.height : 0));
		if (width <= 1 || height <= 1) {
			view.setVisible(false);
			return;
		}
		view.setBounds({ x, y, width, height });
		view.setVisible(true);
	}

	/** 导航到指定安全 URL。 */
	navigate(window: BrowserWindow, rawUrl: unknown): void {
		if (!isSafeBrowserUrl(rawUrl)) {
			return;
		}
		const view = this.ensure(window);
		void view.webContents.loadURL(rawUrl).catch(() => undefined);
	}

	back(window: BrowserWindow): void {
		const view = this.views.get(window.webContents.id);
		if (
			view !== undefined &&
			!view.webContents.isDestroyed() &&
			view.webContents.navigationHistory.canGoBack()
		) {
			view.webContents.navigationHistory.goBack();
		}
	}

	forward(window: BrowserWindow): void {
		const view = this.views.get(window.webContents.id);
		if (
			view !== undefined &&
			!view.webContents.isDestroyed() &&
			view.webContents.navigationHistory.canGoForward()
		) {
			view.webContents.navigationHistory.goForward();
		}
	}

	reload(window: BrowserWindow): void {
		const view = this.views.get(window.webContents.id);
		if (view !== undefined && !view.webContents.isDestroyed()) {
			view.webContents.reload();
		}
	}

	stop(window: BrowserWindow): void {
		const view = this.views.get(window.webContents.id);
		if (view !== undefined && !view.webContents.isDestroyed()) {
			view.webContents.stop();
		}
	}

	/** 关闭标签或关闭窗口时销毁关联的 WebContentsView。 */
	destroyFor(contentsId: number, window?: BrowserWindow | null): void {
		const view = this.views.get(contentsId);
		if (view === undefined) {
			return;
		}
		this.views.delete(contentsId);
		if (window !== undefined && window !== null && !window.isDestroyed()) {
			try {
				window.contentView.removeChildView(view);
			} catch {
				// 窗口正在销毁时忽略子节点移除异常
			}
		}
		if (!view.webContents.isDestroyed()) {
			view.webContents.close();
		}
	}

	/** 注册主进程侧的浏览器视图 IPC 通道。 */
	registerIpc(): void {
		const windowOf = (sender: Electron.WebContents): BrowserWindow | undefined => {
			const win = BrowserWindow.fromWebContents(sender);
			return win === null || win.isDestroyed() ? undefined : win;
		};
		ipcMain.on("facet:browser-bounds", (event, bounds: unknown) => {
			const win = windowOf(event.sender);
			if (win !== undefined) this.syncBounds(win, bounds);
		});
		ipcMain.on("facet:browser-navigate", (event, url: unknown) => {
			const win = windowOf(event.sender);
			if (win !== undefined) this.navigate(win, url);
		});
		ipcMain.on("facet:browser-back", (event) => {
			const win = windowOf(event.sender);
			if (win !== undefined) this.back(win);
		});
		ipcMain.on("facet:browser-forward", (event) => {
			const win = windowOf(event.sender);
			if (win !== undefined) this.forward(win);
		});
		ipcMain.on("facet:browser-reload", (event) => {
			const win = windowOf(event.sender);
			if (win !== undefined) this.reload(win);
		});
		ipcMain.on("facet:browser-stop", (event) => {
			const win = windowOf(event.sender);
			if (win !== undefined) this.stop(win);
		});
		ipcMain.on("facet:browser-dispose", (event) => {
			const win = windowOf(event.sender);
			this.destroyFor(event.sender.id, win);
		});
		ipcMain.on("facet:browser-open-external", (_event, url: unknown) => {
			if (isSafeBrowserUrl(url) && url !== "about:blank") {
				void shell.openExternal(url);
			}
		});
	}
}
