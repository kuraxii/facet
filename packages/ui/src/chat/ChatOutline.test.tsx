// @vitest-environment jsdom
/**
 * 导航竖轨的显示条件。
 *
 * 只有一条：有没有可跳的条目。窗口宽度不参与判断——宽度够不够由三列网格的右轨
 * （`--outline-slot`）兜着，所以窄视口下照旧渲染，只有空对话与单条消息时收起。
 */
import type { TranscriptItem } from "@facet/client-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { VISUAL_SCALE } from "../styles/visual-contract.ts";
import { ChatOutline } from "./ChatOutline.tsx";
import { OUTLINE_MIN_ITEMS, outlineIsActive, outlinePrompts } from "./chat-outline.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
});

/** 造一条用户消息。 */
function userMessage(entryId: string, text: string): TranscriptItem {
	return {
		kind: "message",
		id: `v:${entryId}`,
		entryId,
		role: "user",
		stopReason: undefined,
		parts: [{ kind: "text", partId: "text:0", text }],
		isStreaming: false,
		startedAt: undefined,
		endedAt: undefined,
	};
}

/** 挂一条竖轨，返回宿主元素。 */
function mount(items: TranscriptItem[], options: { container?: HTMLElement; canLoadOlder?: boolean } = {}) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const calls = { load: 0 };
	act(() => {
		root?.render(
			<I18nProvider language="zh-CN">
				<ChatOutline
					items={items}
					container={options.container ?? null}
					canLoadOlder={options.canLoadOlder ?? false}
					onLoadOlder={() => {
						calls.load += 1;
					}}
				/>
			</I18nProvider>,
		);
	});
	return { host, calls };
}

/** 假滚动容器：jsdom 不实现滚动动画，`scrollTo` 只用来看有没有被调用 */
function fakeContainer(scrollTop: number): HTMLElement {
	const element = document.createElement("div");
	element.scrollTop = scrollTop;
	element.setAttribute("data-scroll-to-count", "0");
	// 两种重载都要能接：这里只关心 `{ top }` 那种，并把落点记下来给用例断言
	element.scrollTo = ((options?: ScrollToOptions | number, y?: number): void => {
		const count = Number(element.getAttribute("data-scroll-to-count") ?? "0") + 1;
		element.setAttribute("data-scroll-to-count", String(count));
		const top = typeof options === "number" ? y : options?.top;
		if (typeof top === "number") {
			element.setAttribute("data-scroll-to-top", String(top));
		}
	}) as typeof element.scrollTo;
	return element;
}

describe("导航竖轨的显示条件", () => {
	it("两条以上用户消息就渲染，与视口宽度无关", () => {
		const { host } = mount([userMessage("e1", "第一问"), userMessage("e2", "第二问")]);
		expect(host.querySelector(".outline")).not.toBeNull();
		// 竖轨本身不带任何随宽度收起的标记：宽度由网格右轨兜着
		expect(host.querySelector(".outline")?.hasAttribute("hidden")).toBe(false);
	});

	it("条目不够时不渲染", () => {
		expect(mount([userMessage("e1", "只有一问")]).host.querySelector(".outline")).toBeNull();
	});

	it("空对话时不渲染", () => {
		expect(mount([]).host.querySelector(".outline")).toBeNull();
	});

	it("判据与外壳的 `data-outline-active` 是同一条", () => {
		const two = outlinePrompts([userMessage("e1", "第一问"), userMessage("e2", "第二问")]);
		const one = outlinePrompts([userMessage("e1", "只有一问")]);
		expect(outlineIsActive(two)).toBe(true);
		expect(outlineIsActive(one)).toBe(false);
		expect(OUTLINE_MIN_ITEMS).toBe(2);
	});
});

describe("跳转落点", () => {
	it("落点要盖过顶部渐隐层", () => {
		const container = fakeContainer(1000);
		// 容器里挂两个锚点：jsdom 没有布局，锚点相对容器的偏移都是 0，落点就等于 scrollTop - 留白
		for (const key of ["v:e1", "v:e2"]) {
			const anchor = document.createElement("div");
			anchor.setAttribute("data-outline-key", key);
			container.append(anchor);
		}
		const { host } = mount([userMessage("e1", "第一问"), userMessage("e2", "第二问")], { container });
		act(() => host.querySelectorAll<HTMLElement>(".outline-tick")[1]?.click());
		const landed = Number(container.getAttribute("data-scroll-to-top"));
		// 留白至少盖过渐隐层（`--control-lg`），否则跳过去第一行是蒙着的
		expect(1000 - landed).toBeGreaterThanOrEqual(VISUAL_SCALE.control.lg);
	});
});

describe("竖轨顶端的「…」", () => {
	const twoPrompts = [userMessage("e1", "第一问"), userMessage("e2", "第二问")];

	it("已经停在顶部时点一下直接补页，不发起滚动", () => {
		const container = fakeContainer(0);
		const { host, calls } = mount(twoPrompts, { container, canLoadOlder: true });
		act(() => host.querySelector<HTMLElement>(".outline-more")?.click());
		expect(calls.load).toBe(1);
		expect(container.getAttribute("data-scroll-to-count")).toBe("0");
	});

	it("还在下面时先滚到顶部，落定后才补页", () => {
		const container = fakeContainer(4000);
		const { host, calls } = mount(twoPrompts, { container, canLoadOlder: true });
		act(() => host.querySelector<HTMLElement>(".outline-more")?.click());
		expect(container.getAttribute("data-scroll-to-count")).toBe("1");
		expect(calls.load).toBe(0);
		act(() => container.dispatchEvent(new Event("scrollend")));
		expect(calls.load).toBe(1);
	});

	it("没有更早的历史时点不动", () => {
		const container = fakeContainer(0);
		const { host, calls } = mount(twoPrompts, { container, canLoadOlder: false });
		const more = host.querySelector<HTMLButtonElement>(".outline-more");
		expect(more?.disabled).toBe(true);
		act(() => more?.click());
		expect(calls.load).toBe(0);
	});
});
