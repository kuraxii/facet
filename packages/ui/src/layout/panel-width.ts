/**
 * 右栏宽度的写入口。
 *
 * `--panel-width` 注册成不继承：分隔条拖动时每帧改它，可继承的话 Chromium 会把整棵 `.app`
 * 子树都标成样式待重算——变更页展开大补丁时那是一万多个节点，单帧光重算样式就要十几毫秒。
 * 不继承之后失效只停在 `.app` 这一层，网格轨道直接由它派生。
 *
 * 顶带中格要让出窗口按钮簇，读的就是这个宽度；不继承的变量传不下去，所以在那一格上留一份
 * 局部副本（`--panel-track`）。两处必须同帧写同一个值，否则拖动时顶带的让位会跳。
 */
import { SHELL_DATA_ATTRS } from "./layout-contract.ts";

/** `.app` 上排轨道用的右栏宽度 */
export const PANEL_WIDTH_VAR = "--panel-width";

/** 顶带中格上的局部副本，只给它算让位用 */
export const PANEL_TRACK_VAR = "--panel-track";

/** 右栏顶格与本体上的不继承副本，供跨列右贴齐排版与平滑收起滑移读取 */
export const PANEL_BOX_WIDTH_VAR = "--panel-box-width";

/**
 * 写一次右栏宽度。
 *
 * `.app` 拿到不继承的那一份排网格轨道，顶带中格拿到自己的副本算内边距；拖动期间每帧调一次，
 * 都只是一次内联样式写，不经过 React。
 *
 * 副本写的是"这一列此刻实际占多宽"，不是偏好宽：右栏收起与拖动收起的预览里列轨道是 `0`，
 * 副本也必须归零，否则顶带中格会以为右栏还占着位置、不给窗口按钮簇让位。
 *
 * 相比之下，`.chrome-slot.is-panel` 与 `.panel` 拿到的 `--panel-box-width` 始终写开放态的目标宽
 * （不随收起归零），这样开关右栏时只需原地平移而不重排内部内容，展开/还原时从右往左覆盖主栏。
 */
export function writePanelWidth(app: HTMLElement, width: string): void {
	app.style.setProperty(PANEL_WIDTH_VAR, width);
	const collapsed =
		app.classList.contains("is-panel-hidden") ||
		app.getAttribute(SHELL_DATA_ATTRS.panelDragCollapsed) === "true";
	// 顶带中格是外壳契约里固定的一格（`workbench` 与 `app-frame` 都按这个类名渲染）
	app
		.querySelector<HTMLElement>(".chrome-slot.is-main")
		?.style.setProperty(PANEL_TRACK_VAR, collapsed ? "0px" : width);
	app.querySelector<HTMLElement>(".chrome-slot.is-panel")?.style.setProperty(PANEL_BOX_WIDTH_VAR, width);
	app.querySelector<HTMLElement>(".panel")?.style.setProperty(PANEL_BOX_WIDTH_VAR, width);
}
