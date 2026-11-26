/**
 * 窗口按钮。
 *
 * 系统标题栏已经去掉，但不再另做一条标题栏：三个按钮浮在窗口右上角，拖动区由页面顶部那条
 * 透明的 `.app-drag` 与侧栏头部承担。双击拖动区切换最大化由 Chromium 处理。浏览器里跑同一份
 * 界面时桥上没有这些方法，这组按钮不渲染。
 */
import { useHoverTip, useI18n } from "@facet/ui";
import { useEffect, useState } from "react";

/** 标题栏需要的窗口动作，缺任一项就不渲染。 */
export interface WindowControls {
	minimize: () => void;
	toggleMaximize: () => void;
	close: () => void;
	onWindowState: (listener: (maximized: boolean) => void) => () => void;
}

/** 从宿主桥上取窗口动作；浏览器端没有，返回空。 */
export function readWindowControls(bridge: {
	minimize?: () => void;
	toggleMaximize?: () => void;
	close?: () => void;
	onWindowState?: (listener: (maximized: boolean) => void) => () => void;
}): WindowControls | undefined {
	const { minimize, toggleMaximize, close, onWindowState } = bridge;
	if (
		minimize === undefined ||
		toggleMaximize === undefined ||
		close === undefined ||
		onWindowState === undefined
	) {
		return undefined;
	}
	return { minimize, toggleMaximize, close, onWindowState };
}

/** 窗口最小化几何线形（1px 锐利折角，匹配 Windows 原生标题栏）。 */
function MinimizeGlyph() {
	return (
		<svg viewBox="0 0 10 10" className="window-btn-icon" aria-hidden="true">
			<path d="M 0 5 H 10" shapeRendering="crispEdges" />
		</svg>
	);
}

/** 窗口最大化 / 还原几何线形。 */
function MaximizeGlyph({ restored }: { restored: boolean }) {
	if (restored) {
		return (
			<svg viewBox="0 0 10 10" className="window-btn-icon" aria-hidden="true">
				<path d="M 2.5 2.5 V 0.5 H 9.5 V 7.5 H 7.5" shapeRendering="crispEdges" />
				<rect x="0.5" y="2.5" width="7" height="7" shapeRendering="crispEdges" />
			</svg>
		);
	}
	return (
		<svg viewBox="0 0 10 10" className="window-btn-icon" aria-hidden="true">
			<rect x="0.5" y="0.5" width="9" height="9" shapeRendering="crispEdges" />
		</svg>
	);
}

/** 窗口关闭几何线形。 */
function CloseGlyph() {
	return (
		<svg viewBox="0 0 10 10" className="window-btn-icon" aria-hidden="true">
			<path d="M 0.75 0.75 L 9.25 9.25 M 9.25 0.75 L 0.75 9.25" />
		</svg>
	);
}

export function WindowControls({ controls }: { controls: WindowControls }) {
	const { t } = useI18n();
	// 三个按钮共用一份悬浮提示：贴到窗口右上角，portal 出去不会被顶带裁掉
	const tip = useHoverTip();
	const [isMaximized, setIsMaximized] = useState(false);

	useEffect(() => controls.onWindowState(setIsMaximized), [controls]);

	return (
		<header className="window-controls">
			<div className="window-controls-group">
				<button
					type="button"
					className="window-btn"
					aria-label={t("window.minimize")}
					{...tip.handlers(t("window.minimize"))}
					onClick={() => controls.minimize()}
				>
					<MinimizeGlyph />
				</button>
				<button
					type="button"
					className="window-btn"
					aria-label={isMaximized ? t("window.restore") : t("window.maximize")}
					{...tip.handlers(isMaximized ? t("window.restore") : t("window.maximize"))}
					onClick={() => controls.toggleMaximize()}
				>
					<MaximizeGlyph restored={isMaximized} />
				</button>
				<button
					type="button"
					className="window-btn is-close"
					aria-label={t("window.close")}
					{...tip.handlers(t("window.close"))}
					onClick={() => controls.close()}
				>
					<CloseGlyph />
				</button>
			</div>
			{tip.render()}
		</header>
	);
}
