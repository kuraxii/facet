/**
 * 主机系统域的请求处理器：模型与凭证、项目清单、文件与 git、设置与诊断。
 *
 * 参数形状已由生成物校验，这里只处理语义：目录必须存在且在项目根内、项目必须登记过。
 */
import { type CustomProviderEntry, fetchUpstreamModels } from "@facet/agent";
import { type CustomProviderInfo, PROTOCOL_VERSION, type RequestResults } from "@facet/protocol";
import { buildDiagnostics } from "../../diagnostics.ts";
import { listDirectory, readTextFile, writeTextFile } from "../../files.ts";
import { gitCommit, gitCommitDiff, gitDiff } from "../../git.ts";
import { ProjectNotFoundError } from "../../project-store.ts";
import { revealInFileManager } from "../../reveal.ts";
import type { RequestHandlerMap } from "../gateway.ts";
import { asFileError, resolveProjectDirectory } from "../helpers.ts";
import { normalizeProviderInput } from "../provider-input.ts";

/** 系统域负责的方法。 */
type SystemMethod =
	| "models"
	| "availableModels"
	| "providers"
	| "listDirectory"
	| "readFile"
	| "writeFile"
	| "gitStatus"
	| "gitDiff"
	| "gitCommits"
	| "gitCommit"
	| "gitCommitDiff"
	| "listProjects"
	| "addProject"
	| "renameProject"
	| "removeProject"
	| "projectTrust"
	| "setProjectTrust"
	| "revealProject"
	| "revealPath"
	| "getSettings"
	| "updateSettings"
	| "getAgentDefaults"
	| "setAgentDefaults"
	| "saveCredential"
	| "deleteCredential"
	| "providerLoginStart"
	| "providerLoginRespond"
	| "providerLoginCancel"
	| "diagnostics"
	| "testModel"
	| "listCustomProviders"
	| "fetchProviderModels"
	| "saveCustomProvider"
	| "removeCustomProvider";

/**
 * 自定义提供方清单。
 *
 * 工厂那边的 `models` 是只读数组，线格式里是可写的；两者元素相同，只差数组的只读修饰。
 * 这里逐层复制一份，界面拿到的是自己的副本，不会回写工厂的缓存。
 */
function customProviderList(providers: readonly CustomProviderEntry[]): CustomProviderInfo[] {
	return providers.map((provider) => ({
		...provider,
		models: provider.models.map((model) => ({ ...model })),
	}));
}

