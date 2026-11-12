/**
 * 会话消息。
 *
 * 角色与字段与持久化记录一致，界面按 role 分派渲染，未知角色降级为占位消息。
 */
import type { ContentBlock, InputBlock } from "./content.ts";
import type { Cost } from "./model.ts";

/** 模型调用的用量。reasoning 已包含在 output 内，不重复累加。 */
export interface Usage {
	input: number;
	output: number;
	/** 命中缓存的输入 token */
	cacheRead: number;
	/** 写入缓存的输入 token */
	cacheWrite: number;
	/** 推理 token，已计入 output */
	reasoning: number;
	/** 全部 token 合计 */
	totalTokens: number;
	/** 本次调用成本 */
	cost: Cost;
}

/**
 * 助手回复的终止原因。
 *
 * pending 只出现在流式过程中的部分消息里；deferred 表示提供方要求稍后取回；
 * aborted 与 error 需要界面给出对应提示。
 */
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

/** 系统消息，承载提示词与工具声明。界面通常不渲染。 */
export interface SystemMessage {
	role: "system";
	/** 纯文本内容，多段文本块按换行拼接 */
	content: string;
	/** Unix 毫秒时间戳 */
	timestamp: number;
}

/** 用户消息。 */
export interface UserMessage {
	role: "user";
	/** 文本与图片内容块 */
	content: InputBlock[];
	timestamp: number;
}

/** 助手消息。 */
export interface AssistantMessage {
	role: "assistant";
	content: ContentBlock[];
	/** 实际响应来自的提供方 */
	provider: string;
	/** 实际响应来自的模型，虚拟模型路由时与请求的模型不同 */
	model: string;
	usage: Usage;
	stopReason: StopReason;
	/** 失败或中止时的错误说明 */
	errorMessage?: string;
	/** 这一次模型调用的耗时,历史记录里可能缺失 */
	durationMs?: number;
	timestamp: number;
}

/** 工具结果消息。 */
export interface ToolResultMessage {
	role: "toolResult";
	/** 对应的工具调用 id */
	callId: string;
	/** 产生结果的工具名 */
	toolName: string;
	content: InputBlock[];
	/** 工具专属的结构化数据 */
	details?: unknown;
	/** 结果是否为失败 */
	isError: boolean;
	/** 工具执行耗时,历史记录里可能缺失 */
	durationMs?: number;
	timestamp: number;
}

/** 直接执行的命令记录。 */
export interface BashMessage {
	role: "bashExecution";
	command: string;
	output: string;
	/** 进程退出码，被取消时可能为空 */
	exitCode: number | undefined;
	/** 是否被用户取消 */
	cancelled: boolean;
	/** 输出是否被截断 */
	truncated: boolean;
	/** 截断时完整输出的文件路径 */
	fullOutputPath?: string;
	timestamp: number;
}

/** 压缩后插入的摘要消息，界面据此在历史里划出压缩分界。 */
export interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	/** 压缩前的上下文 token 数 */
	tokensBefore: number;
	timestamp: number;
}

/** 离开某个分支时生成的摘要，进入新分支后作为历史的一部分。 */
export interface BranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	/** 被离开的分支起点条目 id，为空表示没有起点 */
	fromId: string | null;
	timestamp: number;
}

/** 扩展或主机侧注入的自定义消息。 */
export interface CustomMessage {
	role: "custom";
	/** 自定义类型标记，由写入方决定 */
	customType: string;
	/** 纯文本内容 */
	content: string;
	/** 是否在界面上展示 */
	display: boolean;
	/** 私有数据，不发送给模型 */
	details?: unknown;
	timestamp: number;
}

/** 无法识别的消息角色，用于向前兼容新增的角色。 */
export interface UnknownMessage {
	role: "unknown";
	/** 原始角色名 */
	rawRole: string;
	timestamp: number;
}

/** 会话消息的联合类型。 */
export type Message =
	| SystemMessage
	| UserMessage
	| AssistantMessage
	| ToolResultMessage
	| BashMessage
	| CompactionSummaryMessage
	| BranchSummaryMessage
	| CustomMessage
	| UnknownMessage;
