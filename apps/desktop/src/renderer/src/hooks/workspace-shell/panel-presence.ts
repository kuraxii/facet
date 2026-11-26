/**
 * 右栏开关显隐的纯状态与时间判定。
 *
 * 右栏打开/关闭动画期间需要保留 DOM（打开时保持内容宽度锁住重排，关闭时等网格列收拢完
 * 成再卸载），同时在无动效、拖拽与单元测试环境里立即收尾。
 */

/** 右栏显隐与动画阶段。 */
export type PanelPresencePhase = "open" | "entering" | "closing" | "closed";

/** `usePanelPresence` 对外暴露的呈现状态。 */
export interface PanelPresence {
	/** 当前阶段 */
	readonly phase: PanelPresencePhase;
	/** 是否仍需挂载到 DOM 中 */
	readonly mounted: boolean;
	/** 是否处于开合过渡期内 */
	readonly isAnimating: boolean;
}

/** 初始可见性映射到初始阶段：初始即关时不经历退场，初始即开时不经历进场。 */
export function initialPanelPresence(visible: boolean): PanelPresencePhase {
	return visible ? "open" : "closed";
}

/** 目标可见性变化时推进阶段；逆转中的动画直接反切，不中断复用既有节点。 */
export function transitionPanelPresence(current: PanelPresencePhase, visible: boolean): PanelPresencePhase {
	if (visible) {
		return current === "closed" || current === "closing" ? "entering" : current;
	}
	return current === "open" || current === "entering" ? "closing" : current;
}

/** 过渡结束时落定到静态阶段。 */
export function settlePanelPresence(current: PanelPresencePhase): PanelPresencePhase {
	if (current === "entering") {
		return "open";
	}
	if (current === "closing") {
		return "closed";
	}
	return current;
}

/** 把 CSS 时长值（`320ms` / `0.32s`）解析为毫秒；无效或负值一律归零。 */
export function parseCssDurationMs(raw: string): number {
	const value = raw.trim();
	if (value.endsWith("ms")) {
		const num = Number.parseFloat(value.slice(0, -2));
		return Number.isFinite(num) && num > 0 ? num : 0;
	}
	if (value.endsWith("s")) {
		const num = Number.parseFloat(value.slice(0, -1));
		return Number.isFinite(num) && num > 0 ? num * 1000 : 0;
	}
	return 0;
}

/** 判定当前这一步应不应该跳过异步等待、直接落定。 */
export function shouldSkipPanelTransition(input: {
	/** 根样式上的结构过渡时长（ms） */
	readonly durationMs: number;
	/** 是否正处在分隔条或窗口缩放冻结中 */
	readonly isWindowResizing: boolean;
	/** 右栏是否已被拖收预览折成 0 宽 */
	readonly isDragCollapsed: boolean;
}): boolean {
	return input.durationMs <= 0 || input.isWindowResizing || input.isDragCollapsed;
}
