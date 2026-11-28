/**
 * 右栏（工作区）的状态。
 *
 * 只管「开着哪几个标签、停在哪个上面、多宽、要不要整行铺开」这几件事：
 * - 右栏宽度与定宽视口基准持久化在本地存储里；
 * - 右栏开合、已打开的标签集合与激活项仅随具体会话保存在内存快照中，不落盘；
 *   会话被后台回收后其条目会被清理，再次打开该会话时需要重新打开侧栏与标签。
 */
import {
	openPanelTab as addPanelTab,
	DEFAULT_PANEL_TAB_STATE,
	normalizePanelState,
	type PanelTabState,
	type PanelWidthState,
	type RightPanelState,
	type RightPanelTab,
	readStoredPanelWidth,
	closePanelTab as removePanelTab,
	reorderPanelTabs as sortPanelTabs,
	writeStoredPanelWidth,
} from "@facet/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScopedStorage } from "../../local-storage.ts";
import {
	getSessionWorkspaceState,
	type HostWorkspaceSnapshot,
	setSessionWorkspacePanel,
} from "../../workspace-state.ts";

/** 一次右栏改动：补丁，或者按当前状态算出下一份状态。 */
export type PanelPatch = Partial<RightPanelState> | ((state: RightPanelState) => RightPanelState);

/** `useWorkspacePanels` 的参数。 */
export interface WorkspacePanelsOptions {
	/** 按主机隔离的本地存储（仅保存宽度偏好） */
	storage: ScopedStorage;
	/** 当前激活会话的键 */
	sessionKey: string;
	/** 所属主机的内存工作区快照 */
	snapshot: HostWorkspaceSnapshot;
	/** 外部回收清理快照后递增的版本号，触发读取最新映射 */
	workspaceRevision?: number;
}

/** 右栏状态与它的原子动作。 */
export interface WorkspacePanels {
	/** 展开、开着哪些标签、宽度 */
	panel: RightPanelState;
	/** `⤢` 宽展开：临时视图位，不落盘 */
	isPanelExpanded: boolean;
	/** 改状态（宽度写回本地存储，标签页与开合仅写当前会话内存） */
	update: (patch: PanelPatch, targetSessionKey?: string) => void;
	/** 打开一个工具并切过去（不看档位） */
	openTab: (tab: RightPanelTab, targetSessionKey?: string) => void;
	/** 关掉一个标签（不看档位） */
	closeTab: (tab: RightPanelTab) => void;
	/** 按给定顺序重排已打开的标签 */
	reorderTabs: (tabs: readonly RightPanelTab[]) => void;
	/** 改「想不想开」，不碰标签集合 */
	setOpen: (open: boolean) => void;
	/** 进出宽展开 */
	toggleExpanded: () => void;
	/** 退出宽展开（进窄档、右栏收起时用） */
	collapseExpanded: () => void;
}

export function useWorkspacePanels({
	storage,
	sessionKey,
	snapshot,
	workspaceRevision = 0,
}: WorkspacePanelsOptions): WorkspacePanels {
	const [widthState, setWidthState] = useState<PanelWidthState>(() => readStoredPanelWidth(storage));
	const [isPanelExpanded, setIsPanelExpanded] = useState(false);
	const [, bump] = useState(0);
	const widthRef = useRef(widthState);
	widthRef.current = widthState;
	const sessionKeyRef = useRef(sessionKey);
	sessionKeyRef.current = sessionKey;

	useEffect(() => {
		void workspaceRevision;
		bump((n) => n + 1);
	}, [workspaceRevision]);

	const tabState: PanelTabState = getSessionWorkspaceState(snapshot, sessionKey).panel;
	const panel: RightPanelState = { ...tabState, ...widthState };

	const update = useCallback(
		(patch: PanelPatch, targetSessionKey?: string) => {
			const targetKey = targetSessionKey ?? sessionKeyRef.current;
			const currentWidth = widthRef.current;
			const currentTab = snapshot.sessions.get(targetKey)?.panel ?? DEFAULT_PANEL_TAB_STATE;
			const current: RightPanelState = { ...currentTab, ...currentWidth };
			const rawNext = typeof patch === "function" ? patch(current) : { ...current, ...patch };
			const normalizedTab = normalizePanelState({
				open: rawNext.open,
				openTabs: rawNext.openTabs,
				activeTab: rawNext.activeTab,
			});
			setSessionWorkspacePanel(snapshot, targetKey, normalizedTab);
			/*
			 * 宽度变了才写入本地存储并记录当时的窗口宽：此后窗口每少一像素，右栏先还回一像素
			 * （`fitPanelWidth` 的「拖动优先」）。标签页与开合变动不碰磁盘。
			 */
			if (rawNext.width !== currentWidth.width || rawNext.widthViewport !== currentWidth.widthViewport) {
				const nextWidth: PanelWidthState = {
					width: rawNext.width,
					widthViewport:
						rawNext.width !== currentWidth.width ? Math.round(window.innerWidth) : rawNext.widthViewport,
				};
				widthRef.current = nextWidth;
				setWidthState(nextWidth);
				writeStoredPanelWidth(storage, nextWidth);
			}
			bump((n) => n + 1);
		},
		[snapshot, storage],
	);

	const openTab = useCallback(
		(tab: RightPanelTab, targetSessionKey?: string) => {
			update((current) => addPanelTab(current, tab), targetSessionKey);
		},
		[update],
	);

	const closeTab = useCallback(
		(tab: RightPanelTab) => {
			update((current) => removePanelTab(current, tab));
		},
		[update],
	);

	const reorderTabs = useCallback(
		(tabs: readonly RightPanelTab[]) => {
			update((current) => sortPanelTabs(current, tabs));
		},
		[update],
	);

	const setOpen = useCallback(
		(open: boolean) => {
			update({ open });
		},
		[update],
	);

	const toggleExpanded = useCallback(() => {
		setIsPanelExpanded((current) => !current);
	}, []);

	const collapseExpanded = useCallback(() => {
		setIsPanelExpanded(false);
	}, []);

	return {
		panel,
		isPanelExpanded,
		update,
		openTab,
		closeTab,
		reorderTabs,
		setOpen,
		toggleExpanded,
		collapseExpanded,
	};
}
