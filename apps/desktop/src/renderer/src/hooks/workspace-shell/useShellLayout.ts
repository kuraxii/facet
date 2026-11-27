/**
 * 外壳的三档布局与两栏宽度。
 *
 * 档位照 `docs/layout.md` §2 算：窄档把左栏让给抽屉（右栏继续占列），中档按预算折起一栏，
 * 宽档按意图平铺。
 * 另外两件事：右栏没有固定上限，钳制上限是「给正文留够地方」之后剩下的宽度（偏好宽本身
 * 不动）；拖动期间整段不重算档位——拖到一半折起一栏会卸载分隔条，收尾会拿一个没人在看的
 * 宽度去提交。`data-*-drag-collapsed` 那条折叠预览由 `PaneResizer` 直接写在 `.app` 上，
 * 这里提供的就是它要的这把锁。
 */
import {
	clampSidebarWidth,
	PANEL_MIN_WIDTH,
	type RightPanelTab,
	readSidebarCollapsed,
	readSidebarWidth,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	writeSidebarCollapsed,
	writeSidebarWidth,
} from "@facet/ui";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { shellClassName } from "../../drawer-state.ts";
import { readLayoutIsNarrow, subscribeLayout } from "../../layout-mode.ts";
import { appStorage } from "../../local-storage.ts";
import {
	clampDragMax,
	fitPanelWidth,
	type LayoutResolution,
	resolveLayout,
	sameLayout,
} from "../../resolve-layout.ts";
import type { ShellLayout, ShellLayoutOptions } from "./shell-types.ts";
import type { PanelPatch } from "./useWorkspacePanels.ts";

