// @vitest-environment jsdom
/**
 * 工作区标签栏。
 *
 * 纯展示组件，交互全部落在按钮上，所以这里要真的挂一棵 DOM：点击切换、关闭、方向键切换、
 * 滚轮横向滚动与无障碍属性都按用户看得见的行为断言，而不是只看静态标记。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import {
	WorkspaceTabBar,
	type WorkspaceTabBarProps,
	type WorkspaceTabId,
	type WorkspaceTabItem,
} from "./workspace-tab-bar.tsx";

/** 三条标签：文件、变更（带计数）、终端。 */
const ITEMS: readonly WorkspaceTabItem[] = [
	{ id: "files", label: "文件", icon: <span data-icon="files" /> },
	{ id: "changes", label: "变更", icon: <span data-icon="changes" />, badge: 3 },
	{ id: "terminal", label: "终端", icon: <span data-icon="terminal" /> },
];

beforeAll(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let unmount: (() => void) | undefined;

afterEach(() => {
	act(() => unmount?.());
	unmount = undefined;
	document.body.innerHTML = "";
	// 滑动动画的开关是根节点上的设置项，测完还原，别带到别的用例
	delete document.documentElement.dataset.motion;
});

/** 关掉滑动动画：位置断言就不用一帧帧等。 */
function withoutMotion(): void {
	document.documentElement.dataset.motion = "reduced";
}

/** 让出几帧，等滑动动画走完。 */
async function frames(count: number): Promise<void> {
	for (let index = 0; index < count; index += 1) {
		await act(async () => {
			await new Promise((resolve) => {
				requestAnimationFrame(() => resolve(undefined));
			});
		});
	}
}

/** 挂一棵标签栏。 */
function mount(props: Partial<WorkspaceTabBarProps> = {}): {
	container: HTMLDivElement;
	onSelect: ReturnType<typeof vi.fn>;
	onClose: ReturnType<typeof vi.fn>;
	onReorder: ReturnType<typeof vi.fn>;
	rerender: (next: Partial<WorkspaceTabBarProps>) => void;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const onSelect = vi.fn();
	const onClose = vi.fn();
	const onReorder = vi.fn();
	const root = createRoot(container);
	const show = (next: Partial<WorkspaceTabBarProps>): void => {
		act(() => {
			root.render(
				<I18nProvider language="zh-CN">
					<WorkspaceTabBar
						items={ITEMS}
						activeId="files"
						onSelect={onSelect}
						onClose={onClose}
						onReorder={onReorder}
						{...next}
					/>
				</I18nProvider>,
			);
		});
	};
	show(props);
	unmount = () => root.unmount();
	return { container, onSelect, onClose, onReorder, rerender: show };
}

/** 取所有标签按钮。 */
function tabs(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

/** 按标识取一条标签。 */
function tab(container: HTMLElement, label: string): HTMLButtonElement {
	const found = tabs(container).find((node) => node.textContent?.includes(label));
	if (found === undefined) {
		throw new Error(`找不到标签 ${label}`);
	}
	return found;
}

/** 取标签栏本身。 */
function barOf(container: HTMLElement): HTMLDivElement {
	const bar = container.querySelector<HTMLDivElement>('[role="tablist"]');
	if (bar === null) {
		throw new Error("找不到标签栏");
	}
	return bar;
}

/** 敲一下按键。 */
function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

describe("工作区标签栏", () => {
	it("按顺序渲染已打开的标签，当前项带 aria-selected", () => {
		const { container } = mount();
		expect(container.querySelector('[role="tablist"]')).not.toBeNull();
		expect(tabs(container).map((node) => node.textContent)).toEqual(["文件", "变更3", "终端"]);
		expect(tab(container, "文件").getAttribute("aria-selected")).toBe("true");
		expect(tab(container, "变更").getAttribute("aria-selected")).toBe("false");
	});

	it("一条标签都没开时不渲染标签栏本身", () => {
		const { container } = mount({ items: [] });
		expect(container.querySelector('[role="tablist"]')).toBeNull();
	});

	it("当前项是唯一能 Tab 到的那一条", () => {
		const { container } = mount({ activeId: "changes" });
		expect(tabs(container).map((node) => node.tabIndex)).toEqual([-1, 0, -1]);
	});

	it("点一条就切过去", () => {
		const { container, onSelect } = mount();
		act(() => tab(container, "终端").click());
		expect(onSelect).toHaveBeenCalledWith("terminal");
	});

	it("计数作为徽标显示", () => {
		const { container } = mount();
		expect(tab(container, "变更").querySelector(".ui-badge")?.textContent).toBe("3");
		expect(tab(container, "文件").querySelector(".ui-badge")).toBeNull();
	});

	it("不可用的标签点不动，方向键也跳过它", () => {
		const items: WorkspaceTabItem[] = [
			{ id: "files", label: "文件", icon: null },
			{ id: "changes", label: "变更", icon: null, disabled: true },
			{ id: "terminal", label: "终端", icon: null },
		];
		const { container, onSelect } = mount({ items, activeId: "files" });
		act(() => tab(container, "变更").click());
		expect(onSelect).not.toHaveBeenCalled();
		expect(tab(container, "变更").disabled).toBe(true);
		press(tab(container, "文件"), "ArrowRight");
		expect(onSelect).toHaveBeenLastCalledWith("terminal");
	});

	it("左右键在同一条可用项序列里循环，Home / End 跳到两头", () => {
		const { container, onSelect } = mount({ activeId: "files" });
		press(tab(container, "文件"), "ArrowRight");
		expect(onSelect).toHaveBeenLastCalledWith("changes");
		press(tab(container, "文件"), "ArrowLeft");
		expect(onSelect).toHaveBeenLastCalledWith("terminal");
		press(tab(container, "文件"), "End");
		expect(onSelect).toHaveBeenLastCalledWith("terminal");
		press(tab(container, "终端"), "Home");
		expect(onSelect).toHaveBeenLastCalledWith("files");
	});

	it("关闭按钮带标识，点它就关那一条", () => {
		const { container, onClose } = mount();
		const close = container.querySelector<HTMLButtonElement>(
			".workspace-tab-shell:nth-child(2) .workspace-tab-close",
		);
		expect(close?.getAttribute("aria-label")).toBe("关闭变更");
		act(() => close?.click());
		expect(onClose).toHaveBeenCalledWith("changes");
	});

	it("中键关闭，与浏览器标签一致", () => {
		const { container, onClose } = mount();
		act(() => {
			tab(container, "终端").dispatchEvent(
				new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
			);
		});
		expect(onClose).toHaveBeenCalledWith("terminal");
	});

	it("Delete / Backspace 关掉当前标签，不用先把焦点挪到叉上", () => {
		const { container, onClose } = mount({ activeId: "changes" });
		press(tab(container, "变更"), "Delete");
		expect(onClose).toHaveBeenLastCalledWith("changes");
		press(tab(container, "变更"), "Backspace");
		expect(onClose).toHaveBeenLastCalledWith("changes");
	});

	it("不给关闭回调时不渲染关闭按钮", () => {
		const { container } = mount({ onClose: undefined });
		expect(container.querySelectorAll(".workspace-tab-close")).toHaveLength(0);
		expect(container.querySelectorAll(".workspace-tab-shell.is-closable")).toHaveLength(0);
		// 没有关闭按钮时 Delete 也不该关任何东西
		press(tab(container, "文件"), "Delete");
	});

	it("标签文字一直在，窄成什么样都不折成图标", () => {
		const { container } = mount();
		expect(tabs(container).map((node) => node.textContent)).toEqual(["文件", "变更3", "终端"]);
		// 文字就是无障碍名称，不再另挂一份 aria-label 重复一遍
		expect(tab(container, "文件").getAttribute("aria-label")).toBeNull();
	});

	it("放不下时滚轮竖着滚也横向滚标签", () => {
		withoutMotion();
		const { container } = mount();
		const bar = barOf(container);
		let left = 0;
		Object.defineProperty(bar, "scrollWidth", { value: 400, configurable: true });
		Object.defineProperty(bar, "clientWidth", { value: 100, configurable: true });
		Object.defineProperty(bar, "scrollLeft", {
			get: () => left,
			set: (next: number) => {
				left = next;
			},
			configurable: true,
		});
		const event = new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true });
		act(() => {
			bar.dispatchEvent(event);
		});
		expect(left).toBe(60);
		// 吃掉事件，页面与外壳都不跟着滚
		expect(event.defaultPrevented).toBe(true);
	});

	it("没溢出时滚轮照常放行", () => {
		const { container } = mount();
		const bar = barOf(container);
		Object.defineProperty(bar, "scrollWidth", { value: 100, configurable: true });
		Object.defineProperty(bar, "clientWidth", { value: 100, configurable: true });
		const event = new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true });
		act(() => {
			bar.dispatchEvent(event);
		});
		expect(event.defaultPrevented).toBe(false);
	});

	it("当前项滚回可视范围里，只动标签栏自己的 scrollLeft", () => {
		withoutMotion();
		const { container, rerender } = mount({ activeId: "files" });
		const bar = barOf(container);
		let left = 0;
		Object.defineProperty(bar, "scrollLeft", {
			get: () => left,
			set: (next: number) => {
				left = next;
			},
			configurable: true,
		});
		// jsdom 没有布局：可滚范围与左右边界都自己给，目标整条落在右边框外面
		Object.defineProperty(bar, "scrollWidth", { value: 400, configurable: true });
		Object.defineProperty(bar, "clientWidth", { value: 100, configurable: true });
		bar.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 26 }) as DOMRect;
		tab(container, "变更").getBoundingClientRect = () =>
			({ left: 160, right: 240, top: 0, bottom: 26 }) as DOMRect;
		rerender({ activeId: "changes" });
		expect(left).toBe(140);
	});

	it("滚轮滚到目标位置是逐帧走过去的，一次到位就不叫动画了", async () => {
		const { container } = mount();
		const bar = barOf(container);
		let left = 0;
		Object.defineProperty(bar, "scrollWidth", { value: 400, configurable: true });
		Object.defineProperty(bar, "clientWidth", { value: 100, configurable: true });
		Object.defineProperty(bar, "scrollLeft", {
			get: () => left,
			set: (next: number) => {
				left = next;
			},
			configurable: true,
		});
		act(() => {
			bar.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true }));
		});
		// 第一帧之前还是原位置
		expect(left).toBe(0);
		await frames(1);
		const midway = left;
		expect(midway).toBeGreaterThan(0);
		expect(midway).toBeLessThan(60);
		await frames(30);
		expect(left).toBe(60);
	});

	it("读屏名称与方向键顺序跟着条目走，不认硬编码的业务", () => {
		const custom: WorkspaceTabItem[] = [
			{ id: "terminal", label: "终端", icon: null },
			{ id: "files", label: "文件", icon: null },
		];
		const { container, onSelect } = mount({ items: custom, activeId: "terminal" });
		press(tab(container, "终端"), "ArrowRight");
		expect(onSelect).toHaveBeenLastCalledWith("files" satisfies WorkspaceTabId);
	});

	it("只有溢出遮挡那一侧亮起渐隐标记", () => {
		const { container } = mount();
		const bar = barOf(container);
		let left = 0;
		Object.defineProperty(bar, "scrollWidth", { value: 300, configurable: true });
		Object.defineProperty(bar, "clientWidth", { value: 120, configurable: true });
		Object.defineProperty(bar, "scrollLeft", {
			get: () => left,
			set: (next: number) => {
				left = next;
			},
			configurable: true,
		});
		act(() => {
			bar.dispatchEvent(new Event("scroll"));
		});
		expect(bar.dataset.fadeLeft).toBeUndefined();
		expect(bar.dataset.fadeRight).toBe("true");

		left = 80;
		act(() => {
			bar.dispatchEvent(new Event("scroll"));
		});
		expect(bar.dataset.fadeLeft).toBe("true");
		expect(bar.dataset.fadeRight).toBe("true");

		left = 180;
		act(() => {
			bar.dispatchEvent(new Event("scroll"));
		});
		expect(bar.dataset.fadeLeft).toBe("true");
		expect(bar.dataset.fadeRight).toBeUndefined();
	});

	/** 给标签栏与各外壳装上递增的水平矩形，便于测真实拖拽阈值与让位。 */
	function mockShellRects(container: HTMLElement): void {
		const bar = barOf(container);
		bar.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300, top: 0, bottom: 26 }) as DOMRect;
		const shells = Array.from(container.querySelectorAll<HTMLDivElement>(".workspace-tab-shell"));
		shells.forEach((shell, index) => {
			const left = index * 82;
			shell.getBoundingClientRect = () =>
				({ left, right: left + 80, width: 80, top: 0, bottom: 26 }) as DOMRect;
		});
	}

	it("按住标签向右拖过邻项中点后提交新顺序，且松手后不误触选中", () => {
		const { container, onReorder, onSelect } = mount();
		mockShellRects(container);
		const firstTab = tab(container, "文件");

		act(() => {
			firstTab.dispatchEvent(
				new PointerEvent("pointerdown", { button: 0, clientX: 40, clientY: 13, pointerId: 1, bubbles: true }),
			);
		});
		// 未达 4px 阈值时不进入拖拽
		act(() => {
			window.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 42, clientY: 13, pointerId: 1, bubbles: true }),
			);
		});
		expect(barOf(container).dataset.reordering).toBeUndefined();

		// 向右拖动 90px：越过「变更」中点（122），进入拖拽并让邻项左移
		act(() => {
			window.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 130, clientY: 13, pointerId: 1, bubbles: true }),
			);
		});
		const bar = barOf(container);
		expect(bar.dataset.reordering).toBe("true");
		const shells = Array.from(container.querySelectorAll<HTMLDivElement>(".workspace-tab-shell"));
		expect(shells[0]?.dataset.dragging).toBe("true");
		expect(shells[0]?.style.getPropertyValue("--tab-drag-x")).toBe("90px");
		expect(shells[1]?.style.getPropertyValue("--tab-shift")).toBe("-82px");

		act(() => {
			window.dispatchEvent(
				new PointerEvent("pointerup", { button: 0, clientX: 130, clientY: 13, pointerId: 1, bubbles: true }),
			);
		});
		expect(bar.dataset.reordering).toBeUndefined();
		expect(onReorder).toHaveBeenCalledTimes(1);
		expect(onReorder).toHaveBeenCalledWith(["changes", "files", "terminal"]);

		// 紧随拖拽松手补发的 click 不应切走激活项
		act(() => {
			firstTab.click();
		});
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("拖拽过程中按 Escape 取消并消费默认事件，不提交重排", () => {
		const { container, onReorder } = mount();
		mockShellRects(container);
		act(() => {
			tab(container, "文件").dispatchEvent(
				new PointerEvent("pointerdown", { button: 0, clientX: 40, clientY: 13, pointerId: 1, bubbles: true }),
			);
			window.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 130, clientY: 13, pointerId: 1, bubbles: true }),
			);
		});
		const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
		act(() => {
			window.dispatchEvent(esc);
		});
		expect(esc.defaultPrevented).toBe(true);
		expect(barOf(container).dataset.reordering).toBeUndefined();
		expect(onReorder).not.toHaveBeenCalled();
	});

	it("右键按下、点关闭按钮或未传 onReorder 时不启动拖拽", () => {
		const { container, rerender } = mount();
		mockShellRects(container);
		act(() => {
			tab(container, "文件").dispatchEvent(
				new PointerEvent("pointerdown", { button: 2, clientX: 40, clientY: 13, pointerId: 1, bubbles: true }),
			);
			window.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 130, clientY: 13, pointerId: 1, bubbles: true }),
			);
		});
		expect(barOf(container).dataset.reordering).toBeUndefined();

		const closeBtn = container.querySelector<HTMLButtonElement>(".workspace-tab-close");
		act(() => {
			closeBtn?.dispatchEvent(
				new PointerEvent("pointerdown", { button: 0, clientX: 70, clientY: 13, pointerId: 2, bubbles: true }),
			);
			window.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 160, clientY: 13, pointerId: 2, bubbles: true }),
			);
		});
		expect(barOf(container).dataset.reordering).toBeUndefined();

		rerender({ onReorder: undefined });
		act(() => {
			tab(container, "文件").dispatchEvent(
				new PointerEvent("pointerdown", { button: 0, clientX: 40, clientY: 13, pointerId: 3, bubbles: true }),
			);
			window.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 130, clientY: 13, pointerId: 3, bubbles: true }),
			);
		});
		expect(barOf(container).dataset.reordering).toBeUndefined();
	});
});
