/**
 * 右栏开合过渡的挂载生命周期。
 *
 * 与 `.app` 上的 `--dur-structural` 同步：打开时立刻挂载并标出 `isAnimating`（让组件在
 * 列宽从 `0` 长到目标值的过程中维持固定内容宽，避免终端与容器查询每帧抖动）；关闭时
 * 延迟到网格列过渡收拢完成（或无动效环境立即完成）后再卸载。
 */
import { SHELL_DATA_ATTRS } from "@facet/ui";
import { type RefObject, useEffect, useState } from "react";
import {
	initialPanelPresence,
	type PanelPresence,
	type PanelPresencePhase,
	parseCssDurationMs,
	settlePanelPresence,
	shouldSkipPanelTransition,
	transitionPanelPresence,
} from "./panel-presence.ts";

/** `transitionend` 未能如期到达时的兜底冗余（ms）。 */
const TRANSITION_FALLBACK_SLACK_MS = 60;

/** 提前容差：120Hz/60Hz 刷新对齐时 `transitionend` 可能早于标称时长几毫秒到达。 */
const TRANSITION_EARLY_TOLERANCE_MS = 24;

export function usePanelPresence(
	visible: boolean,
	containerRef: RefObject<HTMLElement | null>,
): PanelPresence {
	const [prevVisible, setPrevVisible] = useState(visible);
	const [phase, setPhase] = useState<PanelPresencePhase>(() => initialPanelPresence(visible));

	if (visible !== prevVisible) {
		setPrevVisible(visible);
		setPhase((current) => transitionPanelPresence(current, visible));
	}

	useEffect(() => {
		if (phase !== "entering" && phase !== "closing") {
			return;
		}
		const app = containerRef.current?.closest<HTMLElement>(".app") ?? containerRef.current;
		const rawDuration = getComputedStyle(document.documentElement).getPropertyValue("--dur-structural");
		const durationMs = parseCssDurationMs(rawDuration);
		const isWindowResizing = document.documentElement.hasAttribute("data-window-resizing");
		const isDragCollapsed = app?.getAttribute(SHELL_DATA_ATTRS.panelDragCollapsed) === "true";

		const settle = (): void => {
			setPhase((current) => settlePanelPresence(current));
		};

		if (shouldSkipPanelTransition({ durationMs, isWindowResizing, isDragCollapsed })) {
			settle();
			return;
		}

		const startedAt = performance.now();
		let finished = false;
		const finish = (): void => {
			if (finished) {
				return;
			}
			finished = true;
			settle();
		};

		const onTransitionEnd = (event: TransitionEvent): void => {
			if (event.target !== app || event.propertyName !== "grid-template-columns") {
				return;
			}
			// 另一侧栏同时收拢时可能更早触发 `transitionend`，未接近本轮时长时不提前收尾
			if (performance.now() - startedAt < durationMs - TRANSITION_EARLY_TOLERANCE_MS) {
				return;
			}
			finish();
		};

		app?.addEventListener("transitionend", onTransitionEnd);
		const timer = window.setTimeout(finish, durationMs + TRANSITION_FALLBACK_SLACK_MS);
		return () => {
			app?.removeEventListener("transitionend", onTransitionEnd);
			window.clearTimeout(timer);
		};
	}, [phase, containerRef]);

	return {
		phase,
		mounted: phase !== "closed",
		isAnimating: phase === "entering" || phase === "closing",
	};
}
