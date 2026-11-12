/**
 * 会话事件到通道动作的投影。
 *
 * pi 的消息没有标识,流式增量却需要按消息定位,因此这里给每条新消息分配一个会话内
 * 稳定的标识:出现 message_start 时分配,同一条消息的后续增量与完成事件复用它。
 */
import type { Action, Channel, SessionEvent } from "@facet/protocol";
import { makeChannel } from "@facet/protocol";

/** 一条待分发的动作及其归属通道。 */
export interface ChannelAction {
	channel: Channel;
	action: Action;
}

export class ActionProjector {
	private readonly sessionChannel: Channel;
	private readonly chatChannel: Channel;

	/** 对话通道名，需要主动往外发动作时用。 */
	chatChannelFor(): Channel {
		return this.chatChannel;
	}

	/** 会话通道名，需要主动往外发动作时用。 */
	sessionChannelFor(): Channel {
		return this.sessionChannel;
	}

	/** 已分配的消息序号 */
	private messageCounter = 0;
	/** 正在生成的消息标识,收到 message_end 后清空 */
	private pendingMessageId: string | undefined;
	constructor(sessionId: string) {
		this.sessionChannel = makeChannel("session", sessionId);
		this.chatChannel = makeChannel("chat", sessionId);
	}

	/** 当前正在生成的消息标识,没有则为空。 */
	get currentMessageId(): string | undefined {
		return this.pendingMessageId;
	}

	project(event: SessionEvent): ChannelAction[] {
		const session = (action: Action): ChannelAction => ({ channel: this.sessionChannel, action });
		const chat = (action: Action): ChannelAction => ({ channel: this.chatChannel, action });

		switch (event.type) {
			case "phase":
				return [session({ type: "session/phase", phase: event.phase, maintenance: event.maintenance })];
			case "model":
				return [
					session({
						type: "session/modelChanged",
						model: event.model,
						availableThinkingLevels: event.availableThinkingLevels,
					}),
				];
			case "thinking_level":
				return [session({ type: "session/thinkingLevelChanged", level: event.level })];
			case "name":
				return [session({ type: "session/titleChanged", title: event.name ?? "" })];
			case "message_start": {
				this.messageCounter += 1;
				this.pendingMessageId = `m${this.messageCounter}`;
				return [
					chat({ type: "chat/messageAppended", messageId: this.pendingMessageId, message: event.message }),
				];
			}
			case "message_delta":
				return [
					chat({
						type: "chat/delta",
						messageId: this.pendingMessageId ?? `m${this.messageCounter}`,
						partIndex: event.contentIndex,
						kind: event.kind,
						delta: event.delta,
					}),
				];
			case "message_end": {
				const messageId = this.pendingMessageId ?? `m${this.messageCounter}`;
				this.pendingMessageId = undefined;
				return [chat({ type: "chat/messageUpdated", messageId, message: event.message })];
			}
			case "tool_start":
				return [
					chat({
						type: "chat/toolCallStarted",
						callId: event.callId,
						toolName: event.toolName,
						input: event.input,
						parentCallId: event.parentCallId,
					}),
				];
			case "tool_update":
				return [
					chat({
						type: "chat/toolCallUpdated",
						callId: event.callId,
						toolName: event.toolName,
						output: event.output,
					}),
				];
			case "tool_end":
				return [
					chat({
						type: "chat/toolCallEnded",
						callId: event.callId,
						toolName: event.toolName,
						output: event.output,
						isError: event.isError,
						durationMs: event.durationMs,
					}),
				];
			case "queue":
				return [
					session({ type: "session/queueChanged", steering: event.steering, followUp: event.followUp }),
				];
			case "settled":
				return [chat({ type: "chat/settled", aborted: event.aborted })];
			case "notice":
				return [chat({ type: "chat/notice", level: event.level, message: event.message })];
			default:
				return [];
		}
	}
}
