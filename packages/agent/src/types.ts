/**
 * agent 包自身的类型。
 *
 * 跨边界的结构由 @facet/protocol 定义，这里只保留 PiAgent 的选项与依赖 AbortSignal 的
 * 回调，避免把设备侧的实现细节带进协议层。
 */
import type { ImageBlock, StreamingBehavior } from "@facet/protocol";

/** 发送一条消息时附带的可选参数。 */
export interface PromptOptions {
	/** 随消息发送的图片附件 */
	images?: ImageBlock[];
	/** 会话正在运行时的投递方式，缺省时由 prompt 直接拒绝 */
	streamingBehavior?: StreamingBehavior;
}

/** 模型与思考档位变更时的可选参数。 */
export interface ModelMutationOptions {
	/** 是否同时写入设备的全局默认值，缺省只影响当前会话 */
	persist?: boolean;
}
