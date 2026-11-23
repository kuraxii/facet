// @vitest-environment jsdom
/**
 * 导航竖轨的显示条件。
 *
 * 只有一条：有没有可跳的条目。窗口宽度不参与判断——宽度够不够由三列网格的右轨
 * （`--outline-slot`）兜着，所以窄视口下照旧渲染，只有空对话与单条消息时收起。
 */
import type { TranscriptItem } from "@facet/client-core";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
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
function mount(items: TranscriptItem[]): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	act(() => {
		root?.render(
			<I18nProvider language="zh-CN">
				<ChatOutline items={items} container={null} viewport={createRef()} />
			</I18nProvider>,
		);
	});
	return host;
}

describe("导航竖轨的显示条件", () => {
	it("两条以上用户消息就渲染，与视口宽度无关", () => {
		const host = mount([userMessage("e1", "第一问"), userMessage("e2", "第二问")]);
		expect(host.querySelector(".outline")).not.toBeNull();
		// 竖轨本身不带任何随宽度收起的标记：宽度由网格右轨兜着
		expect(host.querySelector(".outline")?.hasAttribute("hidden")).toBe(false);
	});

	it("条目不够时不渲染", () => {
		expect(mount([userMessage("e1", "只有一问")]).querySelector(".outline")).toBeNull();
	});

	it("空对话时不渲染", () => {
		expect(mount([]).querySelector(".outline")).toBeNull();
	});

	it("判据与外壳的 `data-outline-active` 是同一条", () => {
		const two = outlinePrompts([userMessage("e1", "第一问"), userMessage("e2", "第二问")]);
		const one = outlinePrompts([userMessage("e1", "只有一问")]);
		expect(outlineIsActive(two)).toBe(true);
		expect(outlineIsActive(one)).toBe(false);
		expect(OUTLINE_MIN_ITEMS).toBe(2);
	});
});
