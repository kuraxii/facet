// @vitest-environment jsdom
/**
 * 四处图片入口都接到同一个全局预览上：正文里的工具结果图、Markdown 正文图、消息里随用户发出的
 * 图、输入区附件缩略图。
 *
 * 工具结果那张图原来点一下会就地放成原始尺寸，这里同时钉住「不就地放大」——点击之后缩略图
 * 的行内样式不变，开出来的是浮层。
 */
import type { TranscriptItem } from "@facet/client-core";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Composer } from "../chat/Composer.tsx";
import { Markdown } from "../markdown/Markdown.tsx";
import { ChatTranscript } from "../transcript/rows.tsx";
import { ImagePreviewProvider } from "./image-preview.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PNG_PREFIX = "data:image/png;base64,";

let root: Root | undefined;
let container: HTMLElement | undefined;

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(createElement(ImagePreviewProvider, null, element));
	});
}

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
	root = undefined;
	container = undefined;
	document.body.innerHTML = "";
});

/** 浮层里正在显示的那张图。 */
function shownImage(): HTMLImageElement | null {
	return document.querySelector<HTMLImageElement>(".image-preview-stage img");
}

function click(node: Element | null | undefined): void {
	if (node === null || node === undefined) {
		throw new Error("要点的元素不存在");
	}
	act(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** 一条带图片的用户消息。 */
function userItem(text: string, images: readonly string[], id = "u1"): TranscriptItem {
	return {
		kind: "message",
		id: `e:${id}`,
		entryId: id,
		role: "user",
		stopReason: undefined,
		parts: [
			...(text.length === 0 ? [] : [{ kind: "text" as const, partId: "text:0", text }]),
			...images.map((data, index) => ({
				kind: "image" as const,
				partId: `image:${index + 1}`,
				data,
				mimeType: "image/png",
			})),
		],
		isStreaming: false,
		startedAt: 1,
		endedAt: 2,
	};
}

/** 一条带图片的工具调用。 */
function toolItem(images: readonly string[]): TranscriptItem {
	return {
		kind: "message",
		id: "e:a1",
		entryId: "a1",
		role: "assistant",
		stopReason: "stop",
		parts: [
			{
				kind: "toolCall",
				partId: "tool:c1",
				callId: "c1",
				name: "screenshot",
				input: { path: "shot.png" },
				status: "done",
				output: "ok",
				durationMs: 12,
				details: undefined,
				images: images.map((data) => ({ data, mimeType: "image/png" })),
			},
		],
		isStreaming: false,
		startedAt: 1,
		endedAt: 2,
	};
}

describe("工具结果里的图片", () => {
	it("点击开全局预览，不在行内放大", async () => {
		await mount(
			createElement(ChatTranscript, {
				items: [toolItem(["AAAA", "BBBB"])],
				canFork: false,
				onFork: () => {},
				canRevert: false,
				onRevert: () => {},
			}),
		);
		const thumb = container?.querySelector<HTMLButtonElement>(".tr-image");
		expect(thumb?.tagName).toBe("BUTTON");
		const inner = thumb?.querySelector("img");
		expect(inner?.getAttribute("style")).toBeNull();

		click(thumb);
		expect(shownImage()?.getAttribute("src")).toBe(`${PNG_PREFIX}AAAA`);
		// 行内那张缩略图没有被撑开
		expect(inner?.getAttribute("style")).toBeNull();
		expect(inner?.getAttribute("src")).toBe(`${PNG_PREFIX}AAAA`);
	});

	it("同一行的第二张从第二张开始翻", async () => {
		await mount(
			createElement(ChatTranscript, {
				items: [toolItem(["AAAA", "BBBB"])],
				canFork: false,
				onFork: () => {},
				canRevert: false,
				onRevert: () => {},
			}),
		);
		const thumbs = [...(container?.querySelectorAll<HTMLButtonElement>(".tr-image") ?? [])];
		click(thumbs[1]);
		expect(shownImage()?.getAttribute("src")).toBe(`${PNG_PREFIX}BBBB`);
	});
});

describe("消息里的图片", () => {
	it("排在气泡上方，点击开全局预览，同一段消息的几张可以翻", async () => {
		await mount(
			createElement(ChatTranscript, {
				items: [userItem("看这两张", ["AAAA", "BBBB"])],
				canFork: false,
				onFork: () => {},
				canRevert: false,
				onRevert: () => {},
			}),
		);
		const strip = container?.querySelector(".msg-images");
		const line = container?.querySelector(".user-line");
		expect(strip).not.toBeNull();
		// 图片条在气泡那一行之前
		expect(strip?.compareDocumentPosition(line as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		const thumbs = [...(container?.querySelectorAll<HTMLButtonElement>(".msg-image") ?? [])];
		expect(thumbs).toHaveLength(2);
		expect(thumbs[0]?.querySelector("img")?.getAttribute("src")).toBe(`${PNG_PREFIX}AAAA`);

		click(thumbs[1]);
		expect(shownImage()?.getAttribute("src")).toBe(`${PNG_PREFIX}BBBB`);
	});

	it("只有图片没有文字时不出空气泡", async () => {
		await mount(
			createElement(ChatTranscript, {
				items: [userItem("", ["AAAA"])],
				canFork: false,
				onFork: () => {},
				canRevert: false,
				onRevert: () => {},
			}),
		);
		expect(container?.querySelector(".msg-image")).not.toBeNull();
		expect(container?.querySelector(".bub")).toBeNull();
	});

	it("重试把最后一条用户消息的图片一起带回去", async () => {
		const retried: { text: string; images: readonly { data: string }[] }[] = [];
		await mount(
			createElement(ChatTranscript, {
				items: [
					userItem("看这两张", ["AAAA", "BBBB"]),
					{
						kind: "error",
						id: "e:err",
						entryId: "err",
						role: "assistant",
						stopReason: "error",
						parts: [{ kind: "text", partId: "text:0", text: "429 请求过多" }],
						isStreaming: false,
						startedAt: 2,
						endedAt: 3,
					},
				],
				canFork: true,
				onFork: () => {},
				canRevert: true,
				onRevert: () => {},
				onRetryTurn: (_entryId: string, text: string, images: readonly { data: string }[]) => {
					retried.push({ text, images });
				},
			}),
		);
		const retry = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
			(button) => button.textContent?.trim() === "重试",
		);
		click(retry);
		expect(retried[0]?.text).toBe("看这两张");
		expect(retried[0]?.images.map((image) => image.data)).toEqual(["AAAA", "BBBB"]);
	});

	it("回退把这条消息的图片一起交回去", async () => {
		const reverted: { text: string; images: readonly { data: string }[] }[] = [];
		await mount(
			createElement(ChatTranscript, {
				items: [userItem("第一轮", [], "u0"), userItem("看这两张", ["AAAA", "BBBB"], "u1")],
				canFork: false,
				onFork: () => {},
				canRevert: true,
				onRevert: (_entryId: string, text: string, images: readonly { data: string }[]) => {
					reverted.push({ text, images });
				},
			}),
		);
		const buttons = [...(container?.querySelectorAll<HTMLButtonElement>(".msg-action") ?? [])];
		const revert = buttons.find((button) => button.getAttribute("aria-label") === "回退到这条消息之前");
		click(revert);
		expect(reverted[0]?.text).toBe("看这两张");
		expect(reverted[0]?.images.map((image) => image.data)).toEqual(["AAAA", "BBBB"]);
	});
});

describe("Markdown 正文图片", () => {
	it("点击开全局预览", async () => {
		await mount(
			createElement(Markdown, { text: "前 ![甲](https://example.com/a.png) 后", isStreaming: false }),
		);
		const image = container?.querySelector<HTMLButtonElement>(".md-image");
		expect(image).not.toBeNull();
		expect(image?.getAttribute("aria-label")).toBe("甲");
		click(image);
		expect(shownImage()?.getAttribute("src")).toBe("https://example.com/a.png");
	});
});

describe("输入区附件缩略图", () => {
	it("点击开全局预览，同一批附件可以翻", async () => {
		await mount(
			createElement(Composer, {
				value: "",
				onChange: () => {},
				onSend: () => {},
				onStop: () => {},
				activity: "idle",
				model: undefined,
				thinkingLevel: undefined,
				attachments: [
					{ id: "a", name: "甲.png", previewUrl: "blob:one" },
					{ id: "b", name: "乙.png", previewUrl: "blob:two" },
				],
			}),
		);
		const thumbs = [...(container?.querySelectorAll<HTMLButtonElement>(".att-preview") ?? [])];
		expect(thumbs.length).toBe(2);
		click(thumbs[0]);
		expect(shownImage()?.getAttribute("src")).toBe("blob:one");
	});
});
