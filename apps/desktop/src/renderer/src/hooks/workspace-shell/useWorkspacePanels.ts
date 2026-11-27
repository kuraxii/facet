/**
 * 右栏（工作区）的状态。
 *
 * 只管「开着哪几个标签、停在哪个上面、多宽、要不要整行铺开」这几件事，以及它们的落盘：
 * 不知道档位、也不碰焦点。空间怎么分（让位顺序、预算折叠）由 `useShellLayout` 组合，这里
 * 给出的都是与档位无关的原子动作。
 */
import {
	openPanelTab as addPanelTab,
	normalizePanelState,
	type RightPanelState,
	type RightPanelTab,
	readPanelState,
	closePanelTab as removePanelTab,
	writePanelState,
} from "@facet/ui";
import { useCallback, useState } from "react";
import type { ScopedStorage } from "../../local-storage.ts";

/** 一次右栏改动：补丁，或者按当前状态算出下一份状态。 */
export type PanelPatch = Partial<RightPanelState> | ((state: RightPanelState) => RightPanelState);

/** 右栏状态与它的原子动作。 */
export interface WorkspacePanels {
	/** 展开、开着哪些标签、宽度 */
	panel: RightPanelState;
	/** `⤢` 宽展开：临时视图位，不落盘 */
	isPanelExpanded: boolean;
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
}

export function useWorkspacePanels(storage: ScopedStorage): WorkspacePanels {
	const [panel, setPanel] = useState<RightPanelState>(() => readPanelState(storage));
	const [isPanelExpanded, setIsPanelExpanded] = useState(false);
	const update = useCallback(
		(patch: PanelPatch) => {
			setPanel((current) => {
				const next = normalizePanelState(
					typeof patch === "function" ? patch(current) : { ...current, ...patch },
				);
				/*
				 * 宽度变了就记下当时的窗口宽：此后窗口每少一像素，右栏先还回一像素（`fitPanelWidth`
				 * 的「拖动优先」）。别的补丁不动这条基准，否则切个标签就把用户挑宽的基准冲掉了。
				 */
				const stamped =
					next.width === current.width ? next : { ...next, widthViewport: Math.round(window.innerWidth) };
				writePanelState(storage, stamped);
				return stamped;
			});
		},
		[storage],
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

	return {
		panel,
		isPanelExpanded,
		update,
		openTab,
		closeTab,
		setOpen,
		toggleExpanded,
		collapseExpanded,
	};
}
