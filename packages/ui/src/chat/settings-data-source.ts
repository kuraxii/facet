/**
 * 设置页的数据来源。
 *
 * 由宿主接到设备上；界面不关心这些调用背后是本地还是远端。
 */
import type { CustomProviderInfo, FacetSettings, ModelInfo, ModelRef, ProviderInfo } from "@facet/protocol";

export interface SettingsDataSource {
	/** 读设置 */
	loadSettings: () => Promise<FacetSettings>;
	/** 保存设置，失败时抛错 */
	saveSettings: (settings: FacetSettings) => Promise<FacetSettings>;
	/** 读提供方清单，含授权状态与模型数量 */
	loadProviders: () => Promise<ProviderInfo[]>;
	/** 读全部模型，模型选择与可见性都用它 */
	loadModels: () => Promise<ModelInfo[]>;
	/** 保存提供方凭证，返回更新后的提供方清单 */
	saveCredential: (providerId: string, apiKey: string) => Promise<ProviderInfo[]>;
	/** 删除提供方凭证，返回更新后的提供方清单 */
	deleteCredential: (providerId: string) => Promise<ProviderInfo[]>;
	/** 设置提供方的接口地址，空串恢复默认，返回更新后的提供方清单 */
	setProviderBaseUrl: (providerId: string, baseUrl: string) => Promise<ProviderInfo[]>;
	/** 列出自定义提供方 */
	listCustomProviders: () => Promise<CustomProviderInfo[]>;
	/** 保存自定义提供方，返回更新后的清单 */
	saveCustomProvider: (provider: CustomProviderInfo) => Promise<CustomProviderInfo[]>;
	/** 删除自定义提供方，返回更新后的清单 */
	removeCustomProvider: (providerId: string) => Promise<CustomProviderInfo[]>;
	/** 用指定模型发一次最小请求 */
	testModel: (model: ModelRef) => Promise<{ ok: boolean; latencyMs: number; message?: string }>;
	/** 生成诊断文本 */
	diagnostics: () => Promise<string>;
	/** 保存一段文本到用户选定的文件，取消时返回 false */
	saveText: (suggestedName: string, text: string) => Promise<boolean>;
}
