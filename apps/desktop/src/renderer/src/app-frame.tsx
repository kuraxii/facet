/**
 * 应用外壳。
 *
 * 顶带那一行与下面的正文行在同一个 CSS Grid 里，共享同一组列轨道（详见 `docs/layout.md`）：
 * `.app` 决定三列的实占宽，`.app-chrome` 与 `.shell` 用 `subgrid` 继承同一组轨道，顶带里
 * 不再有第二份宽度计算。实占宽 `--col-sidebar` / `--col-panel` 由偏好宽
 * `--sidebar-width` / `--panel-width` 在样式表里派生，这里只写偏好宽。
 *
 * 窗口按钮是右上角的固定簇，不占轨道：右栏收起或进抽屉时它都留在原地，顶带中格靠
 * `padding-inline-end` 给它让位（见 `chrome.css`）。它是 `.app` 的直接子元素，不放进
 * 顶带——顶带自带一层层叠上下文，放进去就浮不到抽屉之上了。
 *
 * 连接中与连不上的界面只有窗口按钮，否则无边框窗口没有关闭入口。浏览器里没有窗口动作，
 * 拖动区与按钮都不渲染。
 */
import { type ReactNode, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { bridge } from "./bridge.ts";
import { layoutClassName, readLayoutIsNarrow, subscribeLayout } from "./layout-mode.ts";
import { readWindowControls, WindowControls } from "./WindowControls.tsx";

/**
 * 外壳类名：档位 + 两栏显隐。
 *
 * 显隐是同一条路的终点：手动收起、窄档抽屉、中档预算折起，最后都表现为这两个类名，
 * 样式里也只靠它们把列轨道归零（见 `chrome.css`）。
 */
function appClassName(
	isNarrow: boolean,
	sidebarVisible: boolean,
	panelVisible: boolean,
	panelExpanded: boolean,
): string {
	const names = ["app", layoutClassName(isNarrow)];
	if (!sidebarVisible) {
		names.push("is-sidebar-hidden");
	}
	if (!panelVisible) {
		names.push("is-panel-hidden");
	}
	// 宽展开：列宽公式在样式里（`chrome.css` 的 `.is-panel-expanded`），这里只挂类名
	if (panelExpanded) {
		names.push("is-panel-expanded");
	}
	return names.join(" ");
}

export function AppFrame({
	children,
	chrome,
	sidebarWidth = "0px",
	panelWidth = "0px",
	sidebarVisible = true,
	panelVisible = true,
	panelExpanded = false,
}: {
	children: ReactNode;
	/** 顶带里的内容；不给时这条带只放窗口按钮 */
	chrome?: ReactNode;
	/** 侧栏当前宽度，收起时是 0 */
	sidebarWidth?: string;
	/** 右栏当前宽度，收起时是 0 */
	panelWidth?: string;
	/** 左栏此刻是否占列；不给时按占列处理 */
	sidebarVisible?: boolean;
	/** 右栏此刻是否占列；不给时按占列处理 */
	panelVisible?: boolean;
	/** 右栏是不是在 `⤢` 宽展开里：左栏临时让位、右栏整行 */
	panelExpanded?: boolean;
}): ReactNode {
	const controls = readWindowControls(bridge);
	const appRef = useRef<HTMLDivElement>(null);
	// 档位与首帧同步取：`useSyncExternalStore` 在首次渲染时读的就是当前档位，不会先画一帧宽屏
	const isNarrow = useSyncExternalStore(subscribeLayout, readLayoutIsNarrow);

	// 宽度只用两个变量表达，写在根节点上；拖动分隔条时由右栏直接改这两个变量，不经过渲染。
	// 用 layout effect 而不是 effect：首帧就要按存盘的宽度排版，否则会先按缺省宽度闪一下
	useLayoutEffect(() => {
		const element = appRef.current;
		if (element === null) {
			return;
		}
		element.style.setProperty("--sidebar-width", sidebarWidth);
		element.style.setProperty("--panel-width", panelWidth);
	}, [sidebarWidth, panelWidth]);

	return (
		<div className={appClassName(isNarrow, sidebarVisible, panelVisible, panelExpanded)} ref={appRef}>
			{controls === undefined ? null : <div className="app-drag" />}
			<div className="app-chrome">{chrome ?? <div className="chrome-slot is-main" />}</div>
			{/*
			 * 窗口按钮簇直接挂在 `.app` 下：顶带带 `--z-chrome` 自成一层次，
			 * 放在里面的话 `--z-window-controls` 会被锁在那一层，压不过遮罩与抽屉。
			 */}
			{controls === undefined ? null : <WindowControls controls={controls} />}
			{children}
		</div>
	);
}
