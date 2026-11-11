/**
 * 模型与提供方的描述，界面与端点共用。
 *
 * 这些结构只含展示与选择所需的字段，不含凭证与请求参数。
 */

/** 模型的思考档位，由低到高。模型不支持的高档位由设备侧夹紧到它支持的上限。 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** 模型支持的输入模态。 */
export type InputModality = "text" | "image";

/** 按百万 token 计价的分项单价，单位为美元。 */
export interface CostBreakdown {
	/** 输入 token 单价 */
	input: number;
	/** 输出 token 单价 */
	output: number;
	/** 命中缓存读取的单价 */
	cacheRead: number;
	/** 写入缓存的单价 */
	cacheWrite: number;
}

/** 一次请求的总成本，在分项之外另计合计值。 */
export interface Cost extends CostBreakdown {
	total: number;
}

/** 模型的定位键，跨进程与跨语言都能直接使用。 */
export interface ModelRef {
	/** 提供方 id，例如 anthropic */
	provider: string;
	/** 提供方内的模型 id */
	id: string;
}

/** 模型的可展示信息，用于模型选择器与设置面板。 */
export interface ModelInfo extends ModelRef {
	/** 展示名 */
	name: string;
	/** 接口协议，例如 anthropic-messages、openai-responses */
	api: string;
	/** 是否支持 thinking */
	reasoning: boolean;
	/** 上下文窗口，单位 token */
	contextWindow: number;
	/** 单次响应的最大输出 token */
	maxTokens: number;
	/** 支持的输入模态 */
	input: InputModality[];
	/** 分项单价 */
	cost: CostBreakdown;
}

/** 提供方及其凭证状态。 */
export interface ProviderInfo {
	/** 提供方 id */
	id: string;
	/** 展示名 */
	name: string;
	/** 是否已配置凭证 */
	authenticated: boolean;
	/** 目录内的模型数量 */
	modelCount: number;
	/** 凭证来源，例如环境变量名或 OAuth；没有凭证时为空 */
	authSource?: string;
	/** 是否为订阅类登录（OAuth） */
	subscription?: boolean;
	/** 当前生效的接口地址 */
	baseUrl?: string;
	/** 写在模型配置里的地址覆写，没有覆写时为空 */
	baseUrlOverride?: string;
}

/** 自定义提供方里的一个模型。 */
export interface CustomModelInfo {
	/** 模型标识，请求里用它取名 */
	id: string;
	/** 展示名，缺省时用标识 */
	name?: string;
	/** 是否支持思考 */
	reasoning?: boolean;
	/** 上下文窗口 */
	contextWindow?: number;
	/** 单次最大输出 token */
	maxTokens?: number;
}

/** 用户自己添加的提供方。 */
export interface CustomProviderInfo {
	/** 提供方标识 */
	id: string;
	/** 展示名 */
	name: string;
	/** 接口地址 */
	baseUrl: string;
	/** 接口协议，例如 openai-completions */
	api: string;
	/** 模型清单，至少一个 */
	models: CustomModelInfo[];
}

/** 保存自定义提供方的入参，字段要求与 CustomProviderInfo 相同。 */
export type CustomProviderInput = CustomProviderInfo;
