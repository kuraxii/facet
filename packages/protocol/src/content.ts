/**
 * 消息内容块。
 *
 * 只保留界面渲染与回放需要的字段，提供方的签名与不透明元数据不跨边界传输。
 */

/** 文本内容块。 */
export interface TextBlock {
	type: "text";
	text: string;
}

/** 图片内容块，data 为 base64 编码。 */
export interface ImageBlock {
	type: "image";
	/** base64 编码的图片数据 */
	data: string;
	/** 媒体类型，例如 image/png */
	mimeType: string;
}

/** 思考内容块。redacted 为真时 thinking 可能为空，内容放在提供方不透明字段里。 */
export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
	/** 是否被提供方隐藏 */
	redacted: boolean;
}

/** 助手发出的工具调用块。 */
export interface ToolCallBlock {
	type: "toolCall";
	/** 调用 id，与工具结果和工具执行事件对应 */
	id: string;
	/** 工具名 */
	name: string;
	/** 调用参数，结构由工具的 schema 决定 */
	arguments: Record<string, unknown>;
}

/** 消息内容块的全集，用于助手消息。 */
export type ContentBlock = TextBlock | ImageBlock | ThinkingBlock | ToolCallBlock;

/** 可作为用户输入的内容块，只含文本与图片。 */
export type InputBlock = TextBlock | ImageBlock;

/** 工具输出的中间结果与最终结果共用的形状。 */
export interface ToolOutput {
	content: InputBlock[];
	/** 工具专属的结构化数据，供界面渲染使用 */
	details?: unknown;
	/** 是否为失败结果 */
	isError?: boolean;
}
