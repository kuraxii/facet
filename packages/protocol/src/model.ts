/**
 * 模型与提供方的描述，界面与端点共用。
 *
 * 这些结构只含展示与选择所需的字段，不含凭证与请求参数。
 */

/** 模型的思考档位，由低到高。模型不支持的高档位由主机侧夹紧到它支持的上限。 */
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

/**
 * 从上游拉到的一个模型。
 *
 * 上游的 `/v1/models` 一般只给标识与展示名，其余字段（上下文窗口、是否思考）留给用户填。
 */
export interface UpstreamModel {
	/** 模型标识 */
	id: string;
	/** 展示名：上游给了用上游的，没给时从模型信息库补 */
	name?: string;
	/** 上下文窗口，模型信息库里查得到才有 */
	contextWindow?: number;
	/** 单次输出上限，模型信息库里查得到才有 */
	maxTokens?: number;
	/** 是否思考模型，模型信息库里查得到才有 */
	reasoning?: boolean;
	/** 支持的思考档位，模型信息库写明了档位才有；按从低到高排列 */
	thinkingLevels?: ThinkingLevel[];
}

/**
 * pi 的默认设置。
 *
 * 存在 pi 自己的 `settings.json` 里，新建会话时由它开局；两个字段都空表示由 pi 自己决定。
 */
export interface AgentDefaults {
	/** 默认模型 */
	model?: ModelRef;
	/** 默认思考档位 */
	thinkingLevel?: ThinkingLevel;
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
	/** 这个提供方能不能走账号登录；不能就只能填 API key */
	canLogin?: boolean;
	/** 账号登录的按钮文字，由 pi 给的官方说法，例如「Sign in with ChatGPT」；缺省用「登录」 */
	loginLabel?: string;
	/** 当前生效的凭证是不是账号登录（OAuth）拿到的 */
	usingLogin?: boolean;
	/** 当前生效的接口地址：内置的取目录里的，自定义的取自己的配置 */
	baseUrl?: string;
}

/** 自定义提供方里的一个模型。 */
export interface CustomModelInfo {
	/** 模型标识，请求里用它取名 */
	id: string;
	/** 展示名，缺省时用标识 */
	name?: string;
	/**
	 * 支持的思考档位，按从低到高排列。
	 *
	 * 这是界面上勾出来的那一组：含 `off` 表示这个模型能关掉思考，其余档位表示会思考。
	 * 一个会思考的档位都没有时，这个模型按不会思考处理。
	 */
	thinkingLevels?: ThinkingLevel[];
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

/** 登录可以走的两种凭证类型。 */
export type ProviderLoginType = "oauth" | "api_key";

/** 登录时的一步单选题的一个选项。 */
export interface ProviderLoginOption {
	/** 选项标识，选中后原样带回 */
	id: string;
	/** 展示名 */
	label: string;
	/** 补充说明，例如这个选项对应哪个账号体系 */
	description?: string;
}

/**
 * 登录过程中主机要用户回答的一步。
 *
 * 与扩展的交互分开：这里没有标题、没有表单，只有一问一答。`secret` 要遮住输入，
 * `manualCode` 是「浏览器授权没回调成功时把地址粘回来」那一步。
 */
export interface ProviderLoginPrompt {
	/** 这一步的标识，应答时原样带回 */
	promptId: string;
	/** 要什么：普通文本、密钥、单选、粘回调地址 */
	kind: "text" | "secret" | "select" | "manualCode";
	/** 题目 */
	message: string;
	/** 输入框占位 */
	placeholder?: string;
	/** `select` 的选项，其余类型没有 */
	options?: readonly ProviderLoginOption[];
}

/** 登录侧给出的链接。 */
export interface ProviderLoginLink {
	/** 地址 */
	url: string;
	/** 展示文字，缺省时显示地址本身 */
	label?: string;
}

/**
 * 主机推进登录时推给端点的一步。
 *
 * 顺序要紧：`authUrl` / `deviceCode` 之后可能跟着一个 `prompt`，两者同时存在时要一起给出——
 * 浏览器回调与粘贴地址是赛跑关系，哪边先回都算成功，另一边由 `promptResolved` 收掉。
 */
export type ProviderLoginEvent =
	/** 用户先看一条说明，可能带链接 */
	| { type: "info"; message: string; links?: readonly ProviderLoginLink[] }
	/** 要在浏览器里打开的授权地址 */
	| { type: "authUrl"; url: string; instructions?: string }
	/** 设备码登录：把 userCode 显示出来，等用户在 verificationUri 上确认 */
	| {
			type: "deviceCode";
			userCode: string;
			verificationUri: string;
			/** 轮询间隔，界面只用来算倒计时 */
			intervalSeconds?: number;
			/** 有效秒数，缺省表示没有明确期限 */
			expiresInSeconds?: number;
	  }
	/** 需要用户回答的一步 */
	| { type: "prompt"; prompt: ProviderLoginPrompt }
	/** 这一步不用答了：回调先回来，或整条登录被取消 */
	| { type: "promptResolved"; promptId: string }
	/** 进度说明，例如正在换 token */
	| { type: "progress"; message: string }
	/** 登录成功，凭证已经落盘 */
	| { type: "done" }
	/** 登录失败，message 是主机侧的原话 */
	| { type: "failed"; message: string }
	/** 登录被取消 */
	| { type: "cancelled" };

/**
 * 一次登录在端点上的累积状态。
 *
 * 日志只给增量，端点把最近一次能用的那些汇总成这一份，界面照着渲染：`prompt` 与它对应的
 * `authUrl` / `deviceCode` 常常同时在场，一个是等回答，一个是去浏览器里操作。
 */
export interface ProviderLoginState {
	/** 这一次登录的标识 */
	loginId: string;
	/** 登录的是哪个提供方 */
	providerId: string;
	/** 进行到哪一步：跑着、成了、失败了、被取消了 */
	status: "running" | "done" | "failed" | "cancelled";
	/** 待回答的一步，没有就是当前不需要输入 */
	prompt?: ProviderLoginPrompt;
	/** 要在浏览器里打开的授权地址 */
	authUrl?: { url: string; instructions?: string };
	/** 设备码登录的用户码与验证地址 */
	deviceCode?: {
		userCode: string;
		verificationUri: string;
		intervalSeconds?: number;
		expiresInSeconds?: number;
	};
	/** 最近一条说明：进度、提示或失败原因 */
	message?: string;
	/** 说明附带的链接 */
	links?: readonly ProviderLoginLink[];
}
