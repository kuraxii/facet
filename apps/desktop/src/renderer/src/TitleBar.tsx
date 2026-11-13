/**
 * 自绘标题栏。
 *
 * 系统标题栏已经去掉，窗口的最小化、最大化、关闭由这里发 IPC 给主进程。整条栏是拖动区，
 * 按钮自己标 `no-drag`；双击栏空白处由 Chromium 处理成最大化切换。浏览器里跑同一份界面时
 * 桥上没有这些方法，整条栏不渲染。
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

export function TitleBar({ controls }: { controls: WindowControls }) {
	const [isMaximized, setIsMaximized] = useState(false);

	useEffect(() => controls.onWindowState(setIsMaximized), [controls]);

	return (
		<header className="titlebar">
			{/* 拖动区盖住整条栏，按钮压在它上面自己标 no-drag */}
			<div className="titlebar-drag" />
			<div className="titlebar-actions">
				<button
					type="button"
					className="titlebar-btn"
					aria-label="最小化"
					title="最小化"
					onClick={() => controls.minimize()}
				>
					<Minus size={14} strokeWidth={1.6} />
				</button>
				<button
					type="button"
					className="titlebar-btn"
					aria-label={isMaximized ? "还原" : "最大化"}
					title={isMaximized ? "还原" : "最大化"}
					onClick={() => controls.toggleMaximize()}
				>
					{isMaximized ? <Copy size={13} strokeWidth={1.6} /> : <Square size={12} strokeWidth={1.6} />}
				</button>
				<button
					type="button"
					className="titlebar-btn is-close"
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
