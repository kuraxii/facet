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
	PANEL_MAX_WIDTH,
	PANEL_MIN_WIDTH,
	type RightPanelState,
	type RightPanelTab,
	readPanelState,
	readSidebarWidth,
	resolveUiTheme,
	type SettingsSection,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	stepUiScale,
	writePanelState,
	writeSidebarWidth,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { bridge } from "../bridge.ts";
import { type NarrowDrawer, toggleNarrowDrawer } from "../drawer-state.ts";
import { readLayoutIsNarrow, subscribeLayout } from "../layout-mode.ts";
import { clampDragMax, type LayoutPane, type LayoutResolution, resolveLayout } from "../resolve-layout.ts";
import { useDrawerBehavior } from "./useDrawerBehavior.ts";

/** 两份布局结果是否等价；等价时不触发重渲染。 */
function sameLayout(left: LayoutResolution, right: LayoutResolution): boolean {
	return (
		left.tier === right.tier &&
		left.viewportWidth === right.viewportWidth &&
		left.sidebarVisible === right.sidebarVisible &&
		left.panelVisible === right.panelVisible &&
		left.foldedPane === right.foldedPane
	);
}

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

/** 外壳类名：抽屉展开时给 has-drawer。栏位显隐在 `.app` 上，不在这里。 */
function shellClassName(isSidebarOpen: boolean, isDrawerOpen: boolean, isNarrow: boolean): string {
	const names = ["shell"];
	if (isNarrow && isDrawerOpen) {
		names.push("has-drawer");
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
	/** 右抽屉是否开着（窄档） */
	isPanelDrawerOpen: boolean;
	/** 左栏此刻是否占列（宽档/中档下要么是意图，要么是中档预算留下的那一栏） */
	sidebarVisible: boolean;
	/** 右栏此刻是否占列 */
	panelVisible: boolean;
	/** 右栏分隔条的实时上限（中档按空间预算钳制） */
	panelMaxWidth: number;
	/** 左栏分隔条的实时上限 */
	sidebarMaxWidth: number;
	/** 分隔条开始/结束拖动的提示，拖动期间锁住折叠 */
	setPaneResizing: (dragging: boolean) => void;
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
	/** 开关右栏：窄档切抽屉，宽档与中档改意图位 */
	togglePanel: () => void;
	/** 切右栏分页；窄档把抽屉调出来，中档被折起时把预算让给它 */
	setPanelTab: (tab: RightPanelTab) => void;
	/** 应用本机界面缩放 */
	changeUiScale: (next: number) => void;
	/** 代码块主题，浅色与深色各取一份 */
	codeTheme: CodeThemeValue;
}

export function useWorkspaceShell(options: WorkspaceShellOptions): WorkspaceShell {
	const { settings } = options;
	/**
	 * 窄档里开着哪一个抽屉（两侧互斥）。它是临时视图，不写回宽档的意图位：
	 * 窗口拉宽后仍按 `panel.open` 与侧栏收起位平铺。
	 */
	const [narrowDrawer, setNarrowDrawer] = useState<NarrowDrawer | undefined>(undefined);
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
	/** 左抽屉是否开着 */
	const isDrawerOpen = narrowDrawer === "sidebar";
	/** 右抽屉是否开着 */
	const isPanelDrawerOpen = narrowDrawer === "panel";
	/** 最近一次被用户主动打开或调宽的那一栏：中档预算不够时保留它 */
	const [priorityPane, setPriorityPane] = useState<LayoutPane>("sidebar");
	/** 分隔条是否正在拖：拖动期间锁住折叠结果 */
	const [isResizing, setIsResizing] = useState(false);
	/** 用户想不想开左栏；窄档下这一栏进抽屉，意图位照旧记着 */
	const sidebarIntent = !isSidebarCollapsed;
	/** 用户想不想开右栏 */
	const panelIntent = panel.open;
	const [layout, setLayout] = useState<LayoutResolution>(() =>
		resolveLayout({
			viewportWidth: window.innerWidth,
			sidebarPref: sidebarWidth,
			panelPref: panel.width,
			sidebarIntent,
			panelIntent,
			priorityPane,
		}),
	);

	/*
	 * 重算档位的时机只有四个：意图位变化、偏好宽提交、视口 resize、优先级换边。
	 *
	 * 不用 ResizeObserver 观察内部容器：折起一栏会让容器变宽，看着容器来决定折展就是
	 * 一个自己喂自己的循环。拖动期间整段跳过：分隔条正在拖的时候把一栏折起，会先卸载
	 * 分隔条，`lostpointercapture` 那次收尾会拿一个没人在看的宽度去提交。
	 */
	useEffect(() => {
		if (isResizing) {
			return;
		}
		const apply = (): void => {
			const next = resolveLayout({
				viewportWidth: window.innerWidth,
				sidebarPref: sidebarWidth,
				panelPref: panel.width,
				sidebarIntent,
				panelIntent,
				priorityPane,
			});
			setLayout((current) => (sameLayout(current, next) ? current : next));
		};
		apply();
		window.addEventListener("resize", apply);
		return () => window.removeEventListener("resize", apply);
	}, [isResizing, sidebarWidth, panel.width, sidebarIntent, panelIntent, priorityPane]);

	// 离开窄档就把抽屉收掉：抽屉是窄档的临时视图，拉宽后由意图位接管
	useEffect(() => {
		if (!isNarrow) {
			setNarrowDrawer(undefined);
		}
	}, [isNarrow]);

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
		// 调宽也是一次主动交互：预算不够时折起的应该是另一栏
		setPriorityPane("sidebar");
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

	/** 左栏此刻在不在：窄档看抽屉，宽档与中档看预算判定的结果 */
	const isSidebarOpen = layout.sidebarVisible || (isNarrow && isDrawerOpen);
	const toggleSidebar = useCallback(() => {
		if (isNarrow) {
			setNarrowDrawer((current) => toggleNarrowDrawer(current, "sidebar"));
			return;
		}
		/*
		 * 看的是「此刻看不看得见」，不是意图位：被中档预算折起时，点一下是要把它调出来，
		 * 而不是把意图位关掉；调出来的同时把优先级换到它身上。
		 */
		if (!layout.sidebarVisible) {
			setPriorityPane("sidebar");
			setIsSidebarCollapsed(false);
			return;
		}
		setIsSidebarCollapsed(true);
	}, [isNarrow, layout.sidebarVisible]);

	/**
	 * 中档下拖动的实时上限：松手那一刻同样不超预算（约束 2）。
	 *
	 * 取 `max(当前宽, 预算上限)`：中档只开一栏时没有可折的对象，当前宽可能已经比预算宽，
	 * 这时别让指针一抓住分隔条就把它跳下去；上限等于当前宽，只能缩不能长。
	 */
	const panelMaxWidth = Math.max(
		panel.width,
		clampDragMax({
			tier: layout.tier,
			viewportWidth: layout.viewportWidth,
			otherWidth: layout.sidebarVisible ? sidebarWidth : 0,
			min: PANEL_MIN_WIDTH,
			max: PANEL_MAX_WIDTH,
		}),
	);
	const sidebarMaxWidth = Math.max(
		sidebarWidth,
		clampDragMax({
			tier: layout.tier,
			viewportWidth: layout.viewportWidth,
			otherWidth: layout.panelVisible ? panel.width : 0,
			min: SIDEBAR_MIN_WIDTH,
			max: SIDEBAR_MAX_WIDTH,
		}),
	);
	const setPaneResizing = useCallback((dragging: boolean) => setIsResizing(dragging), []);

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
			// 手动打开或调宽都算主动交互：优先级换到右栏，预算不够时折起左栏
			if (patch.open === true || patch.width !== undefined) {
				setPriorityPane("panel");
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
	const closeDrawer = useCallback(() => setNarrowDrawer(undefined), []);

	/** 开关右栏：窄档切抽屉（不动宽档的意图位），平铺时改意图位 */
	const togglePanel = useCallback(() => {
		if (isNarrow) {
			setNarrowDrawer((current) => toggleNarrowDrawer(current, "panel"));
			return;
		}
		updatePanel({ open: !layout.panelVisible });
	}, [isNarrow, layout.panelVisible, updatePanel]);

	/** 切分页：窄档把抽屉调出来，宽档与中档顺手把右栏打开（被折起时预算换边） */
	const setPanelTab = useCallback(
		(tab: RightPanelTab) => {
			if (isNarrow) {
				setNarrowDrawer("panel");
				updatePanel({ tab });
				return;
			}
			updatePanel({ tab, open: true });
		},
		[isNarrow, updatePanel],
	);

	// 两个抽屉各挂一份 Escape 与焦点归还；同一时刻只有一个开着，所以两份互不打扰
	useDrawerBehavior({ isOpen: isNarrow && isDrawerOpen, onClose: closeDrawer });
	useDrawerBehavior({ isOpen: isNarrow && isPanelDrawerOpen, onClose: closeDrawer });
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
		isPanelDrawerOpen,
		isSidebarCollapsed,
		isSidebarOpen,
		sidebarVisible: layout.sidebarVisible,
		panelVisible: layout.panelVisible,
		panelMaxWidth,
		sidebarMaxWidth,
		setPaneResizing,
		sidebarWidth,
		isSearchOpen,
		view,
		settingsSection,
		panel,
		uiScale,
		zoomBadge,
		className: shellClassName(isSidebarOpen, isDrawerOpen, isNarrow),
		toggleSidebar,
		updateSidebarWidth,
		setSearchOpen,
		closeDrawer,
		openSettings,
		closeSettings,
		setSettingsSection,
		updatePanel,
		togglePanel,
		setPanelTab,
		changeUiScale,
		codeTheme,
	};
}
