/**
 * 设置页数据源适配器（按指定 `HostRuntime` 路由 RPC）。
 */
import type { SettingsDataSource } from "@facet/ui";
import { useMemo } from "react";
import { bridge } from "../bridge.ts";
import type { HostRuntime } from "../host-runtime.ts";

/** 为指定主机运行时生成设置页数据源。 */
export function useSettingsData(runtime: HostRuntime, onAgentsChanged: () => void): SettingsDataSource {
	const client = runtime.client;
	return useMemo<SettingsDataSource>(
		() => ({
			loadSettings: () => client.getSettings(),
			saveSettings: (next) => client.saveSettings(next),
			loadTerminalProfiles: () => client.listTerminalProfiles(),
			loadProviders: () => client.listProviders(),
			loadModels: () => client.listModels(),
			saveCredential: (providerId, apiKey) =>
				client.saveCredential(providerId, apiKey).then(async (providers) => {
					await runtime.refreshCatalog();
					return providers;
				}),
			deleteCredential: (providerId) =>
				client.deleteCredential(providerId).then(async (providers) => {
					await runtime.refreshCatalog();
					return providers;
				}),
			providerLogin: (providerId) => client.store.providerLogin(providerId),
			subscribeProviderLogin: (listener) => client.store.subscribe(listener),
			startProviderLogin: (providerId, authType) => client.startProviderLogin(providerId, authType),
			respondProviderLogin: (loginId, promptId, value) =>
				client.respondProviderLogin(loginId, promptId, value),
			cancelProviderLogin: (loginId) => client.cancelProviderLogin(loginId),
			fetchProviderModels: (input) => client.fetchProviderModels(input),
			listCustomProviders: () => client.listCustomProviders(),
			saveCustomProvider: (provider) =>
				client.saveCustomProvider(provider).then(async (providers) => {
					await runtime.refreshCatalog();
					return providers;
				}),
			removeCustomProvider: (providerId) =>
				client.removeCustomProvider(providerId).then(async (providers) => {
					await runtime.refreshCatalog();
					return providers;
				}),
			testModel: (model) => client.testModel(model),
			loadAgentDefaults: () => client.getAgentDefaults(),
			saveAgentDefaults: (patch) => client.setAgentDefaults(patch),
			diagnostics: () => client.diagnostics(),
			saveText: (suggestedName, text) => bridge.saveText(suggestedName, text),
			loadAgents: () => client.listAgents(),
			probeAgent: (agentId) =>
				client.probeAgent(agentId).then((agent) => {
					onAgentsChanged();
					return agent;
				}),
			acpLoginStart: (agentId) => client.acpLoginStart(agentId),
			acpLoginSubmit: (loginId, code) =>
				client.acpLoginSubmit(loginId, code).then((agent) => {
					onAgentsChanged();
					return agent;
				}),
			acpLoginCancel: (loginId) => client.acpLoginCancel(loginId),
		}),
		[client, onAgentsChanged, runtime],
	);
}
