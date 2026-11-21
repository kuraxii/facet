/**
 * 外壳的三档布局与两栏宽度。
 *
 * 档位照 `docs/layout.md` §2 算：窄档两栏都是抽屉，中档按预算折起一栏，宽档按意图平铺。
 * 另外两件事：右栏没有固定上限，钳制上限是「给正文留够地方」之后剩下的宽度（偏好宽本身
 * 不动）；拖动期间整段不重算档位——拖到一半折起一栏会卸载分隔条，收尾会拿一个没人在看的
 * 宽度去提交。`data-*-drag-collapsed` 那条折叠预览由 `PaneResizer` 直接写在 `.app` 上，
 * 这里提供的就是它要的这把锁。
 */
import {
	clampSidebarWidth,
	PANEL_MIN_WIDTH,
	type RightPanelTab,
	readSidebarWidth,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	writeSidebarWidth,
} from "@facet/ui";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { shellClassName } from "../../drawer-state.ts";
import { readLayoutIsNarrow, subscribeLayout } from "../../layout-mode.ts";
import { clampDragMax, type LayoutResolution, resolveLayout, sameLayout } from "../../resolve-layout.ts";
import type { ShellLayout, ShellLayoutOptions } from "./shell-types.ts";
import type { PanelPatch } from "./useWorkspacePanels.ts";

export function useShellLayout(options: ShellLayoutOptions): ShellLayout {
	const { panel, panelExpanded, priorityPane, onPriorityChange, panelActions, drawers } = options;
	/** 侧栏的收起意图；窄档下这一栏进抽屉，意图位照旧记着 */
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(window.localStorage));
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
				sidebarIntent,
				panelIntent,
				isPanelExpanded: panelExpanded,
				priorityPane,
			}),
		[sidebarWidth, panel.width, panelExpanded, sidebarIntent, panelIntent, priorityPane],
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

	const updateSidebarWidth = useCallback(
		(next: number) => {
			const width = clampSidebarWidth(next);
			// 调宽也是一次主动交互：预算不够时折起的应该是另一栏
			onPriorityChange("sidebar");
			setSidebarWidth(width);
			writeSidebarWidth(window.localStorage, width);
		},
		[onPriorityChange],
	);

	const setPaneResizing = useCallback((dragging: boolean) => setIsResizing(dragging), []);

	/** 左栏此刻在不在：窄档看抽屉，宽档与中档看预算判定的结果 */
	const isSidebarOpen = layout.sidebarVisible || (isNarrow && drawers.isDrawerOpen);
	const toggleSidebar = useCallback(() => {
		if (isNarrow) {
			drawers.toggleSidebarDrawer();
			return;
		}
		/*
		 * 看的是「此刻看不看得见」，不是意图位：被中档预算折起时，点一下是要把它调出来，
		 * 而不是把意图位关掉；调出来的同时把优先级换到它身上。
		 */
		if (!layout.sidebarVisible) {
			onPriorityChange("sidebar");
			setIsSidebarCollapsed(false);
			return;
		}
		setIsSidebarCollapsed(true);
	}, [drawers, isNarrow, layout.sidebarVisible, onPriorityChange]);

	/**
	 * 右栏实占宽：偏好宽与「给正文留够地方」取小（口径见 `docs/layout.md` §3 约束 2）。
	 *
	 * 窄档是例外：那时右栏盖在正文上，没有并列的正文要保护，预算钳制只会把它压到
	 * `PANEL_MIN_WIDTH`，所以直接用偏好宽，抽屉自己按 `min(宽度, 92vw)` 收。
	 */
	const panelMaxWidth = clampDragMax({
		viewportWidth: layout.viewportWidth,
		otherWidth: layout.sidebarVisible ? sidebarWidth : 0,
		min: PANEL_MIN_WIDTH,
	});
	const panelEffectiveWidth = isNarrow ? panel.width : Math.min(panel.width, panelMaxWidth);
	/** 左栏拖动的上限：它自己有 `SIDEBAR_MAX_WIDTH`，再与正文的约束取小 */
	const sidebarMaxWidth = clampDragMax({
		viewportWidth: layout.viewportWidth,
		otherWidth: layout.panelVisible ? panelEffectiveWidth : 0,
		min: SIDEBAR_MIN_WIDTH,
		max: SIDEBAR_MAX_WIDTH,
	});

	/** 改右栏状态：窄档下右栏是浮层、宽度由样式表定，宽度补丁直接丢掉。 */
	const updatePanel = useCallback(
		(patch: PanelPatch) => {
			if (isNarrow && typeof patch === "object" && patch.width !== undefined) {
				return;
			}
			panelActions.update(patch);
		},
		[isNarrow, panelActions],
	);

	/** 开关右栏：窄档切临时抽屉；平铺态改意图位（看得见就收起，被折起时点一下是调出来）。 */
	const togglePanel = useCallback(() => {
		if (isNarrow) {
			drawers.togglePanelDrawer();
			return;
		}
		panelActions.setOpen(!layout.panelVisible);
	}, [drawers, isNarrow, layout.panelVisible, panelActions]);

	/** 关掉右抽屉：宽档下右栏收起时顺带退出宽展开 */
	const closePanelDrawer = useCallback(() => {
		if (isNarrow) {
			drawers.closePanelDrawer();
			return;
		}
		panelActions.collapseExpanded();
		panelActions.setOpen(false);
	}, [drawers, isNarrow, panelActions]);

	/** 打开一个工具并切过去：窄档把抽屉调出来，宽档与中档顺手把右栏打开（被折起时预算换边） */
	const setPanelTab = useCallback(
		(tab: RightPanelTab) => {
			if (isNarrow) {
				drawers.openPanelDrawer();
				panelActions.openTab(tab);
				return;
			}
			panelActions.openTab(tab);
		},
		[drawers, isNarrow, panelActions],
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

	const togglePanelExpanded = panelActions.toggleExpanded;
	/** 右栏此刻看不看得见：窄档看抽屉，其余看有没有占列 */
	const isPanelOpen = isNarrow ? drawers.isPanelDrawerOpen : layout.panelVisible;
	return {
		isNarrow,
		isDrawerOpen: drawers.isDrawerOpen,
		isPanelDrawerOpen: drawers.isPanelDrawerOpen,
		isPanelOpen,
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
		closePanelDrawer,
		togglePanelExpanded,
		closeDrawer: drawers.closeDrawer,
	};
}
