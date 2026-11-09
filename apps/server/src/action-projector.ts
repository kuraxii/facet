/**
 * 会话事件到通道动作的投影。
 *
 * pi 的消息没有标识,流式增量却需要按消息定位,因此这里给每条新消息分配一个会话内
 * 稳定的标识:出现 message_start 时分配,同一条消息的后续增量与完成事件复用它。
 */
import type { Action, Channel, SessionEvent } from "@facet/protocol";
import { makeChannel } from "@facet/protocol";

/** 消息标识与时间戳保留的条数 */
const MAX_STAMPS = 500;

/** 一条待分发的动作及其归属通道。 */
export interface ChannelAction {
	channel: Channel;
	action: Action;
}

export class ActionProjector {
	private readonly sessionChannel: Channel;
	private readonly chatChannel: Channel;
	/** 已分配的消息序号 */
	private messageCounter = 0;
	/** 正在生成的消息标识,收到 message_end 后清空 */
	private pendingMessageId: string | undefined;
	/** 已发过的消息标识与其角色、时间戳,用于在写盘之后回查条目 */
	private readonly stamps = new Map<string, { role: string; timestamp: number }>();

	constructor(sessionId: string) {
		this.sessionChannel = makeChannel("session", sessionId);
		this.chatChannel = makeChannel("chat", sessionId);
	}

	/** 当前正在生成的消息标识,没有则为空。 */
	get currentMessageId(): string | undefined {
		return this.pendingMessageId;
	}

	/** 取某条消息的角色与时间戳,写盘之后据此在条目里定位。 */
	messageStamp(messageId: string): { role: string; timestamp: number } | undefined {
		return this.stamps.get(messageId);
	}

	/** 记住消息标识与时间戳,只保留最近若干条。 */
	private remember(messageId: string, role: string, timestamp: number): void {
		this.stamps.set(messageId, { role, timestamp });
		while (this.stamps.size > MAX_STAMPS) {
			const oldest = this.stamps.keys().next();
			if (oldest.done) {
				break;
			}
			this.stamps.delete(oldest.value);
		}
	}

	project(event: SessionEvent): ChannelAction[] {
		const session = (action: Action): ChannelAction => ({ channel: this.sessionChannel, action });
		const chat = (action: Action): ChannelAction => ({ channel: this.chatChannel, action });

		switch (event.type) {
			case "status":
				return [session({ type: "session/status", status: event.status })];
			case "model":
				return [session({ type: "session/modelChanged", model: event.model })];
			case "thinking_level":
				return [session({ type: "session/thinkingLevelChanged", level: event.level })];
			case "name":
				return [session({ type: "session/titleChanged", title: event.name ?? "" })];
			case "compaction_start":
				return [session({ type: "session/compactionStarted", reason: event.reason })];
			case "compaction_end":
				return [
					session({
						type: "session/compactionCompleted",
						reason: event.reason,
						tokensBefore: event.tokensBefore,
						estimatedTokensAfter: event.estimatedTokensAfter,
						aborted: event.aborted,
						willRetry: event.willRetry,
						error: event.error,
					}),
				];
			case "message_start": {
				this.messageCounter += 1;
				this.pendingMessageId = `m${this.messageCounter}`;
				this.remember(this.pendingMessageId, event.message.role, event.message.timestamp);
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
				return [chat({ type: "chat/queueChanged", steering: event.steering, followUp: event.followUp })];
			case "run_end":
				return [chat({ type: "chat/turnCompleted", willRetry: event.willRetry })];
			case "settled":
				return [chat({ type: "chat/settled", aborted: event.aborted })];
			case "retry_start":
				return [
					chat({
						type: "chat/retryStarted",
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
						delayMs: event.delayMs,
						error: event.error,
					}),
				];
			case "retry_end":
				return [
					chat({
						type: "chat/retryEnded",
						success: event.success,
						attempt: event.attempt,
						error: event.error,
					}),
				];
			case "notice":
				return [chat({ type: "chat/notice", level: event.level, message: event.message })];
			default:
				return [];
		}
	}
}
