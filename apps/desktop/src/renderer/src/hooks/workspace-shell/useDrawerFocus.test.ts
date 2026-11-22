// @vitest-environment jsdom
/**
 * 窄档抽屉的 Escape 与焦点归还。
 *
 * 抽屉状态由 Hook 自己持有，所以这里挂一棵真的 DOM：先记下打开它时聚焦的那个开关，再验
 * 「内层浮层已经吃掉的 Escape 不关抽屉」「没被吃掉的 Escape 关掉并把焦点还回去」「离开窄档
 * 自动收起」。
 *
 * `layout-mode.ts` 在模块加载时就要 `matchMedia`，所以补丁放在 `vi.hoisted` 里——它比
 * 静态导入先跑。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawerHandle } from "./shell-types.ts";
import { useDrawerFocus } from "./useDrawerFocus.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 可控的 `matchMedia`：档位在窄 / 宽两档之间切换。 */
const media = vi.hoisted(() => {
	const state = { matches: true, listeners: new Set<(event: { matches: boolean }) => void>() };
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			// 档位是活的：`layout-mode.ts` 只在加载时建一次 MediaQueryList
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

/** 切换档位并通知订阅者。 */
async function setNarrow(isNarrow: boolean): Promise<void> {
	media.matches = isNarrow;
	await act(async () => {
		for (const listener of media.listeners) {
			listener({ matches: isNarrow });
		}
	});
}

/** 一棵只为了让 Hook 有地方住的树。 */
let root: Root | undefined;
let container: HTMLElement | undefined;
let current: DrawerHandle | undefined;

/** 挂上去，返回句柄。 */
function mount(): DrawerHandle {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(createElement(Harness));
	});
	return handle();
}

/** 挂载用的外壳：把句柄交给用例，顺便给一个可聚焦的开关。 */
function Harness(): ReactElement {
	current = useDrawerFocus();
	return createElement("button", { type: "button", id: "opener" }, "open");
}

/** 当前句柄（Hook 每次渲染都会换一份）。 */
function handle(): DrawerHandle {
	if (current === undefined) {
		throw new Error("Hook 没有跑起来");
	}
	return current;
}

/** 在 window 上按一次 Escape；`consumed` 为真表示内层浮层已经 preventDefault。 */
async function pressEscape(consumed: boolean): Promise<void> {
	const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
	if (consumed) {
		event.preventDefault();
	}
	await act(async () => {
		window.dispatchEvent(event);
	});
}

beforeEach(async () => {
	await setNarrow(true);
});

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	container = undefined;
	current = undefined;
	document.body.innerHTML = "";
	media.matches = true;
});

describe("窄档抽屉", () => {
	it("点一下开、再点一下关", () => {
		mount();
		act(() => handle().toggleSidebarDrawer());
		expect(handle().isDrawerOpen).toBe(true);
		act(() => handle().toggleSidebarDrawer());
		expect(handle().isDrawerOpen).toBe(false);
	});

	it("内层浮层已经吃掉的 Escape 不关抽屉", async () => {
		mount();
		act(() => handle().toggleSidebarDrawer());
		await pressEscape(true);
		expect(handle().isDrawerOpen).toBe(true);
	});

	it("没被吃掉的 Escape 关掉抽屉并把焦点还给开关", async () => {
		mount();
		const opener = container?.querySelector<HTMLButtonElement>("#opener");
		opener?.focus();
		expect(document.activeElement).toBe(opener);

		act(() => handle().toggleSidebarDrawer());
		await pressEscape(false);
		expect(handle().isDrawerOpen).toBe(false);
		expect(document.activeElement).toBe(opener);
	});

	it("离开窄档时抽屉自动收起", async () => {
		mount();
		act(() => handle().toggleSidebarDrawer());
		expect(handle().isDrawerOpen).toBe(true);
		await setNarrow(false);
		expect(handle().isDrawerOpen).toBe(false);
	});
});
