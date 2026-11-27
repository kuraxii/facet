// @vitest-environment jsdom
/**
 * 外壳布局：档位、两栏宽度与拖动锁定。
 *
 * `useShellLayout` 自己不持有面板状态，这里给一份固定的面板状态与一组记账用的动作，验三件
 * 事：右栏实占宽在三档里都被正文预算钳住（它没有抽屉，窄档也占列）；左栏在窄档走抽屉、
 * 其余档位改意图位；拖动期间不重算档位。
 */

import type { RightPanelState } from "@facet/ui";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** 面板状态：开着、偏好宽 `width`、没手动定过宽时的视口基准。 */
function panelOf(width: number, widthViewport?: number): RightPanelState {
	return { open: true, openTabs: ["files"], activeTab: "files", width, widthViewport };
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
		reorderTabs: () => {
			calls.push("reorderTabs");
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
let input: { panel: RightPanelState; actions: ShellPanelActions };

/** 挂载用的外壳：把 Hook 的结果交给用例，不渲染任何东西。 */
function Harness(): ReactElement {
	const drawers = useDrawerFocus();
	current = useShellLayout({
		panel: input.panel,
		panelExpanded: false,
		panelActions: input.actions,
		drawers,
	});
	return createElement("div");
}

/** 挂一棵树：抽屉 + 布局，面板状态与动作由用例给。 */
function mount(panel: RightPanelState, actions: ShellPanelActions): void {
	input = { panel, actions };
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
	window.localStorage.clear();
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
	it("先让右栏：1400 里偏好宽 800 只拿到下限，正文留够阅读上限", () => {
		const actions = actionsStub();
		mount(panelOf(800), actions);
		// 1400 − 左栏 272 − 正文基准 944 < 0，右栏停在下限
		expect(layout().panelEffectiveWidth).toBe(300);
		// 分隔条仍能拖到「正文只剩 520」那条线
		expect(layout().panelMaxWidth).toBe(608);
	});

	it("窗口再窄：右栏不再变，正文自己缩", async () => {
		const actions = actionsStub();
		mount(panelOf(800), actions);
		await setNarrow(true);
		await resizeTo(840);
		expect(layout().panelEffectiveWidth).toBe(300);
	});

	it("手动拖过的宽度先照摆，窗口缩下去时右栏先还", async () => {
		const actions = actionsStub();
		// 1400 的窗口里定下 600
		mount(panelOf(600, 1400), actions);
		expect(layout().panelEffectiveWidth).toBe(600);

		await resizeTo(1300);
		expect(layout().panelEffectiveWidth).toBe(500);

		await resizeTo(1100);
		expect(layout().panelEffectiveWidth).toBe(300);

		// 回到定宽时的窗口，按偏好宽长回去
		await resizeTo(1400);
		expect(layout().panelEffectiveWidth).toBe(600);
	});
});

describe("两栏开关", () => {
	it("窄档里左栏走抽屉、右栏照旧改意图位", async () => {
		const actions = actionsStub();
		mount(panelOf(420), actions);
		await setNarrow(true);
		// 进窄档会顺手退出宽展开，那一条不算这几下开关的账
		actions.calls.length = 0;

		act(() => layout().toggleSidebar());
		expect(layout().isDrawerOpen).toBe(true);
		act(() => layout().togglePanel());
		expect(actions.calls).toEqual(["setOpen:false"]);
		// 右栏没有抽屉，左抽屉不受它影响
		expect(layout().isDrawerOpen).toBe(true);
	});

	it("平铺态改意图位", () => {
		const actions = actionsStub();
		mount(panelOf(420), actions);
		expect(layout().isSidebarCollapsed).toBe(false);
		act(() => layout().toggleSidebar());
		expect(layout().isSidebarCollapsed).toBe(true);
		act(() => layout().togglePanel());
		expect(actions.calls).toEqual(["setOpen:false"]);

		// 重新挂载后仍保留收起意图
		act(() => root?.unmount());
		mount(panelOf(420), actions);
		expect(layout().isSidebarCollapsed).toBe(true);
	});

	it("窄档下宽度补丁照样提交：右栏在那里也是可拖的一列", async () => {
		const actions = actionsStub();
		mount(panelOf(420), actions);
		await setNarrow(true);
		actions.calls.length = 0;
		act(() => layout().updatePanel({ width: 500 }));
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
