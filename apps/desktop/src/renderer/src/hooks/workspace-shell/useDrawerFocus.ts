/**
 * 窄档两个抽屉：开合、Escape 与焦点归还。
 *
 * 同一时刻最多一个抽屉开着（互斥枚举，不是两个布尔量）；两份监听因此互不打扰。两处都走
 * 同一条判定（`shouldCloseDrawerOnEscape`）：`event.defaultPrevented` 已经是真就说明内层
 * 浮层（行内重命名、右键菜单、`text-menu`、`Modal`）先吃掉了这次按键，抽屉留在原地；有原生
 * `<dialog>` 开着时同理。一次 Escape 只关最内层。
 *
 * 焦点归还也在这一层：打开抽屉时记住当时聚焦的元素，关掉之后还给那个开关。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { type NarrowDrawer, toggleNarrowDrawer } from "../../drawer-state.ts";
import { readLayoutIsNarrow, subscribeLayout } from "../../layout-mode.ts";
import { useDrawerBehavior } from "../useDrawerBehavior.ts";
import type { DrawerHandle } from "./shell-types.ts";

export function useDrawerFocus(): DrawerHandle {
	/**
	 * 窄档里开着哪一个抽屉（两侧互斥）。临时视图，不写回宽档的意图位：窗口拉宽后仍按
	 * `panel.open` 与侧栏收起位平铺。
	 */
	const [narrowDrawer, setNarrowDrawer] = useState<NarrowDrawer | undefined>(undefined);
	const isNarrow = useSyncExternalStore(subscribeLayout, readLayoutIsNarrow);
	const isDrawerOpen = narrowDrawer === "sidebar";
	/** 右抽屉是否开着：只有窄档有抽屉，宽档与中档右栏一律占列 */
	const isPanelDrawerOpen = isNarrow && narrowDrawer === "panel";

	const closeDrawer = useCallback(() => setNarrowDrawer(undefined), []);
	const closePanelDrawer = useCallback(() => setNarrowDrawer(undefined), []);
	const toggleSidebarDrawer = useCallback(() => {
		setNarrowDrawer((current) => toggleNarrowDrawer(current, "sidebar"));
	}, []);
	const togglePanelDrawer = useCallback(() => {
		setNarrowDrawer((current) => toggleNarrowDrawer(current, "panel"));
	}, []);
	const openPanelDrawer = useCallback(() => setNarrowDrawer("panel"), []);

	// 离开窄档就把抽屉收掉：抽屉是窄档的临时视图，拉宽后由意图位接管
	useEffect(() => {
		if (!isNarrow) {
			setNarrowDrawer(undefined);
		}
	}, [isNarrow]);

	// 两个抽屉各挂一份 Escape 与焦点归还；同一时刻只有一个开着，所以两份互不打扰
	useDrawerBehavior({ isOpen: isDrawerOpen, onClose: closeDrawer });
	useDrawerBehavior({ isOpen: isPanelDrawerOpen, onClose: closePanelDrawer });

	return {
		isDrawerOpen,
		isPanelDrawerOpen,
		toggleSidebarDrawer,
		togglePanelDrawer,
		openPanelDrawer,
		closePanelDrawer,
		closeDrawer,
	};
}
