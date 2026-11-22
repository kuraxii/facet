// @vitest-environment jsdom
/**
 * 外壳布局：档位、两栏宽度与拖动锁定。
 *
 * `useShellLayout` 自己不持有面板状态，这里给一份固定的面板状态与一组记账用的动作，验三件
 * 事：右栏实占宽在平铺态被正文预算钳住、窄档直接用偏好宽；开关在窄档切抽屉、平铺态改意图
 * 位；拖动期间不重算档位。
 */

import type { RightPanelState } from "@facet/ui";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutPane } from "../../resolve-layout.ts";
import type { ShellLayout, ShellPanelActions } from "./shell-types.ts";
import { useDrawerFocus } from "./useDrawerFocus.ts";
import { useShellLayout } from "./useShellLayout.ts";
import type { PanelPatch } from "./useWorkspacePanels.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom 这里没有 localStorage：给一份内存实现，宽度偏好读写都落在它上面。 */
vi.hoisted(() => {
	const map = new Map<string, string>();
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => map.get(key) ?? null,
			setItem: (key: string, value: string) => {
				map.set(key, value);
			},
			removeItem: (key: string) => {
				map.delete(key);
			},
			clear: () => {
				map.clear();
			},
			key: () => null,
			get length() {
				return map.size;
			},
		},
	});
});

/** 可控的 `matchMedia`：档位在窄 / 宽两档之间切换。 */
const media = vi.hoisted(() => {
	const state = { matches: false, listeners: new Set<(event: { matches: boolean }) => void>() };
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			get matches() {
				return state.matches;
			},
			media: query,
			onchange: null,
			addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
				state.listeners.add(listener);
			},
			removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
				state.listeners.delete(listener);
			},
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		}),
	});
	return state;
});

/** 面板状态：开着、偏好宽 `width`。 */
function panelOf(width: number): RightPanelState {
	return { open: true, openTabs: ["files"], activeTab: "files", width };
}

/** 记账用的右栏动作。 */
function actionsStub(): ShellPanelActions & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		update: (patch: PanelPatch) => {
			calls.push(typeof patch === "function" ? "update:fn" : "update:patch");
		},
		openTab: () => {
			calls.push("openTab");
		},
		closeTab: () => {
			calls.push("closeTab");
		},
		setOpen: (open: boolean) => {
			calls.push(`setOpen:${String(open)}`);
		},
		toggleExpanded: () => {
			calls.push("toggleExpanded");
		},
		collapseExpanded: () => {
			calls.push("collapseExpanded");
		},
	};
}

let root: Root | undefined;
let container: HTMLElement | undefined;
let current: ShellLayout | undefined;
/** 这一次挂载喂给 Hook 的输入 */
let input: { panel: RightPanelState; actions: ShellPanelActions; priorityPane: LayoutPane };

/** 挂载用的外壳：把 Hook 的结果交给用例，不渲染任何东西。 */
function Harness(): ReactElement {
	const drawers = useDrawerFocus();
	current = useShellLayout({
		panel: input.panel,
		panelExpanded: false,
		priorityPane: input.priorityPane,
		onPriorityChange: () => undefined,
		panelActions: input.actions,
		drawers,
	});
	return createElement("div");
}

/** 挂一棵树：抽屉 + 布局，面板状态与动作由用例给。 */
function mount(
	panel: RightPanelState,
	actions: ShellPanelActions,
	priorityPane: LayoutPane = "sidebar",
): void {
	input = { panel, actions, priorityPane };
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(createElement(Harness));
	});
}

/** 当前布局结果。 */
function layout(): ShellLayout {
	if (current === undefined) {
		throw new Error("Hook 没有跑起来");
	}
	return current;
}

/** 改视口宽并派发一次 resize。 */
async function resizeTo(width: number): Promise<void> {
	Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
	await act(async () => {
		window.dispatchEvent(new Event("resize"));
	});
}

/** 切换档位。 */
async function setNarrow(isNarrow: boolean): Promise<void> {
	media.matches = isNarrow;
	await act(async () => {
		for (const listener of media.listeners) {
			listener({ matches: isNarrow });
		}
	});
}

beforeEach(async () => {
	Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1400 });
	await setNarrow(false);
});

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	container = undefined;
	current = undefined;
	document.body.innerHTML = "";
	media.matches = false;
});

describe("右栏实占宽", () => {
	it("平铺态被正文预算钳住，偏好宽本身不动", () => {
		const actions = actionsStub();
		mount(panelOf(800), actions);
		// 1400 − 正文最小 520 − 左栏 272 = 608
		expect(layout().panelMaxWidth).toBe(608);
		expect(layout().panelEffectiveWidth).toBe(608);
	});

	it("窄档直接用偏好宽：抽屉盖在正文上，没有并列的正文要保护", async () => {
		const actions = actionsStub();
		mount(panelOf(800), actions);
		await setNarrow(true);
		expect(layout().panelEffectiveWidth).toBe(800);
	});
});

describe("两栏开关", () => {
	it("窄档切抽屉，不动意图位", async () => {
		const actions = actionsStub();
		mount(panelOf(420), actions);
		await setNarrow(true);
		// 进窄档会顺手退出宽展开，那一条不算这两下开关的账
		actions.calls.length = 0;

		act(() => layout().toggleSidebar());
		expect(layout().isDrawerOpen).toBe(true);
		act(() => layout().togglePanel());
		expect(layout().isPanelDrawerOpen).toBe(true);
		expect(layout().isDrawerOpen).toBe(false);
		// 窄档的开关不写回面板状态
		expect(actions.calls).toEqual([]);
	});

	it("平铺态改意图位", () => {
		const actions = actionsStub();
		mount(panelOf(420), actions);
		expect(layout().isSidebarCollapsed).toBe(false);
		act(() => layout().toggleSidebar());
		expect(layout().isSidebarCollapsed).toBe(true);
		act(() => layout().togglePanel());
		expect(actions.calls).toEqual(["setOpen:false"]);
	});

	it("窄档下宽度补丁被丢掉", async () => {
		const actions = actionsStub();
		mount(panelOf(420), actions);
		await setNarrow(true);
		actions.calls.length = 0;
		act(() => layout().updatePanel({ width: 500 }));
		expect(actions.calls).toEqual([]);
		act(() => layout().updatePanel({ open: false }));
		expect(actions.calls).toEqual(["update:patch"]);
	});
});

describe("拖动锁定", () => {
	it("拖动期间窗口变化不重算档位", async () => {
		const actions = actionsStub();
		// 900px 中档：两栏都开时预算不够，会折起一栏
		mount(panelOf(420), actions);
		await resizeTo(900);
		const folded = layout().sidebarVisible && layout().panelVisible;
		expect(folded).toBe(false);

		// 拖动中把窗口拉宽：这一帧不该把折起的那一栏放出来
		act(() => layout().setPaneResizing(true));
		await resizeTo(1400);
		expect(layout().sidebarVisible && layout().panelVisible).toBe(false);

		// 松手之后按新视口重算
		act(() => layout().setPaneResizing(false));
		await resizeTo(1400);
		expect(layout().sidebarVisible && layout().panelVisible).toBe(true);
	});
});
