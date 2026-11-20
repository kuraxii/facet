import type { ImageBlock, ToolOutput } from "./content.ts";
import type { DeltaKind, NoticeLevel } from "./event.ts";
import type { ExtensionUiState, SessionInitialization } from "./extension-ui.ts";
import type { Message } from "./message.ts";
import type { ModelInfo, ModelRef, ProviderLoginEvent, ThinkingLevel } from "./model.ts";
import type { StreamingBehavior } from "./request.ts";
import type { ContextUsage, Maintenance, SessionStatus, SessionSummary, TurnPhase } from "./session.ts";
import type { TerminalAction } from "./terminal.ts";

/** 会话清单动作。主机推给所有订阅清单通道的端,多端看到同一份列表。 */
export type SessionsAction =
	/** 新建、改名或一轮结束之后,用新的摘要覆盖同路径的那一条 */
	| { type: "sessions/changed"; summary: SessionSummary; status: SessionStatus }
	/** 状态迁移，只改状态不动摘要：主机为此不读会话文件 */
	| { type: "sessions/status"; path: string; status: SessionStatus }
	/** 会话文件被删掉 */
	| { type: "sessions/removed"; path: string };

/**
 * 模型通道动作。
 *
 * 一个主机一条通道，承载与具体会话无关的模型侧状态：目前只有提供方登录的推进。
 * 登录与会话无关（凭证属于整个主机），因此不挂在会话通道上。
 */
export type ModelsAction =
	/** 主机侧：登录往前走了一步，端点按 loginId 归入那次登录 */
	{ type: "models/loginEvent"; loginId: string; providerId: string; event: ProviderLoginEvent };

/**
 * 工作树动作。一个项目目录一条通道，主机盯着这个目录并推出变化。
 *
 * 只推“变了”这一件事，不带具体文件与状态：状态由端自己按需取，多个端因此拿到各自时刻
 * 的快照，不用主机为每个端缓存一份。
 */
export type WorkspaceAction =
	/** 工作树或提交历史有变化；`history` 为真表示 HEAD、索引或引用动过，提交历史也可能变了 */
	{ type: "workspace/changed"; history: boolean };

/** 会话动作。 */
export type SessionAction =
	| { type: "session/initialized"; initialization: SessionInitialization }
	| { type: "session/uiChanged"; ui: ExtensionUiState }
	/** 主机侧:阶段或维护动作变化 */
	| { type: "session/phase"; phase: TurnPhase; maintenance: Maintenance | undefined }
	/** 主机侧:当前模型变化，同时给出换模型之后可选的思考档位 */
	| {
			type: "session/modelChanged";
			model: ModelInfo | undefined;
			availableThinkingLevels: ThinkingLevel[];
	  }
	/** 主机侧:思考档位变化 */
	| { type: "session/thinkingLevelChanged"; level: ThinkingLevel }
	/** 主机侧:排队内容变化 */
	| { type: "session/queueChanged"; steering: string[]; followUp: string[] }
	/** 客户端可派发:会话改名 */
	| { type: "session/titleChanged"; title: string }
	/** 客户端可派发:排队一条消息,steering 插入当前回合之后,queued 等本轮结束 */
	| { type: "session/pendingMessageSet"; kind: "steering" | "queued"; text: string }
	/** 客户端可派发:清空排队 */
	| { type: "session/queueCleared" }
	/** 客户端可派发:手动压缩上下文 */
	| { type: "session/compact" }
	/** 主机侧:上下文用量变化，一轮结束或压缩之后重新估算 */
	| { type: "session/usageChanged"; usage: ContextUsage | undefined }
	/** 客户端可派发:变更模型、思考档位或激活的工具 */
	| {
			type: "session/configChanged";
			model?: ModelRef;
			thinkingLevel?: ThinkingLevel;
			activeToolNames?: string[];
			/** 是否同时写入主机的全局默认值 */
			persist?: boolean;
	  };

/** 对话动作。 */
export type ChatAction =
	/** 发起端收到的输入消费回执；origin 对应原始派发，不写入通道历史。 */
	| { type: "chat/inputHandled" }
	/** 主机侧:新消息开始,messageId 由主机分配并在该消息生命周期内稳定 */
	| { type: "chat/messageAppended"; messageId: string; message: Message }
	/** 主机侧:消息完成或追加新内容,沿用 messageAppended 的 messageId */
	| { type: "chat/messageUpdated"; messageId: string; message: Message }
	/** 主机侧:流式增量,partIndex 对应消息内容块的下标 */
	| { type: "chat/delta"; messageId: string; partIndex: number; kind: DeltaKind; delta: string }
	/** 主机侧:工具开始执行 */
	| { type: "chat/toolCallStarted"; callId: string; toolName: string; input: unknown }
	/** 主机侧:工具的流式中间输出 */
	| { type: "chat/toolCallUpdated"; callId: string; toolName: string; output: ToolOutput }
	/** 主机侧:工具执行结束 */
	| {
			type: "chat/toolCallEnded";
			callId: string;
			toolName: string;
			output: ToolOutput;
			isError: boolean;
			durationMs?: number;
	  }
	/** 主机侧:会话不会再自动继续,唯一的终局信号 */
	| { type: "chat/settled"; aborted: boolean }
	/** 主机侧:提示,例如扩展发出的通知 */
	| { type: "chat/notice"; level: NoticeLevel; message: string }
	/** 客户端可派发:发送一条消息 */
	| { type: "chat/turnStarted"; text: string; images?: ImageBlock[]; streamingBehavior?: StreamingBehavior }
	/** 客户端可派发:中止当前运行 */
	| { type: "chat/turnCancelled" }
	/**
	 * 客户端可派发:回退到这条用户消息之前。
	 *
	 * 分支指针挪到它的前一条,会话文件保持只追加;之后的消息在文件里另成一条分支。
	 */
	| { type: "chat/revertTo"; entryId: string }
	/** 主机侧:分支指针移动过,客户端据此重新装载历史 */
	| { type: "chat/branchMoved"; leafId: string | null };

/** 动作联合。按 `type` 前缀决定归属通道。 */
export type Action =
	| SessionAction
	| ChatAction
	| SessionsAction
	| TerminalAction
	| ModelsAction
	| WorkspaceAction;

/** 动作来源。缺省表示主机侧产生。 */
export interface ActionOrigin {
	/** 连接建立时主机分配的端标识 */
	clientId: string;
	/** 该端自己的递增序号,用于重连后对账去重 */
	clientSeq: number;
}

/** 通道种类与动作前缀的对应关系。终端、清单、模型与工作树动作只由主机产生，不参与端的派发。 */
export function channelKindForAction(
	action: Action,
): "session" | "chat" | "terminal" | "sessions" | "models" | "workspace" {
	if (action.type.startsWith("terminal/")) {
		return "terminal";
	}
	if (action.type.startsWith("sessions/")) {
		return "sessions";
	}
	if (action.type.startsWith("models/")) {
		return "models";
	}
	if (action.type.startsWith("workspace/")) {
		return "workspace";
	}
	return action.type.startsWith("session/") ? "session" : "chat";
}
