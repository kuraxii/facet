/**
 * 右栏（工作区）的状态。
 *
 * 只管「开着哪几个标签、停在哪个上面、多宽、要不要整行铺开」这几件事，以及它们的落盘：
 * 不知道档位、不知道抽屉、也不碰焦点。窄档与平铺的差别（抽屉 / 意图位）由 `useShellLayout`
 * 组合，这里给出的都是与档位无关的原子动作。
 */
import {
	openPanelTab as addPanelTab,
	clampWorkspaceListWidth,
	normalizePanelState,
	type RightPanelState,
	type RightPanelTab,
	readPanelState,
	readWorkspaceListWidth,
	closePanelTab as removePanelTab,
	writePanelState,
	writeWorkspaceListWidth,
} from "@facet/ui";
import { useCallback, useLayoutEffect, useState } from "react";

/** 一次右栏改动：补丁，或者按当前状态算出下一份状态。 */
export type PanelPatch = Partial<RightPanelState> | ((state: RightPanelState) => RightPanelState);

/** 右栏状态的参数。 */
export interface WorkspacePanelsOptions {
	/** 用户主动开右栏、调宽或增删标签：中档预算不够时保留的应该是这一栏 */
	onActivate: () => void;
}

/** 右栏状态与它的原子动作。 */
export interface WorkspacePanels {
	/** 展开、开着哪些标签、宽度 */
	panel: RightPanelState;
	/** `⤢` 宽展开：临时视图位，不落盘 */
	isPanelExpanded: boolean;
	/** 变更页两栏里索引的偏好宽 */
	workspaceListWidth: number;
	/** 改状态并写回本地存储 */
	update: (patch: PanelPatch) => void;
	/** 打开一个工具并切过去（不看档位） */
	openTab: (tab: RightPanelTab) => void;
	/** 关掉一个标签（不看档位） */
	closeTab: (tab: RightPanelTab) => void;
	/** 改「想不想开」，不碰标签集合 */
	setOpen: (open: boolean) => void;
	/** 进出宽展开 */
	toggleExpanded: () => void;
	/** 退出宽展开（进窄档、右栏收起时用） */
	collapseExpanded: () => void;
	/** 改索引栏宽度并落盘：拖动松手时提交一次 */
	updateWorkspaceListWidth: (next: number) => void;
}

export function useWorkspacePanels({ onActivate }: WorkspacePanelsOptions): WorkspacePanels {
	const [panel, setPanel] = useState<RightPanelState>(() => readPanelState(localStorage));
	const [isPanelExpanded, setIsPanelExpanded] = useState(false);
	const [workspaceListWidth, setWorkspaceListWidth] = useState(() =>
		readWorkspaceListWidth(window.localStorage),
	);

	/*
	 * 索引栏的偏好宽写在根节点上。
	 *
	 * 拖动期间分隔条把同一个变量写在 `.app` 上——更近的祖先赢，拖动即时、不经过渲染；松手
	 * 提交之后这里把根节点对齐到同一个值，两者不会打架。
	 */
	useLayoutEffect(() => {
		document.documentElement.style.setProperty("--workspace-list-width", `${workspaceListWidth}px`);
	}, [workspaceListWidth]);

	const update = useCallback(
		(patch: PanelPatch) => {
			// 手动打开、调宽、增减标签都算主动交互：优先级换到右栏，预算不够时折起左栏
			if (typeof patch === "function" || patch.open === true || patch.width !== undefined) {
				onActivate();
			}
			setPanel((current) => {
				const next = normalizePanelState(
					typeof patch === "function" ? patch(current) : { ...current, ...patch },
				);
				writePanelState(localStorage, next);
				return next;
			});
		},
		[onActivate],
	);

	const openTab = useCallback(
		(tab: RightPanelTab) => {
			update((current) => addPanelTab(current, tab));
		},
		[update],
	);

	const closeTab = useCallback(
		(tab: RightPanelTab) => {
			update((current) => removePanelTab(current, tab));
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

	const updateWorkspaceListWidth = useCallback((next: number) => {
		const width = clampWorkspaceListWidth(next);
		setWorkspaceListWidth(width);
		writeWorkspaceListWidth(window.localStorage, width);
	}, []);

	return {
		panel,
		isPanelExpanded,
		workspaceListWidth,
		update,
		openTab,
		closeTab,
		setOpen,
		toggleExpanded,
		collapseExpanded,
		updateWorkspaceListWidth,
	};
}
