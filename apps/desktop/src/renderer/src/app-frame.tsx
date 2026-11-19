/**
 * 应用外壳。
 *
 * 顶部那条 36px 的带是一行真正的布局行：左边一格放侧栏头部，中间一格放左栏开关，右边一格
 * 放右栏开关、分页与窗口按钮。下面才是三栏正文。带上的格子宽度与正文三栏共用
 * `--sidebar-width` 与 `--panel-width` 两个变量，所以不会各算各的。
 *
 * 连接中与连不上的界面只放窗口按钮，否则无边框窗口没有关闭入口。浏览器里没有窗口动作，
 * 拖动区与按钮都不渲染。
 */
import { type ReactNode, useEffect, useRef } from "react";
import { bridge } from "./bridge.ts";
import { readWindowControls, WindowControls } from "./WindowControls.tsx";
export function AppFrame({
	children,
	chrome,
	sidebarWidth = "272px",
	panelWidth = "0px",
}: {
	children: ReactNode;
	/** 顶带里的内容；不给时这条带只放窗口按钮 */
	chrome?: ReactNode;
	/** 侧栏当前宽度，收起时是 0 */
	sidebarWidth?: string;
	/** 右栏当前宽度，收起时是 0 */
	panelWidth?: string;
}): ReactNode {
	const controls = readWindowControls(bridge);
	const appRef = useRef<HTMLDivElement>(null);

	// 宽度只用两个变量表达，写在根节点上；拖动分隔条时由右栏直接改这两个变量，不经过渲染
	useEffect(() => {
		const element = appRef.current;
		if (element === null) {
			return;
		}
		element.style.setProperty("--sidebar-width", sidebarWidth);
		element.style.setProperty("--panel-width", panelWidth);
	}, [sidebarWidth, panelWidth]);

	return (
		<div className="app" ref={appRef}>
			{controls === undefined ? null : <div className="app-drag" />}
			<div className="app-chrome">
				{chrome ?? (
					<>
						<div className="chrome-slot is-main" />
						<div className="chrome-slot is-panel is-compact">
							<span className="chrome-spacer" />
							{controls === undefined ? null : <WindowControls controls={controls} />}
						</div>
					</>
				)}
			</div>
			{children}
		</div>
	);
}
