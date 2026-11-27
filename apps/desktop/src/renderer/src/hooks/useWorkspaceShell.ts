/**
 * 界面外壳。
 *
 * 侧栏的抽屉与收起、右栏的标签与宽度、`⤢` 宽展开、设置视图、界面缩放与全局快捷键——都是
 * 与主机无关的呈现状态，谁都不依赖，只依赖设置与窗口。
 *
 * 三块职责各在一个子 Hook 里：
 *
 * - `workspace-shell/useShellLayout`：档位、两栏宽度与抽屉开合（含拖动期间的折叠锁定）；
 * - `workspace-shell/useDrawerFocus`：侧栏抽屉的 Escape 与焦点归还；
 * - `workspace-shell/useWorkspacePanels`：右栏的标签集合、宽展开与落盘。
 *
 * 这里只做接线，外加不属那三块的壳状态：聊天 / 设置视图、设置分节、会话搜索、界面缩放、
 * 外观与代码主题。
 *
 * 右栏在任何档位都占 Grid 第 3 列，窗口变小时先窄下去（中档超预算时折起的是左栏）。
 * `⤢` 宽展开是临时视图状态，不落盘：展开期间左栏让位、右栏整行，退出时按原偏好宽与
 * 意图位完整恢复（口径见 `docs/layout.md` §2）。
 */
import { useMemo } from "react";
import { workspaceStorage } from "../local-storage.ts";
import type { WorkspaceShell, WorkspaceShellOptions } from "./workspace-shell/shell-types.ts";
import { useDrawerFocus } from "./workspace-shell/useDrawerFocus.ts";
import { useShellChrome } from "./workspace-shell/useShellChrome.ts";
import { useShellLayout } from "./workspace-shell/useShellLayout.ts";
import { useWorkspacePanels } from "./workspace-shell/useWorkspacePanels.ts";

export { applyAppearance } from "./workspace-shell/appearance.ts";
export type { WorkspaceShell, WorkspaceShellOptions } from "./workspace-shell/shell-types.ts";
export type { PanelPatch } from "./workspace-shell/useWorkspacePanels.ts";
export function useWorkspaceShell(options: WorkspaceShellOptions): WorkspaceShell {
	const { appearance, endpoint } = options;
	const panelStorage = useMemo(() => workspaceStorage(endpoint), [endpoint]);
	const chrome = useShellChrome(appearance);
	const panels = useWorkspacePanels(panelStorage);
	const drawers = useDrawerFocus();
	const layout = useShellLayout({
		panel: panels.panel,
		panelExpanded: panels.isPanelExpanded,
		panelActions: panels,
		drawers,
	});

	return {
		isNarrow: layout.isNarrow,
		isDrawerOpen: layout.isDrawerOpen,
		isPanelOpen: layout.isPanelOpen,
		isPanelExpanded: layout.isPanelExpanded,
		isSidebarCollapsed: layout.isSidebarCollapsed,
		isSidebarOpen: layout.isSidebarOpen,
		sidebarVisible: layout.sidebarVisible,
		panelVisible: layout.panelVisible,
		panelMaxWidth: layout.panelMaxWidth,
		panelEffectiveWidth: layout.panelEffectiveWidth,
		sidebarMaxWidth: layout.sidebarMaxWidth,
		setPaneResizing: layout.setPaneResizing,
		sidebarWidth: layout.sidebarWidth,
		className: layout.className,
		toggleSidebar: layout.toggleSidebar,
		updateSidebarWidth: layout.updateSidebarWidth,
		closeDrawer: layout.closeDrawer,
		updatePanel: layout.updatePanel,
		togglePanel: layout.togglePanel,
		setPanelTab: layout.setPanelTab,
		closePanelTab: layout.closePanelTab,
		togglePanelExpanded: layout.togglePanelExpanded,
		panel: panels.panel,
		isSearchOpen: chrome.isSearchOpen,
		view: chrome.view,
		settingsSection: chrome.settingsSection,
		uiScale: chrome.uiScale,
		zoomBadge: chrome.zoomBadge,
		codeTheme: chrome.codeTheme,
		setSearchOpen: chrome.setSearchOpen,
		setSettingsSection: chrome.setSettingsSection,
		openSettings: chrome.openSettings,
		closeSettings: chrome.closeSettings,
		changeUiScale: chrome.changeUiScale,
	};
}
