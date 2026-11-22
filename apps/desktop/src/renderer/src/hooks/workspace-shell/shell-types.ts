/**
 * 外壳子 Hook 之间的契约。
 *
 * 三个子 Hook 各管一块，串起来的形状写在这里：面板状态 → 布局（档位与宽度）→ 抽屉（开合与
 * 焦点）→ 门面。放在一处是因为它们互相引用，散在各自文件里会绕成环。
 */
import type { FacetSettings } from "@facet/protocol";
import type { CodeThemeValue, RightPanelState, RightPanelTab, SettingsSection } from "@facet/ui";
import type { PanelPatch } from "./useWorkspacePanels.ts";

/** 右栏那边由本 Hook 组合出的动作：窄档走抽屉，平铺态改意图位。 */
export interface ShellPanelActions {
	/** 改状态并写回本地存储 */
	update: (patch: PanelPatch) => void;
	/** 打开一个工具并切过去 */
	openTab: (tab: RightPanelTab) => void;
	/** 关掉一个标签 */
	closeTab: (tab: RightPanelTab) => void;
	/** 改「想不想开」 */
	setOpen: (open: boolean) => void;
	/** 进出宽展开（`⤢` / `⤡`） */
	toggleExpanded: () => void;
	/** 退出宽展开 */
	collapseExpanded: () => void;
}

/** 外壳布局的参数。 */
export interface ShellLayoutOptions {
	/** 右栏状态：偏好宽与意图位都从这里取 */
	panel: RightPanelState;
	/** `⤢` 宽展开位 */
	panelExpanded: boolean;
	/** 右栏的原子动作，由 `useWorkspacePanels` 给 */
	panelActions: ShellPanelActions;
	/** 窄档的侧栏抽屉：窄档下左栏的开关走它 */
	drawers: DrawerHandle;
}

/** 外壳布局对外给的东西。 */
export interface ShellLayout {
	/** 窄档：左栏进抽屉，右栏继续占列 */
	isNarrow: boolean;
	/** 左抽屉开着 */
	isDrawerOpen: boolean;
	/** 右栏此刻看不看得见：占没占列 */
	isPanelOpen: boolean;
	/** `⤢` 宽展开是否生效 */
	isPanelExpanded: boolean;
	/** 左栏意图位是收起的 */
	isSidebarCollapsed: boolean;
	/** 左栏此刻是否可见 */
	isSidebarOpen: boolean;
	/** 左栏此刻是否占列 */
	sidebarVisible: boolean;
	/** 右栏此刻是否占列 */
	panelVisible: boolean;
	/** 右栏分隔条的实时上限 */
	panelMaxWidth: number;
	/** 右栏实占宽：偏好宽被正文的约束压窄之后的值 */
	panelEffectiveWidth: number;
	/** 左栏分隔条的实时上限 */
	sidebarMaxWidth: number;
	/** 左栏偏好宽 */
	sidebarWidth: number;
	/** 外壳类名 */
	className: string;
	/** 开关左栏：窄档切抽屉，平铺态改意图位 */
	toggleSidebar: () => void;
	/** 改左栏宽度并写回本地 */
	updateSidebarWidth: (next: number) => void;
	/** 分隔条开始/结束拖动：拖动期间锁住折叠 */
	setPaneResizing: (dragging: boolean) => void;
	/** 改右栏状态并写回本地 */
	updatePanel: (patch: PanelPatch) => void;
	/** 开关右栏：改意图位 */
	togglePanel: () => void;
	/** 打开一个工具并切过去 */
	setPanelTab: (tab: RightPanelTab) => void;
	/** 关掉一个工具标签 */
	closePanelTab: (tab: RightPanelTab) => void;
	/** `⤢` 与 `⤡` */
	togglePanelExpanded: () => void;
	/** 收起左抽屉 */
	closeDrawer: () => void;
}

/**
 * 窄档的侧栏抽屉：开合状态、动作，以及挂在上面的 Escape 与焦点行为。
 *
 * 抽屉是窄档的临时视图，不写回宽档的意图位：窗口拉宽后仍按侧栏收起位平铺。
 */
export interface DrawerHandle {
	/** 左抽屉开着 */
	isDrawerOpen: boolean;
	/** 开关左抽屉 */
	toggleSidebarDrawer: () => void;
	/** 收起左抽屉 */
	closeDrawer: () => void;
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
	/** 右栏此刻看不看得见：占没占列 */
	isPanelOpen: boolean;
	/** `⤢` 宽展开是否生效：左栏临时让位、右栏占满整行 */
	isPanelExpanded: boolean;
	/** 左栏此刻是否占列（宽档/中档下要么是意图，要么是中档预算留下的那一栏） */
	sidebarVisible: boolean;
	/** 右栏此刻是否占列 */
	panelVisible: boolean;
	/** 右栏分隔条的实时上限：给正文留够地方之后剩下的宽度 */
	panelMaxWidth: number;
	/**
	 * 右栏此刻实占的宽度（偏好宽被正文的约束压窄之后的值）。
	 *
	 * 分隔条与列轨道都用它：拖动起点与屏幕上看到的一致，不会一抓手就跳。
	 */
	panelEffectiveWidth: number;
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
	/** 右栏的状态：展开、开着哪些标签、宽度 */
	panel: RightPanelState;
	/** 变更页两栏里索引的偏好宽（落盘 `facet.workspace.listWidth`） */
	workspaceListWidth: number;
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
	/**
	 * 改右栏状态并写回本地。
	 *
	 * 收补丁或更新函数两种写法：更新函数用于「开着就切过去、没开就追加」这类要看当前状态
	 * 的改动（见 `addPanelTab` / `removePanelTab`）。
	 */
	updatePanel: (patch: PanelPatch) => void;
	/** 开关右栏：改意图位 */
	togglePanel: () => void;
	/** 打开一个工具并切过去；中档被折起时把预算让给它 */
	setPanelTab: (tab: RightPanelTab) => void;
	/** 关掉一个工具标签；最后一个关掉后右栏停在启动清单上，不跟着收起 */
	closePanelTab: (tab: RightPanelTab) => void;
	/** 改索引栏宽度并写回本地：拖动松手时提交一次 */
	updateWorkspaceListWidth: (next: number) => void;
	/** `⤢` 与 `⤡`：进出宽展开 */
	togglePanelExpanded: () => void;
	/** 应用本机界面缩放 */
	changeUiScale: (next: number) => void;
	/** 代码块主题，浅色与深色各取一份 */
	codeTheme: CodeThemeValue;
}
