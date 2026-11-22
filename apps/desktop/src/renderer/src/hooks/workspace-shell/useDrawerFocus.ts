/**
 * 窄档侧栏抽屉：开合、Escape 与焦点归还。
 *
 * 只有左栏有抽屉。右栏在任何档位都占列，窄下去只是变窄，没有浮层形态。
 *
 * Escape 走 `shouldCloseDrawerOnEscape`：`event.defaultPrevented` 已经是真就说明内层浮层
 * （行内重命名、右键菜单、`text-menu`、`Modal`）先吃掉了这次按键，抽屉留在原地；有原生
 * `<dialog>` 开着时同理。一次 Escape 只关最内层。
 *
 * 焦点归还也在这一层：打开抽屉时记住当时聚焦的元素，关掉之后还给那个开关。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { readLayoutIsNarrow, subscribeLayout } from "../../layout-mode.ts";
import { useDrawerBehavior } from "../useDrawerBehavior.ts";
import type { DrawerHandle } from "./shell-types.ts";

export function useDrawerFocus(): DrawerHandle {
	/** 抽屉开没开。临时视图，不写回宽档的意图位：窗口拉宽后仍按侧栏收起位平铺 */
	const [isOpen, setOpen] = useState(false);
	const isNarrow = useSyncExternalStore(subscribeLayout, readLayoutIsNarrow);
	/** 只有窄档有抽屉，宽档与中档这一栏按意图占列 */
	const isDrawerOpen = isNarrow && isOpen;

	const closeDrawer = useCallback(() => setOpen(false), []);
	const toggleSidebarDrawer = useCallback(() => setOpen((current) => !current), []);

	// 离开窄档就把抽屉收掉：抽屉是窄档的临时视图，拉宽后由意图位接管
	useEffect(() => {
		if (!isNarrow) {
			setOpen(false);
		}
	}, [isNarrow]);

	useDrawerBehavior({ isOpen: isDrawerOpen, onClose: closeDrawer });

	return {
		isDrawerOpen,
		toggleSidebarDrawer,
		closeDrawer,
	};
}
