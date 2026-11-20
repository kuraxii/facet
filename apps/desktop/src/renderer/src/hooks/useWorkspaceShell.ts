/**
 * 界面外壳。
 *
 * 侧栏的抽屉与收起、右栏的分页与宽度、设置视图、界面缩放与全局快捷键——都是与主机
 * 无关的呈现状态，谁都不依赖，只依赖设置与窗口。
 */
import type { FacetSettings } from "@facet/protocol";
import {
	type CodeThemeValue,
	clampSidebarWidth,
	isDarkTheme,
	normalizeUiScale,
	type RightPanelState,
	readPanelState,
	readSidebarWidth,
	resolveUiTheme,
	type SettingsSection,
	stepUiScale,
	writePanelState,
	writeSidebarWidth,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { bridge } from "../bridge.ts";
import { readLayoutIsNarrow, subscribeLayout } from "../layout-mode.ts";

/** 系统是否偏浅色。 */
function prefersLight(): boolean {
	return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/**
 * 把外观设置写到根节点。
 *
 * 主题、字体与字号通过 CSS 变量下发，正文、代码块与差异视图都读同一组变量；减少动效时
 * 根节点带 data-motion="reduced"，样式据此关掉过渡。
 */
export function applyAppearance(appearance: FacetSettings["appearance"]): void {
	const root = document.documentElement;
	root.dataset.theme = resolveUiTheme(appearance.theme, prefersLight());
	root.dataset.motion = appearance.reducedMotion ? "reduced" : "full";
	root.dataset.liveMotion = appearance.liveMotion;
	// 对话导航的所有尺寸都是 `--outline-scale` 的倍数，百分比在这里换算成倍数
	root.style.setProperty("--outline-scale", String(appearance.outlineScale / 100));
	// 界面字体与正文字号固定；整体大小由窗口缩放控制。
	// 空串表示用样式表里的缺省栈：这里把内联值去掉，`:root` 的默认值就生效；
	// 编辑器与终端的字体在样式表里默认跟着代码字体走
	const applyFont = (name: string, value: string): void => {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			root.style.setProperty(name, trimmed);
			return;
		}
		root.style.removeProperty(name);
	};
	applyFont("--font-mono", appearance.codeFont);
	applyFont("--font-editor", appearance.editorFont);
	applyFont("--font-terminal", appearance.terminalFont);
	root.style.setProperty("--editor-size", `${appearance.editorFontSize}px`);
	root.style.setProperty("--terminal-size", `${appearance.terminalFontSize}px`);
	// 编辑器与终端读的是计算后的变量值，换外观时要显式告诉它们重新取
	window.dispatchEvent(new Event("facet:appearance-changed"));
}

/** 外壳类名：抽屉展开时给 has-drawer，宽屏收起侧栏时给 is-sb-hidden。 */
function shellClassName(
	isSidebarOpen: boolean,
	isDrawerOpen: boolean,
	isSidebarCollapsed: boolean,
	isNarrow: boolean,
): string {
	const names = ["shell"];
	if (isNarrow && isDrawerOpen) {
		names.push("has-drawer");
	}
	if (!isNarrow && isSidebarCollapsed) {
		names.push("is-sb-hidden");
	}
	if (isSidebarOpen) {
		names.push("is-sb-open");
	}
	return names.join(" ");
}

export interface WorkspaceShellOptions {
	/** 主机上的偏好设置，外观从这里取 */
	settings: FacetSettings;
}

export interface WorkspaceShell {
	/** 窄屏时侧栏是抽屉 */
	isNarrow: boolean;
	/** 抽屉是否展开 */
	isDrawerOpen: boolean;
	/** 宽屏下侧栏是否收起 */
	isSidebarCollapsed: boolean;
	/** 侧栏此刻是否可见 */
	isSidebarOpen: boolean;
	/** 侧栏宽度 */
	sidebarWidth: number;
	/** 会话搜索框是否展开 */
	isSearchOpen: boolean;
	/** 主区域显示对话还是设置 */
	view: "chat" | "settings";
	/** 设置页停在哪一节 */
	settingsSection: SettingsSection;
	/** 右栏的状态：展开、分页与宽度 */
	panel: RightPanelState;
	/** 本机界面缩放百分比 */
	uiScale: number;
	/** 缩放变化后短暂显示的百分比浮层 */
	zoomBadge: number | undefined;
	/** 外壳类名 */
	className: string;
	/** 侧栏开关在两套行为之间切换 */
	toggleSidebar: () => void;
	/** 改侧栏宽度并写回本地 */
	updateSidebarWidth: (next: number) => void;
	/** 展开或收起会话搜索 */
	setSearchOpen: (open: boolean) => void;
	/** 收起抽屉 */
	closeDrawer: () => void;
	/** 打开设置视图 */
	openSettings: () => void;
	/** 回到对话视图 */
	closeSettings: () => void;
	/** 换设置页的分节 */
	setSettingsSection: (section: SettingsSection) => void;
	/** 改右栏状态并写回本地 */
	updatePanel: (patch: Partial<RightPanelState>) => void;
	/** 应用本机界面缩放 */
	changeUiScale: (next: number) => void;
	/** 代码块主题，浅色与深色各取一份 */
	codeTheme: CodeThemeValue;
}

export function useWorkspaceShell(options: WorkspaceShellOptions): WorkspaceShell {
	const { settings } = options;
	/** 窄屏时侧栏是抽屉，这个开关控制它展开；宽屏时侧栏常驻，另行记收起的意图 */
	const [isDrawerOpen, setIsDrawerOpen] = useState(false);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(window.localStorage));
	const [view, setView] = useState<"chat" | "settings">("chat");
	const [settingsSection, setSettingsSection] = useState<SettingsSection>("models");
	const [panel, setPanel] = useState<RightPanelState>(() => readPanelState(localStorage));
	const [uiScale, setUiScale] = useState(bridge.uiScale);
	const [zoomBadge, setZoomBadge] = useState<number | undefined>(undefined);
	/** 缩放浮层的定时器 */
	const zoomBadgeTimer = useRef<number | undefined>(undefined);
	const isNarrow = useSyncExternalStore(subscribeLayout, readLayoutIsNarrow);

	// 设置变化时应用外观
	useEffect(() => {
		applyAppearance(settings.appearance);
	}, [settings.appearance]);

	// ⌘K 打开会话搜索，与页脚提示的快捷键一致
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setIsSearchOpen(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const updateSidebarWidth = useCallback((next: number) => {
		const width = clampSidebarWidth(next);
		setSidebarWidth(width);
		writeSidebarWidth(window.localStorage, width);
	}, []);

	/** 应用本机界面缩放并让窗口重新测量。 */
	const changeUiScale = useCallback((next: number) => {
		const scale = normalizeUiScale(next);
		setUiScale(scale);
		bridge.setUiScale?.(scale);
		setZoomBadge(scale);
		if (zoomBadgeTimer.current !== undefined) window.clearTimeout(zoomBadgeTimer.current);
		zoomBadgeTimer.current = window.setTimeout(() => setZoomBadge(undefined), 1200);
		window.requestAnimationFrame(() => window.dispatchEvent(new Event("facet:zoom-changed")));
	}, []);

	// 界面缩放快捷键：Mod+= / Mod+- / Mod+0；0 回到 100%
	useEffect(() => {
		if (bridge.platform === "web") return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
			if (event.key === "0") {
				event.preventDefault();
				changeUiScale(100);
				return;
			}
			const direction =
				event.key === "=" || event.key === "+" ? 1 : event.key === "-" || event.key === "_" ? -1 : 0;
			if (direction === 0) return;
			event.preventDefault();
			changeUiScale(stepUiScale(uiScale, direction));
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [changeUiScale, uiScale]);

	useEffect(() => {
		return () => {
			if (zoomBadgeTimer.current !== undefined) window.clearTimeout(zoomBadgeTimer.current);
		};
	}, []);

	// Electron zoom 改变时 devicePixelRatio 跟着变；通知 xterm 与 CodeMirror 重新量字符网格
	useEffect(() => {
		let query: MediaQueryList | undefined;
		let dispose: (() => void) | undefined;
		const watch = (): void => {
			dispose?.();
			query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
			const onChange = (): void => {
				window.dispatchEvent(new Event("facet:zoom-changed"));
				watch();
			};
			query.addEventListener("change", onChange, { once: true });
			dispose = () => query?.removeEventListener("change", onChange);
		};
		watch();
		return () => dispose?.();
	}, []);

	const isSidebarOpen = isNarrow ? isDrawerOpen : !isSidebarCollapsed;
	const toggleSidebar = useCallback(() => {
		if (isNarrow) {
			setIsDrawerOpen((open) => !open);
		} else {
			setIsSidebarCollapsed((collapsed) => !collapsed);
		}
	}, [isNarrow]);

	/**
	 * 改右栏状态并写回本地存储。
	 *
	 * 窄屏下右栏是浮层、宽度由样式表定，改宽度既看不出效果，又会把桌面端的偏好写坏。
	 */
	const updatePanel = useCallback(
		(patch: Partial<RightPanelState>) => {
			if (isNarrow && patch.width !== undefined) {
				return;
			}
			setPanel((current) => {
				const next = { ...current, ...patch };
				writePanelState(localStorage, next);
				return next;
			});
		},
		[isNarrow],
	);

	const setSearchOpen = useCallback((open: boolean) => setIsSearchOpen(open), []);
	const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
	const openSettings = useCallback(() => setView("settings"), []);
	const closeSettings = useCallback(() => setView("chat"), []);

	/** 代码块主题跟着设置走，浅色与深色分别取一份。 */
	const codeTheme = useMemo(
		() => ({
			theme: settings.appearance.codeTheme,
			isDark: isDarkTheme(resolveUiTheme(settings.appearance.theme, prefersLight())),
		}),
		[settings.appearance.codeTheme, settings.appearance.theme],
	);

	return {
		isNarrow,
		isDrawerOpen,
		isSidebarCollapsed,
		isSidebarOpen,
		sidebarWidth,
		isSearchOpen,
		view,
		settingsSection,
		panel,
		uiScale,
		zoomBadge,
		className: shellClassName(isSidebarOpen, isDrawerOpen, isSidebarCollapsed, isNarrow),
		toggleSidebar,
		updateSidebarWidth,
		setSearchOpen,
		closeDrawer,
		openSettings,
		closeSettings,
		setSettingsSection,
		updatePanel,
		changeUiScale,
		codeTheme,
	};
}
