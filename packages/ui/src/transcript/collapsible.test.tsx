// @vitest-environment jsdom
/**
 * 折叠体的页内查找。
 *
 * 思考过程、工具输出与过程组收起时留在 DOM 里并标 `hidden="until-found"`：浏览器自己的
 * 查找（Ctrl+F）能命中，命中前派一个 `beforematch` 事件——这里验的就是"收到事件就展开"，
 * 以及没展开时不接这个监听。
 */
import type { TranscriptItem } from "@facet/client-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { ChatTranscript } from "./rows.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
});

/** 一条只有思考内容的消息：思考体默认收起。 */
function thinkingItem(): TranscriptItem {
	return {
		kind: "message",
		id: "e:think",
		entryId: "e:think",
		role: "assistant",
		stopReason: "stop",
		parts: [{ kind: "thinking", partId: "think:0", text: "先看一眼目录结构" }],
		isStreaming: false,
		startedAt: 1,
		endedAt: 2,
	};
}

/** 一条带工具调用的消息：输出体默认收起。输出为空时这一行还没有输出体。 */
function toolItem(output = "a.txt\nb.txt"): TranscriptItem {
	return {
		kind: "message",
		id: "e:tool",
		entryId: "e:tool",
		role: "assistant",
		stopReason: "stop",
		parts: [
			{
				kind: "toolCall",
				partId: "tool:0",
				callId: "call-1",
				name: "bash",
				status: output.length === 0 ? "running" : "done",
				input: { command: "ls" },
				output,
				durationMs: undefined,
				details: undefined,
				images: [],
			},
		],
		isStreaming: output.length === 0,
		startedAt: 3,
		endedAt: output.length === 0 ? undefined : 4,
	};
}

/** 用同一个 root 再渲染一棵对话：行不卸载，等价于流式更新。 */
function rerender(items: TranscriptItem[]): void {
	act(() => {
		root?.render(
			<I18nProvider language="zh-CN">
				<ChatTranscript
					items={items}
					canFork={false}
					onFork={() => {}}
					canRevert={false}
					onRevert={() => {}}
					maintenance={undefined}
				/>
			</I18nProvider>,
		);
	});
}

/** 挂一棵对话，返回容器。 */
function mount(items: TranscriptItem[]): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	rerender(items);
	return host;
}

/** 派发浏览器在页内查找命中折叠内容前发出的 `beforematch`。 */
function beforeMatch(node: Element): void {
	act(() => {
		node.dispatchEvent(new Event("beforematch"));
	});
}

describe("折叠体的页内查找", () => {
	it('思考体收起时标 `hidden="until-found"`，命中后自动展开', () => {
		const host = mount([thinkingItem()]);
		const body = host.querySelector(".tr-think");
		expect(body).not.toBeNull();
		expect(body?.getAttribute("hidden")).toBe("until-found");

		beforeMatch(body as Element);
		expect(host.querySelector(".tr-think")?.hasAttribute("hidden")).toBe(false);
	});

	it('工具输出收起时标 `hidden="until-found"`，命中后自动展开', () => {
		const host = mount([toolItem()]);
		const body = host.querySelector(".tr-out");
		expect(body?.getAttribute("hidden")).toBe("until-found");

		beforeMatch(body as Element);
		expect(host.querySelector(".tr-out")?.hasAttribute("hidden")).toBe(false);
	});

	it("已经展开的折叠体不留 hidden 属性", () => {
		const host = mount([thinkingItem()]);
		const body = host.querySelector(".tr-think") as Element;
		beforeMatch(body);
		// 展开之后再派一次事件也不该把它收起
		beforeMatch(host.querySelector(".tr-think") as Element);
		expect(host.querySelector(".tr-think")?.hasAttribute("hidden")).toBe(false);
	});
});

describe("收起体后挂上来", () => {
	it("工具输出后到时，新挂上的输出体也是收起的", () => {
		// 输出为空时这一行还没有 `.tr-out`；输出到了之后节点才挂上来。
		// 只认 `isOpen` 的 effect 那时早跑过了，属性必须在节点落上来的那一刻就写好，
		// 否则这一块会以"展开"的样子出现——看着就像没点它自己开了。
		const host = mount([toolItem("")]);
		expect(host.querySelector(".tr-out")).toBeNull();

		rerender([toolItem()]);
		expect(host.querySelector(".tr-out")?.getAttribute("hidden")).toBe("until-found");
	});
});
