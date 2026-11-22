// @vitest-environment jsdom
/**
 * 分隔条的拖收关闭。
 *
 * 交互全在指针事件上，所以真的挂一棵 DOM：跨过阈值挂上折叠预览属性、把变量停在 `min`；
 * 拉回阈值之外立刻摘掉属性并重新跟手；松手时若仍在待关闭态就收起这一栏且**不提交**宽度；
 * 取消与中途卸载只还原、不关闭。
 *
 * jsdom 没有 PointerEvent，也没有指针捕获：这里用 `MouseEvent` 派发同名事件，并把捕获的
 * 三个方法补成空实现——组件要的就是「捕获成功」这个前提，不测浏览器自己的捕获行为。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { SHELL_DATA_ATTRS } from "../layout/layout-contract.ts";
import { PaneResizer, type PaneResizerProps } from "./pane-resizer.tsx";

/** 左栏的边界与拖收阈值：220 / 2 = 110。 */
const MIN = 220;
const MAX = 420;
const THRESHOLD = MIN / 2;
/** 折叠预览属性：与 `SessionSidebar` 传给分隔条的是同一个名字。 */
const PREVIEW_ATTR = SHELL_DATA_ATTRS.sidebarDragCollapsed;

beforeAll(() => {
	for (const name of ["setPointerCapture", "releasePointerCapture"]) {
		Object.defineProperty(HTMLElement.prototype, name, { value: () => {}, configurable: true });
	}
	Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
		value: () => true,
		configurable: true,
	});
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let unmount: (() => void) | undefined;

afterEach(() => {
	act(() => unmount?.());
	unmount = undefined;
	document.body.innerHTML = "";
});

/** 挂一条分隔条，返回 `.app`、`hr` 与本轮的回调。 */
function mount(patch: Partial<PaneResizerProps> = {}): {
	app: HTMLDivElement;
	pane: HTMLDivElement;
	handle: HTMLHRElement;
	unmount: () => void;
	onWidthChange: ReturnType<typeof vi.fn>;
	onCollapse: ReturnType<typeof vi.fn>;
} {
	const app = document.createElement("div");
	app.className = "app";
	const pane = document.createElement("div");
	pane.className = "sb";
	app.append(pane);
	document.body.append(app);

	const onWidthChange = vi.fn();
	const onCollapse = vi.fn();
	const root = createRoot(pane);
	act(() => {
		root.render(
			<I18nProvider language="zh-CN">
				<PaneResizer
					className="sb-resizer"
					label="调整左侧栏宽度"
					width={272}
					min={MIN}
					max={MAX}
					cssVar="--sidebar-width"
					side="end"
					onWidthChange={onWidthChange}
					collapseThreshold={THRESHOLD}
					onCollapse={onCollapse}
					collapsePreviewAttr={PREVIEW_ATTR}
					{...patch}
				/>
			</I18nProvider>,
		);
	});
	unmount = () => root.unmount();

	const handle = pane.querySelector<HTMLHRElement>(".sb-resizer");
	if (handle === null) {
		throw new Error("没渲染出分隔条");
	}
	return { app, pane, handle, unmount, onWidthChange, onCollapse };
}

/** 派发一个指针事件；jsdom 没有 PointerEvent，用同名 MouseEvent 顶替。 */
function pointer(node: HTMLElement, type: string, clientX: number): void {
	act(() => {
		node.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }));
	});
}

/** 从 272 往左拖到某个目标宽（`side: "end"`：往左是变窄）。 */
function dragTo(handle: HTMLElement, targetWidth: number): void {
	pointer(handle, "pointermove", 400 - (272 - targetWidth));
}

describe("拖动期间冻结过渡", () => {
	it("按下挂上标记，松手摘掉", () => {
		const { handle } = mount();
		expect(document.documentElement.hasAttribute("data-window-resizing")).toBe(false);

		pointer(handle, "pointerdown", 400);
		expect(document.documentElement.getAttribute("data-window-resizing")).toBe("");

		pointer(handle, "pointerup", 400);
		expect(document.documentElement.hasAttribute("data-window-resizing")).toBe(false);
	});

	it("中途取消与卸载都不会把标记留在页面上", () => {
		const cancelled = mount();
		pointer(cancelled.handle, "pointerdown", 400);
		pointer(cancelled.handle, "pointercancel", 400);
		expect(document.documentElement.hasAttribute("data-window-resizing")).toBe(false);
		act(() => cancelled.unmount());

		const dropped = mount();
		pointer(dropped.handle, "pointerdown", 400);
		act(() => dropped.unmount());
		expect(document.documentElement.hasAttribute("data-window-resizing")).toBe(false);
	});
});

