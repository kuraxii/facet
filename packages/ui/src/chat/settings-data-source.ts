/**
 * 设置页的数据来源。
 *
 * 由宿主接到主机上；界面不关心这些调用背后是本地还是远端。
 */
import type {
	AgentDefaults,
	CustomProviderInfo,
	FacetSettings,
	ModelInfo,
	ModelRef,
	ProviderInfo,
	ProviderLoginState,
	ProviderLoginType,
	QueueDeliveryMode,
	TerminalProfileInfo,
	ThinkingLevel,
	UpstreamModel,
} from "@facet/protocol";

export interface SettingsDataSource {
	/** 读设置 */
	loadSettings: () => Promise<FacetSettings>;
	/** 保存设置，失败时抛错 */
	saveSettings: (settings: FacetSettings) => Promise<FacetSettings>;
	/** 读 pi 的默认设置（默认模型、思考档位、自动压缩与排队投递方式） */
	loadAgentDefaults: () => Promise<AgentDefaults>;
	/** 改 pi 的默认设置，只传要改的字段；思考档位传 null 表示清掉 */
	saveAgentDefaults: (patch: {
		model?: ModelRef;
		thinkingLevel?: ThinkingLevel | null;
		autoCompaction?: boolean;
		steeringMode?: QueueDeliveryMode;
		followUpMode?: QueueDeliveryMode;
	}) => Promise<AgentDefaults>;
	/** 读提供方清单，含授权状态与模型数量 */
	loadProviders: () => Promise<ProviderInfo[]>;
	/** 读全部模型，模型选择与可见性都用它 */
	loadModels: () => Promise<ModelInfo[]>;
	/** 保存提供方凭证，返回更新后的提供方清单 */
	saveCredential: (providerId: string, apiKey: string) => Promise<ProviderInfo[]>;
	/** 删除提供方凭证，返回更新后的提供方清单 */
	deleteCredential: (providerId: string) => Promise<ProviderInfo[]>;
	/** 某个提供方此刻的登录状态；没有登录过时为空 */
	providerLogin: (providerId: string) => ProviderLoginState | undefined;
	/** 订阅登录状态变化，返回取消订阅函数 */
	subscribeProviderLogin: (listener: () => void) => () => void;
	/** 开始一条登录，返回这次登录的标识 */
	startProviderLogin: (providerId: string, authType: ProviderLoginType) => Promise<string>;
	/** 回答登录中的一步；`value` 传 null 表示放弃整条登录 */
	respondProviderLogin: (loginId: string, promptId: string, value: string | null) => Promise<boolean>;
	/** 中止一条登录 */
	cancelProviderLogin: (loginId: string) => Promise<boolean>;
	/** 从上游拉模型清单（能力字段已用 pi 的模型目录补过）；没给 apiKey 时主机用该提供方已存下的密钥 */
	fetchProviderModels: (input: {
		baseUrl: string;
		providerId?: string;
		apiKey?: string;
		api?: string;
	}) => Promise<{ models: UpstreamModel[]; baseUrl: string }>;
	/** 列出自定义提供方 */
	listCustomProviders: () => Promise<CustomProviderInfo[]>;
	/** 保存自定义提供方，返回更新后的清单 */
	saveCustomProvider: (provider: CustomProviderInfo) => Promise<CustomProviderInfo[]>;
	/** 删除自定义提供方，返回更新后的清单 */
	removeCustomProvider: (providerId: string) => Promise<CustomProviderInfo[]>;
	/** 用指定模型发一次最小请求 */
	testModel: (model: ModelRef) => Promise<{ ok: boolean; latencyMs: number; message?: string }>;
	/** 读主机上可用的终端，顺序即「更可能是用户想要的」 */
	loadTerminalProfiles: () => Promise<TerminalProfileInfo[]>;
	/** 生成诊断文本 */
	diagnostics: () => Promise<string>;
	/** 保存一段文本到用户选定的文件，取消时返回 false */
	saveText: (suggestedName: string, text: string) => Promise<boolean>;
}
