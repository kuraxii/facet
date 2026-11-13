/**
 * 窗口按钮。
 *
 * 系统标题栏已经去掉，但不再另做一条标题栏：三个按钮浮在窗口右上角，拖动区由页面顶部那条
 * 透明的 `.app-drag` 与侧栏头部承担。双击拖动区切换最大化由 Chromium 处理。浏览器里跑同一份
 * 界面时桥上没有这些方法，这组按钮不渲染。
 */
import { Copy, Minus, Square, X } from "lucide-react";
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

export function WindowControls({ controls }: { controls: WindowControls }) {
	const [isMaximized, setIsMaximized] = useState(false);

	useEffect(() => controls.onWindowState(setIsMaximized), [controls]);

	return (
		<header className="window-controls">
			<div className="window-controls-group">
				<button
					type="button"
					className="window-btn"
					aria-label="最小化"
					title="最小化"
					onClick={() => controls.minimize()}
				>
					<Minus size={14} strokeWidth={1.6} />
				</button>
				<button
					type="button"
					className="window-btn"
					aria-label={isMaximized ? "还原" : "最大化"}
					title={isMaximized ? "还原" : "最大化"}
					onClick={() => controls.toggleMaximize()}
				>
					{isMaximized ? <Copy size={13} strokeWidth={1.6} /> : <Square size={12} strokeWidth={1.6} />}
				</button>
				<button
					type="button"
					className="window-btn is-close"
					aria-label="关闭"
					title="关闭"
					onClick={() => controls.close()}
				>
					<X size={15} strokeWidth={1.6} />
				</button>
			</div>
		</header>
	);
}
