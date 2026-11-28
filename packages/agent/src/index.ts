/**
 * 对外出口。
 *
 * 只放出 PiAgent、PiAgentFactory 与 facet 自有类型，pi SDK 的类型不外露。
 */
export type { AcpAgentOptions, AcpTransportTarget } from "./acp/acp-agent.ts";
export { AcpAgent, formatAcpInitFailure } from "./acp/acp-agent.ts";
export type { AgentHandshakeProbe, CommandProbeEnv } from "./acp/acp-registry.ts";
export {
	ACP_REGISTRY_ENV,
	ACP_REGISTRY_FILENAME,
	AcpRegistryStore,
	BUILTIN_ACP_PROFILES,
	inspectAcpAvailability,
	mergeAcpProfiles,
	normalizeAcpProfile,
	resolveCommandPath,
} from "./acp/acp-registry.ts";
export type { AcpAgentRuntimeOptions } from "./acp/acp-runtime.ts";
export { AcpAgentRuntime } from "./acp/acp-runtime.ts";
export type { AcpSessionRecord } from "./acp/acp-session-index.ts";
export { AcpSessionIndex } from "./acp/acp-session-index.ts";
export type { ManagedAgent } from "./agent-contract.ts";
export { writeFileAtomic } from "./atomic-write.ts";
export type { CustomModelEntry, CustomProviderEntry } from "./model-config-store.ts";
export { InvalidProviderError } from "./model-config-store.ts";
export type { PageWindow } from "./paging.ts";
export { pageOf } from "./paging.ts";
export {
	DEFAULT_AGENT_DIR,
	DEFAULT_FACET_HOME,
	DEV_AGENT_DIR,
	DEV_FACET_HOME,
	expandPath,
	resolveFacetHome,
} from "./paths.ts";
export { FACET_COMMANDS, PiAgent } from "./pi-agent.ts";
export type { ScanSessionProjectsOptions, SessionProject } from "./projects.ts";
export {
	listSessionFiles,
	normalizeProjectPath,
	projectIdOf,
	projectPathKey,
	scanSessionProjects,
} from "./projects.ts";
export type {
	ProviderLoginListener,
	ProviderLoginRuntime,
	ProviderLoginStart,
	ProviderLoginUpdate,
} from "./provider-login.ts";
export { ProviderLoginBusyError, ProviderLoginService } from "./provider-login.ts";
export type {
	ForkPiAgentOptions,
	OpenPiAgentOptions,
	PiAgentFactoryOptions,
	PiAgentLaunchOptions,
} from "./runtime.ts";
export { PiAgentFactory } from "./runtime.ts";
export type { SessionCatalogOptions } from "./session-catalog.ts";
export { SessionCatalog } from "./session-catalog.ts";
export { renamePersistedSession } from "./session-rename.ts";
export type { SessionFileHeader, SessionFileStats } from "./session-scan.ts";
export {
	readFirstUserMessage,
	readSessionHeader,
	readSessionName,
	readSessionSummary,
	statSessionFile,
} from "./session-scan.ts";
export type { ThinkingLevelMap, ThinkingLevelMapValue } from "./thinking-levels.ts";
export {
	hasThinking,
	levelsFromMap,
	levelsToMap,
	normalizeLevels,
	THINKING_LEVELS,
} from "./thinking-levels.ts";
export type * from "./types.ts";
export type {
	CatalogIndex,
	CatalogModel,
	FetchUpstreamModelsOptions,
	FetchUpstreamModelsResult,
} from "./upstream-models.ts";
export {
	buildCatalogIndex,
	catalogLookupKeys,
	enrichUpstreamModels,
	fetchUpstreamModels,
	looksLikeModelList,
	modelListCandidates,
	parseUpstreamModels,
} from "./upstream-models.ts";