export function useShellLayout(options: ShellLayoutOptions): ShellLayout {
	const { panel, panelExpanded, panelActions, drawers } = options;
	/** 侧栏的收起意图（落盘到本机应用存储）；窄档下这一栏进抽屉，意图位照旧记着 */
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => readSidebarCollapsed(appStorage));
	const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(appStorage));
	/** 分隔条是否正在拖：拖动期间锁住折叠结果 */
	const [isResizing, setIsResizing] = useState(false);
	const isNarrow = useSyncExternalStore(subscribeLayout, readLayoutIsNarrow);
	/** 用户想不想开左栏 */
	const sidebarIntent = !isSidebarCollapsed;
	/** 用户想不想开右栏 */
	const panelIntent = panel.open;
	/** 按此刻的窗口与两栏状态算一次布局结果。 */
	const resolve = useCallback(
		(): LayoutResolution =>
			resolveLayout({
				viewportWidth: window.innerWidth,
				sidebarPref: sidebarWidth,
				panelPref: panel.width,
				panelPrefViewport: panel.widthViewport,
				sidebarIntent,
				panelIntent,
				isPanelExpanded: panelExpanded,
			}),
		[sidebarWidth, panel.width, panel.widthViewport, panelExpanded, sidebarIntent, panelIntent],
	);
	const [layout, setLayout] = useState<LayoutResolution>(resolve);

	/*
	 * 重算档位的时机只有四个：意图位变化、偏好宽提交、视口 resize、优先级换边。
	 *
	 * 不看 `ResizeObserver` 量到的容器宽：折起一栏会让容器变宽，看着容器决定折展就是一个
	 * 自己喂自己的循环。拖动期间整段跳过，理由见文件头。
	 */
	useEffect(() => {
		if (isResizing) {
			return;
		}
		const apply = (): void => {
			const next = resolve();
			setLayout((current) => (sameLayout(current, next) ? current : next));
		};
		apply();
		window.addEventListener("resize", apply);
		return () => window.removeEventListener("resize", apply);
	}, [isResizing, resolve]);

	// 进窄档或右栏收起时宽展开自动归 `false`：留着的话下次打开会莫名其妙地整行铺开

	useEffect(() => {
		if (isNarrow || !panelIntent) {
			panelActions.collapseExpanded();
		}
	}, [isNarrow, panelIntent, panelActions]);

	const updateSidebarWidth = useCallback((next: number) => {
		const width = clampSidebarWidth(next);
		setSidebarWidth(width);
		writeSidebarWidth(appStorage, width);
	}, []);

	const updateSidebarCollapsed = useCallback((collapsed: boolean) => {
		setIsSidebarCollapsed(collapsed);
		writeSidebarCollapsed(appStorage, collapsed);
	}, []);

	const setPaneResizing = useCallback((dragging: boolean) => setIsResizing(dragging), []);

	/** 左栏此刻在不在：窄档看抽屉，宽档与中档看预算判定的结果 */
	const isSidebarOpen = layout.sidebarVisible || (isNarrow && drawers.isDrawerOpen);
	const toggleSidebar = useCallback(() => {
		if (isNarrow) {
			drawers.toggleSidebarDrawer();
			return;
		}
		// 看的是「此刻看不看得见」，不是意图位：被中档预算折起时，点一下是要把它调出来
		if (!layout.sidebarVisible) {
			updateSidebarCollapsed(false);
			return;
		}
		updateSidebarCollapsed(true);
	}, [drawers, isNarrow, layout.sidebarVisible, updateSidebarCollapsed]);

	/**
	 * 右栏实占宽：窗口变小时先让它窄下去，窄到下限之后正文才开始缩（口径见
	 * `docs/layout.md` §3 约束 2 与 `fitPanelWidth`）。三档一体，窄档也不例外。
	 */
	const panelEffectiveWidth = fitPanelWidth({
		viewportWidth: layout.viewportWidth,
		sidebarWidth: layout.sidebarVisible ? sidebarWidth : 0,
		panelPref: panel.width,
		panelPrefViewport: panel.widthViewport,
	});
	/** 分隔条的实时上限：正文地板给的硬边界，比自动让位宽一档（所以拖得比自动值宽） */
	const panelMaxWidth = clampDragMax({
		viewportWidth: layout.viewportWidth,
		otherWidth: layout.sidebarVisible ? sidebarWidth : 0,
		min: PANEL_MIN_WIDTH,
	});
	/** 左栏拖动的上限：它自己有 `SIDEBAR_MAX_WIDTH`，再与正文的约束取小 */
	const sidebarMaxWidth = clampDragMax({
		viewportWidth: layout.viewportWidth,
		otherWidth: layout.panelVisible ? panelEffectiveWidth : 0,
		min: SIDEBAR_MIN_WIDTH,
		max: SIDEBAR_MAX_WIDTH,
	});

	const updatePanel = useCallback(
		(patch: PanelPatch) => {
			panelActions.update(patch);
		},
		[panelActions],
	);

	/** 开关右栏：改意图位（看得见就收起，被折起时点一下是调出来）。 */
	const togglePanel = useCallback(() => {
		panelActions.setOpen(!layout.panelVisible);
	}, [layout.panelVisible, panelActions]);

	/** 打开一个工具并切过去：顺手把右栏打开（被折起时预算换边） */
	const setPanelTab = useCallback(
		(tab: RightPanelTab) => {
			panelActions.openTab(tab);
		},
		[panelActions],
	);

	/**
	 * 关掉一个标签。右栏不跟着收起：关光之后停在启动清单上（`activeTab` 为 `null`）。
	 */
	const closePanelTab = useCallback(
		(tab: RightPanelTab) => {
			panelActions.closeTab(tab);
		},
		[panelActions],
	);

	/** 重排右栏已打开的标签顺序。 */
	const reorderPanelTabs = useCallback(
		(tabs: readonly RightPanelTab[]) => {
			panelActions.reorderTabs(tabs);
		},
		[panelActions],
	);

	const togglePanelExpanded = panelActions.toggleExpanded;
	return {
		isNarrow,
		isDrawerOpen: drawers.isDrawerOpen,
		isPanelOpen: layout.panelVisible,
		isPanelExpanded: layout.expanded,
		isSidebarCollapsed,
		isSidebarOpen,
		sidebarVisible: layout.sidebarVisible,
		panelVisible: layout.panelVisible,
		panelMaxWidth,
		panelEffectiveWidth,
		sidebarMaxWidth,
		sidebarWidth,
		className: shellClassName({
			isSidebarOpen,
			isDrawerOpen: drawers.isDrawerOpen,
			isNarrow,
		}),
		toggleSidebar,
		updateSidebarWidth,
		setPaneResizing,
		updatePanel,
		togglePanel,
		setPanelTab,
		closePanelTab,
		reorderPanelTabs,
		togglePanelExpanded,
		closeDrawer: drawers.closeDrawer,
	};
}
