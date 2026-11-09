import type { ImageBlock, ToolOutput } from "./content.ts";
import type { DeltaKind, NoticeLevel } from "./event.ts";
import type { Message } from "./message.ts";
import type { ModelInfo, ModelRef, ThinkingLevel } from "./model.ts";
import type { StreamingBehavior } from "./request.ts";
import type { CompactionReason, SessionStatus } from "./session.ts";

/** 会话动作。 */
export type SessionAction =
	/** 设备侧:派生状态变化 */
	| { type: "session/status"; status: SessionStatus }
	/** 设备侧:当前模型变化 */
	| { type: "session/modelChanged"; model: ModelInfo | undefined }
	/** 设备侧:思考档位变化 */
	| { type: "session/thinkingLevelChanged"; level: ThinkingLevel }
	/** 设备侧:压缩开始 */
	| { type: "session/compactionStarted"; reason: CompactionReason }
	/** 设备侧:压缩结束,被取消时没有结果 */
	| {
			type: "session/compactionCompleted";
			reason: CompactionReason;
			tokensBefore: number | undefined;
			estimatedTokensAfter: number | undefined;
			aborted: boolean;
			willRetry: boolean;
			error: string | undefined;
	  }
	/** 客户端可派发:会话改名 */
	| { type: "session/titleChanged"; title: string }
	/** 客户端可派发:变更模型、思考档位或激活的工具 */
	| {
			type: "session/configChanged";
			model?: ModelRef;
			thinkingLevel?: ThinkingLevel;
			activeToolNames?: string[];
			/** 是否同时写入设备的全局默认值 */
			persist?: boolean;
	  };

/** 对话动作。 */
export type ChatAction =
	/** 设备侧:新消息开始,messageId 由设备分配并在该消息生命周期内稳定 */
	| { type: "chat/messageAppended"; messageId: string; message: Message }
	/** 设备侧:消息完成或追加新内容,沿用 messageAppended 的 messageId */
	| { type: "chat/messageUpdated"; messageId: string; message: Message }
	/** 设备侧:流式增量,partIndex 对应消息内容块的下标 */
	| { type: "chat/delta"; messageId: string; partIndex: number; kind: DeltaKind; delta: string }
	/** 设备侧:工具开始执行 */
	| { type: "chat/toolCallStarted"; callId: string; toolName: string; input: unknown; parentCallId?: string }
	/** 设备侧:工具的流式中间输出 */
	| { type: "chat/toolCallUpdated"; callId: string; toolName: string; output: ToolOutput }
	/** 设备侧:工具执行结束 */
	| {
			type: "chat/toolCallEnded";
			callId: string;
			toolName: string;
			output: ToolOutput;
			isError: boolean;
			durationMs?: number;
	  }
	/** 设备侧:排队内容变化 */
	| { type: "chat/queueChanged"; steering: string[]; followUp: string[] }
	/** 设备侧:一轮结束,willRetry 为真时后续还有重试 */
	| { type: "chat/turnCompleted"; willRetry: boolean }
	/** 设备侧:会话不会再自动继续,唯一的终局信号 */
	| { type: "chat/settled"; aborted: boolean }
	/** 设备侧:自动重试开始 */
	| { type: "chat/retryStarted"; attempt: number; maxAttempts: number; delayMs: number; error: string }
	/** 设备侧:自动重试结束 */
	| { type: "chat/retryEnded"; success: boolean; attempt: number; error: string | undefined }
	/** 设备侧:提示,例如扩展发出的通知 */
	| { type: "chat/notice"; level: NoticeLevel; message: string }
	/** 客户端可派发:发送一条消息 */
	| { type: "chat/turnStarted"; text: string; images?: ImageBlock[]; streamingBehavior?: StreamingBehavior }
	/** 客户端可派发:中止当前运行 */
	| { type: "chat/turnCancelled" }
	/** 客户端可派发:排队一条消息,steering 插入当前回合之后,queued 等本轮结束 */
	| { type: "chat/pendingMessageSet"; kind: "steering" | "queued"; text: string }
	/** 客户端可派发:清空排队 */
	| { type: "chat/queueCleared" };

/** 动作联合。按 `type` 前缀决定归属通道。 */
export type Action = SessionAction | ChatAction;

/** 动作来源。缺省表示设备侧产生。 */
export interface ActionOrigin {
	/** 连接建立时设备分配的端标识 */
	clientId: string;
	/** 该端自己的递增序号,用于重连后对账去重 */
	clientSeq: number;
}

/** 通道种类与动作前缀的对应关系。 */
export function channelKindForAction(action: Action): "session" | "chat" {
	return action.type.startsWith("session/") ? "session" : "chat";
}
