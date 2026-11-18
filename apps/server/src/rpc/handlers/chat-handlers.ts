/**
 * 对话域的处理器。
 *
 * 这一域只有客户端派发的动作，没有一问一答的请求：发送、中止、回退、改配置都由通道上的
 * 动作反映结果，端点只回「受理」或一条带原因的拒绝帧。
 */
import type { Channel } from "@facet/protocol";
import { type Connection, RequestError, type RpcContext } from "../context.ts";

/** 客户端可以派发的动作。主机侧产生的动作不在这里。 */
export type DispatchableAction =
	| { type: "chat/turnStarted"; text: string; images?: unknown; streamingBehavior?: "steer" | "followUp" }
	| { type: "chat/turnCancelled" }
	| { type: "chat/revertTo"; entryId: string }
	| { type: "session/titleChanged"; title: string }
	| { type: "session/pendingMessageSet"; kind: "steering" | "queued"; text: string }
	| { type: "session/queueCleared" }
	| { type: "session/compact" }
	| {
			type: "session/configChanged";
			model?: { provider: string; id: string };
			thinkingLevel?: string;
			activeToolNames?: string[];
			persist?: boolean;
	  };

/** 一次派发带上来的上下文。 */
export interface DispatchCall {
	/** 主机侧上下文 */
	readonly context: RpcContext;
	/** 发起这条动作的连接 */
	readonly connection: Connection;
	/** 动作归属的通道 */
	readonly channel: Channel;
	/** 通道上的会话标识，动作本身不带 sessionId */
	readonly sessionId: string;
}

/** 动作名到动作处理器。返回值 `handled` 表示要给发起方补一条消费回执。 */
export type DispatchHandlerMap = {
	[K in DispatchableAction["type"]]: (
		action: Extract<DispatchableAction, { type: K }>,
		call: DispatchCall,
	) => Promise<"handled" | undefined> | "handled" | undefined;
};

/** 已经过契约校验的动作，处理器按 type 取值。 */
export const chatHandlers: DispatchHandlerMap = {
	"chat/turnCancelled": async (_action, { context, sessionId }) => {
		// 先抬取消水位：此刻还排在队列里的回合出队时会看到它，直接放弃启动
		context.hub.cancelPendingTurns(sessionId);
		// UI 等待可能占用串行队列，停止入口必须直接解除等待。
		const lease = context.hub.hold(sessionId);
		try {
			await context.hub.agent(sessionId).abort();
		} finally {
			lease.release();
		}
		return undefined;
	},

	"chat/revertTo": async (action, { context, sessionId }) => {
		// 回退要挪分支指针，还得往外广播，自己持有会话，不走串行执行那段
		await context.hub.revertTo(sessionId, action.entryId);
		return undefined;
	},

	"chat/turnStarted": async (action, { context, sessionId }) => {
		let handled = false;
		// 票要在入队之前领：排队期间来的取消由它记下
		const ticket = context.hub.turnTicket(sessionId);
		// 同一会话的动作串行执行，执行期间持有会话，不会被空闲回收
		await context.hub.withSession(sessionId, async (agent) => {
			if (ticket.cancelled()) {
				// 出队时已经取消过：绝不启动底层运行，否则这一轮没人会停
				return;
			}
			if (agent.isStreaming && action.streamingBehavior === undefined) {
				throw new RequestError("rejected", "session is running, streamingBehavior is required");
			}
			// prompt 在运行开始后返回，这里不会挂到整轮结束；启动、排队、被扩展消费都算受理
			await agent.prompt(action.text, {
				images: action.images as never,
				streamingBehavior: action.streamingBehavior,
			});
			handled = true;
		});
		return handled ? "handled" : undefined;
	},

	"session/compact": async (_action, { context, sessionId }) => {
		// 压缩要读整条分支写摘要，与运行中的回合不能同时进行
		await context.hub.withSession(sessionId, async (agent) => {
			if (agent.isBusy) {
				throw new RequestError(
					"rejected",
					"This turn has not finished; wait for it to stop before compacting context",
				);
			}
			await agent.compact();
		});
		return undefined;
	},

	"session/pendingMessageSet": async (action, { context, sessionId }) => {
		let handled = false;
		await context.hub.withSession(sessionId, async (agent) => {
			// 进队列与当场被消费都算受理，端点据此收起输入框里的原文
			if (action.kind === "steering") {
				await agent.steer(action.text);
			} else {
				await agent.followUp(action.text);
			}
			handled = true;
		});
		return handled ? "handled" : undefined;
	},

	"session/queueCleared": async (_action, { context, sessionId }) => {
		await context.hub.withSession(sessionId, async (agent) => {
			agent.clearQueue();
		});
		return undefined;
	},

	"session/titleChanged": async (action, { context, sessionId }) => {
		await context.hub.withSession(sessionId, async (agent) => {
			agent.setName(action.title);
		});
		return undefined;
	},

	"session/configChanged": async (action, { context, sessionId }) => {
		await context.hub.withSession(sessionId, async (agent) => {
			if (action.model !== undefined) {
				await agent.setModel(action.model, { persist: action.persist });
			}
			if (action.thinkingLevel !== undefined) {
				await agent.setThinkingLevel(action.thinkingLevel as never, { persist: action.persist });
			}
			if (action.activeToolNames !== undefined) {
				agent.setActiveTools(action.activeToolNames);
			}
		});
		return undefined;
	},
};
