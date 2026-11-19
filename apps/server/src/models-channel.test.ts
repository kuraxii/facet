/**
 * 模型通道的用例。
 *
 * 通道只做三件事：追加带序号的动作、推给当前订阅者、按 since 补发缓冲。这里盯的就是这三件，
 * 以及标识对不上的通道由网关拒绝（那条在网关用例里）。
 */
import type { ActionFrame } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { ModelsChannel } from "./models-channel.ts";

const BUFFER = 4;
const CHANNEL = "models:/h" as const;

/** 收帧的假订阅者。 */
function sink(): { id: string; frames: ActionFrame[]; send(frame: ActionFrame): void } {
	return {
		id: "c1",
		frames: [],
		send(frame) {
			this.frames.push(frame);
		},
	};
}

describe("模型通道", () => {
	it("推给所有订阅者并带上递增序号", () => {
		const channel = new ModelsChannel(BUFFER);
		const first = sink();
		const second = sink();
		channel.subscribe(CHANNEL, undefined, first);
		channel.subscribe(CHANNEL, undefined, second);
		channel.publishLogin(CHANNEL, "l1", "gateway", { type: "progress", message: "换 token" });
		channel.publishLogin(CHANNEL, "l1", "gateway", { type: "done" });
		expect(channel.lastSeq).toBe(2);
		expect(first.frames.map((frame) => frame.serverSeq)).toEqual([1, 2]);
		expect(second.frames).toHaveLength(2);
		expect(first.frames[0]?.action).toEqual({
			type: "models/loginEvent",
			loginId: "l1",
			providerId: "gateway",
			event: { type: "progress", message: "换 token" },
		});
	});

	it("按 since 补发缓冲内的动作", () => {
		const channel = new ModelsChannel(BUFFER);
		channel.publishLogin(CHANNEL, "l1", "gateway", { type: "progress", message: "一" });
		channel.publishLogin(CHANNEL, "l1", "gateway", { type: "progress", message: "二" });
		const late = sink();
		const result = channel.subscribe(CHANNEL, 1, late);
		expect(result.resync).toBe(false);
		expect(result.seq).toBe(2);
		expect(late.frames).toHaveLength(1);
	});

	it("缓冲丢掉更早的动作时告诉端点要重新对齐", () => {
		const channel = new ModelsChannel(BUFFER);
		for (let index = 0; index < BUFFER + 2; index += 1) {
			channel.publishLogin(CHANNEL, "l1", "gateway", { type: "progress", message: String(index) });
		}
		const late = sink();
		const result = channel.subscribe(CHANNEL, 0, late);
		expect(result.resync).toBe(true);
	});

	it("取消订阅之后不再收帧", () => {
		const channel = new ModelsChannel(BUFFER);
		const listener = sink();
		channel.subscribe(CHANNEL, undefined, listener);
		channel.unsubscribe(listener);
		channel.publishLogin(CHANNEL, "l1", "gateway", { type: "done" });
		expect(listener.frames).toHaveLength(0);
	});
});