export const systemHandlers: Pick<RequestHandlerMap, SystemMethod> = {
	models: (params, context): RequestResults["models"] => ({
		models: context.factory.models(params.providerId),
	}),

	availableModels: async (_params, context): Promise<RequestResults["availableModels"]> => ({
		models: await context.factory.availableModels(),
	}),

	providers: (_params, context): RequestResults["providers"] => ({
		providers: context.factory.providers(),
	}),

	listDirectory: async (params): Promise<RequestResults["listDirectory"]> => {
		const cwd = await resolveProjectDirectory(params.cwd);
		return { entries: await asFileError(listDirectory(cwd, params.path)) };
	},

	readFile: async (params): Promise<RequestResults["readFile"]> => {
		const cwd = await resolveProjectDirectory(params.cwd);
		return await asFileError(readTextFile(cwd, params.path));
	},

	writeFile: async (params): Promise<RequestResults["writeFile"]> => {
		const cwd = await resolveProjectDirectory(params.cwd);
		return await asFileError(writeTextFile(cwd, params.path, params.content, params.expectedRevision));
	},

	gitStatus: async (params, context): Promise<RequestResults["gitStatus"]> =>
		await context.gitRefresh.status(await resolveProjectDirectory(params.cwd), {
			force: params.force === true,
		}),

	gitDiff: async (params): Promise<RequestResults["gitDiff"]> => {
		const cwd = await resolveProjectDirectory(params.cwd);
		return await gitDiff(cwd, params.path, params.untracked === true);
	},

	gitCommits: async (params, context): Promise<RequestResults["gitCommits"]> =>
		await context.gitRefresh.commits(await resolveProjectDirectory(params.cwd), {
			force: params.force === true,
			...(params.limit === undefined ? {} : { limit: params.limit }),
			...(params.skip === undefined ? {} : { skip: params.skip }),
		}),

	gitCommit: async (params): Promise<RequestResults["gitCommit"]> => {
		const cwd = await resolveProjectDirectory(params.cwd);
		return await gitCommit(cwd, params.sha);
	},

	gitCommitDiff: async (params): Promise<RequestResults["gitCommitDiff"]> => {
		const cwd = await resolveProjectDirectory(params.cwd);
		return await gitCommitDiff(cwd, params.sha, params.path, params.oldPath);
	},

	listProjects: (_params, context): RequestResults["listProjects"] => ({
		projects: [...context.projectStore.list()],
	}),

	addProject: async (params, context): Promise<RequestResults["addProject"]> => {
		const cwd = await resolveProjectDirectory(params.cwd);
		return await context.projectStore.add({ cwd, name: params.name });
	},

	renameProject: async (params, context): Promise<RequestResults["renameProject"]> =>
		await context.projectStore.rename(params.id, params.name),

	removeProject: async (params, context): Promise<RequestResults["removeProject"]> => {
		await context.projectStore.remove(params.id);
		return {};
	},

	projectTrust: async (params, context): Promise<RequestResults["projectTrust"]> =>
		context.factory.projectTrust(await resolveProjectDirectory(params.cwd)),

	setProjectTrust: async (params, context): Promise<RequestResults["setProjectTrust"]> => {
		context.factory.setProjectTrust(await resolveProjectDirectory(params.cwd), params.trusted);
		return {};
	},

	revealProject: async (params, context): Promise<RequestResults["revealProject"]> => {
		const project = context.projectStore.get(params.id);
		if (project === undefined) {
			throw new ProjectNotFoundError(params.id);
		}
		await revealInFileManager(project.cwd);
		return {};
	},
	// 目录由端点指定（会话所在的工作目录），不查项目登记：没添加成项目的目录也要能打开
	revealPath: async (params): Promise<RequestResults["revealPath"]> => {
		await revealInFileManager(params.path);
		return {};
	},

	getSettings: (_params, context): RequestResults["getSettings"] => ({
		settings: context.settingsStore.get(),
	}),

	updateSettings: async (params, context): Promise<RequestResults["updateSettings"]> => ({
		settings: await context.settingsStore.save(params.settings),
	}),

	getAgentDefaults: (_params, context): RequestResults["getAgentDefaults"] => context.factory.agentDefaults(),

	// 写的是 pi 自己的设置，落盘之后再把实际生效的值读回来，界面不用猜
	setAgentDefaults: async (params, context): Promise<RequestResults["setAgentDefaults"]> => {
		await context.factory.setAgentDefaults({
			...(params.model === undefined ? {} : { model: params.model }),
			...(params.thinkingLevel === undefined ? {} : { thinkingLevel: params.thinkingLevel }),
		});
		return context.factory.agentDefaults();
	},

	saveCredential: async (params, context): Promise<RequestResults["saveCredential"]> => {
		await context.factory.saveCredential(params.providerId, params.apiKey);
		return { providers: context.factory.providers() };
	},

	deleteCredential: async (params, context): Promise<RequestResults["deleteCredential"]> => {
		await context.factory.deleteCredential(params.providerId);
		return { providers: context.factory.providers() };
	},

	// 登录的进展从模型通道推给所有端，这里只把这一次登录开起来
	providerLoginStart: (params, context): RequestResults["providerLoginStart"] => {
		return context.factory.startProviderLogin(params.providerId, params.authType ?? "api_key");
	},

	providerLoginRespond: (params, context): RequestResults["providerLoginRespond"] => {
		return {
			accepted: context.factory.respondProviderLogin(params.loginId, params.promptId, params.value),
		};
	},

	providerLoginCancel: (params, context): RequestResults["providerLoginCancel"] => {
		return { cancelled: context.factory.cancelProviderLogin(params.loginId) };
	},

	diagnostics: async (_params, context): Promise<RequestResults["diagnostics"]> => {
		const [sessions, settings] = await Promise.all([
			context.factory.listSessions(),
			Promise.resolve(context.settingsStore.get()),
		]);
		return {
			text: await buildDiagnostics({
				protocolVersion: PROTOCOL_VERSION,
				hostId: context.hostId,
				hostSource: context.hostSource,
				hostName: context.config.hostName,
				agentDir: context.factory.agentDir,
				dataDir: context.config.dataDir,
				sessionDir: context.factory.sessionDir,
				sessionCount: sessions.length,
				projects: context.projectStore.list().map((project) => ({ cwd: project.cwd, name: project.name })),
				providers: context.factory.providers(),
				settings,
				now: Date.now(),
			}),
		};
	},

	testModel: async (params, context): Promise<RequestResults["testModel"]> =>
		await context.factory.testModel({ provider: params.provider, id: params.id }),

	listCustomProviders: async (_params, context): Promise<RequestResults["listCustomProviders"]> => ({
		providers: customProviderList(await context.factory.customProviders()),
	}),

	// 界面把输入框里的密钥带过来；没带就按这个提供方此刻能用的认证去解析
	fetchProviderModels: async (params, context): Promise<RequestResults["fetchProviderModels"]> => {
		const typed = params.apiKey?.trim();
		const auth =
			typed !== undefined && typed.length > 0
				? { apiKey: typed }
				: params.providerId === undefined
					? undefined
					: await context.factory.providerAuth(params.providerId);
		return await fetchUpstreamModels({
			baseUrl: params.baseUrl,
			api: params.api,
			apiKey: auth?.apiKey,
			headers: auth !== undefined && "headers" in auth ? auth.headers : undefined,
		});
	},

	saveCustomProvider: async (params, context): Promise<RequestResults["saveCustomProvider"]> => {
		await context.factory.saveCustomProvider(normalizeProviderInput(params.provider));
		return { providers: customProviderList(await context.factory.customProviders()) };
	},

	removeCustomProvider: async (params, context): Promise<RequestResults["removeCustomProvider"]> => {
		await context.factory.removeCustomProvider(params.providerId);
		return { providers: customProviderList(await context.factory.customProviders()) };
	},
};
