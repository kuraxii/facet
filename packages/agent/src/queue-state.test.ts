import type { ImageBlock } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { mergeClearedSteering, type QueuedMessageItem, syncSteeringMirror } from "./queue-state.ts";

const img = (id: string): ImageBlock => ({ type: "image", data: id, mimeType: "image/png" });

describe("syncSteeringMirror", () => {
	it("保留未消费条目的图片附件并在消费后剔除", () => {
		const initial: QueuedMessageItem[] = [
			{ text: "第一句", images: [img("a")] },
			{ text: "第二句", images: [img("b")] },
		];
		expect(syncSteeringMirror(initial, ["第二句"])).toEqual([{ text: "第二句", images: [img("b")] }]);
		expect(syncSteeringMirror(initial, [])).toEqual([]);
	});

	it("兼容扩展直接入队的纯文本条目", () => {
		const initial: QueuedMessageItem[] = [{ text: "第一句", images: [img("a")] }];
		expect(syncSteeringMirror(initial, ["第一句", "扩展追加"])).toEqual([
			{ text: "第一句", images: [img("a")] },
			{ text: "扩展追加" },
		]);
	});
});

describe("mergeClearedSteering", () => {
	it("按 clearedTexts 顺序还原携带图片的条目", () => {
		const mirror: QueuedMessageItem[] = [{ text: "a", images: [img("1")] }, { text: "b" }];
		expect(mergeClearedSteering(mirror, ["a", "b"])).toEqual(mirror);
	});
});