describe("分隔条的拖收关闭", () => {
	it("缩进阈值内实时挂上折叠预览，显示宽度停在 min", () => {
		const { app, handle } = mount();
		pointer(handle, "pointerdown", 400);
		dragTo(handle, 105);

		expect(handle.dataset.collapsePending).toBe("true");
		expect(app.getAttribute(PREVIEW_ATTR)).toBe("true");
		// 变量停在 min，而不是 105：列轨道由预览属性单独摁到 0
		expect(app.style.getPropertyValue("--sidebar-width")).toBe(`${MIN}px`);
	});

	it("拉回阈值之外立刻摘掉预览，宽度重新跟手", () => {
		const { app, handle } = mount();
		pointer(handle, "pointerdown", 400);
		dragTo(handle, 105);
		expect(app.getAttribute(PREVIEW_ATTR)).toBe("true");

		dragTo(handle, 240);
		expect(handle.dataset.collapsePending).toBeUndefined();
		expect(app.hasAttribute(PREVIEW_ATTR)).toBe(false);
		expect(app.style.getPropertyValue("--sidebar-width")).toBe("240px");
	});

	it("拖到一半被卸载：还原变量并摘掉预览属性", () => {
		const { app, handle, unmount: unmountPane } = mount();
		pointer(handle, "pointerdown", 400);
		dragTo(handle, 105);
		expect(app.getAttribute(PREVIEW_ATTR)).toBe("true");

		act(() => unmountPane());
		expect(app.hasAttribute(PREVIEW_ATTR)).toBe(false);
		expect(app.style.getPropertyValue("--sidebar-width")).toBe("272px");
	});

	it("在待关闭态松手：先落收起、再摘预览，且不提交那个宽度", () => {
		// 收起落地那一刻预览属性必须还在，否则松手那一帧会闪回一次原宽度
		const duringCollapse: boolean[] = [];
		let appRef: HTMLDivElement | undefined;
		const { app, handle, onWidthChange } = mount({
			onCollapse: () => {
				duringCollapse.push(appRef?.hasAttribute(PREVIEW_ATTR) === true);
			},
		});
		appRef = app;
		pointer(handle, "pointerdown", 400);
		dragTo(handle, 100);
		pointer(handle, "pointerup", 400 - (272 - 100));

		expect(duringCollapse).toEqual([true]);
		expect(app.hasAttribute(PREVIEW_ATTR)).toBe(false);
		expect(onWidthChange).not.toHaveBeenCalled();
		// 变量还原成这次拖动的起点：下次打开还是原来那份偏好宽
		expect(app.style.getPropertyValue("--sidebar-width")).toBe("272px");
		expect(handle.dataset.collapsePending).toBeUndefined();
	});

	it("拉回之后再松手：照常提交新宽度，不关闭", () => {
		const { app, handle, onWidthChange, onCollapse } = mount();
		pointer(handle, "pointerdown", 400);
		dragTo(handle, 100);
		dragTo(handle, 260);
		pointer(handle, "pointerup", 400 - (272 - 260));

		expect(onCollapse).not.toHaveBeenCalled();
		expect(onWidthChange).toHaveBeenCalledWith(260);
		expect(app.style.getPropertyValue("--sidebar-width")).toBe("260px");
		expect(app.hasAttribute(PREVIEW_ATTR)).toBe(false);
	});

	it("拖动被取消：只还原变量与属性，不关闭也不提交", () => {
		const { app, handle, onWidthChange, onCollapse } = mount();
		pointer(handle, "pointerdown", 400);
		dragTo(handle, 100);
		pointer(handle, "pointercancel", 400 - (272 - 100));

		expect(onCollapse).not.toHaveBeenCalled();
		expect(onWidthChange).not.toHaveBeenCalled();
		expect(app.style.getPropertyValue("--sidebar-width")).toBe("272px");
		expect(app.hasAttribute(PREVIEW_ATTR)).toBe(false);
	});

	it("不给阈值时不会进待关闭态，缩过头只钳到 min", () => {
		const { app, handle, onWidthChange, onCollapse } = mount({
			collapseThreshold: undefined,
			onCollapse: undefined,
		});
		pointer(handle, "pointerdown", 400);
		dragTo(handle, 100);

		expect(handle.dataset.collapsePending).toBeUndefined();
		expect(app.hasAttribute(PREVIEW_ATTR)).toBe(false);
		expect(app.style.getPropertyValue("--sidebar-width")).toBe(`${MIN}px`);

		pointer(handle, "pointerup", 400 - (272 - 100));
		expect(onCollapse).not.toHaveBeenCalled();
		expect(onWidthChange).toHaveBeenCalledWith(MIN);
	});

	it("阈值边界是闭区间：正好等于 min / 2 也算待关闭", () => {
		const { app, handle } = mount();
		pointer(handle, "pointerdown", 400);
		dragTo(handle, THRESHOLD);
		expect(app.getAttribute(PREVIEW_ATTR)).toBe("true");

		dragTo(handle, THRESHOLD + 1);
		expect(app.hasAttribute(PREVIEW_ATTR)).toBe(false);
	});
});
