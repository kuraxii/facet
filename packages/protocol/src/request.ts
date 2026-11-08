/**
 * 端点发往设备的请求负载。
 *
 * 这里只定义负载本身，封装与传输由端点层决定。
 */

import type { ApprovalDecision } from "./approval.ts";
import type { InputBlock } from "./content.ts";
import type { ModelRef, ThinkingLevel } from "./model.ts";

/** 会话正在运行时的消息投递方式。steer 插入当前回合之后，followUp 等本轮结束。 */
export type StreamingBehavior = "steer" | "followUp";

/** 发送一条消息。 */
export interface PromptRequest {
	/** 消息正文 */
	text: string;
	/** 随消息发送的图片附件 */
	images?: InputBlock[];
	/** 会话正在运行时必须指定投递方式，缺省时设备侧拒绝 */
	streamingBehavior?: StreamingBehavior;
}

/** 排队一条消息，在当前助手回合的工具调用执行完后插入。 */
export interface QueuePromptRequest {
	text: string;
	images?: InputBlock[];
}

/** 变更模型或思考档位。 */
export interface ModelMutationRequest {
	/** 是否同时写入设备的全局默认值，缺省只影响当前会话 */
	persist?: boolean;
}

/** 切换模型。 */
export interface SetModelRequest extends ModelMutationRequest {
	model: ModelRef;
}

/** 设置思考档位。 */
export interface SetThinkingLevelRequest extends ModelMutationRequest {
	level: ThinkingLevel;
}

/** 设置激活的工具集合。 */
export interface SetActiveToolsRequest {
	names: string[];
}

/** 应答一条审批请求。 */
export interface ApprovalResponseRequest {
	/** 对应的审批请求 id */
	requestId: string;
	/** 应答内容 */
	decision: ApprovalDecision;
}
