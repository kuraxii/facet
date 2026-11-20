/**
 * 权限档与参数校验，由 `packages/protocol/scripts/gen-checks.mjs` 生成。
 *
 * 不要手改这个文件：改 `src/schema/contracts.ts` 里的 Schema，再跑
 * `npm run gen:checks -w @facet/protocol`。生成物不引用 typebox，也不做任何运行时编译。
 */
import type { DispatchContract, RequestContract } from "../contract.ts";
import type { ActionFrame } from "../wire.ts";

/**
 * respondUi 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestRespondUi(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("sessionId" in value && "requestId" in value) && "response" in value) && ((typeof value.sessionId === "string" && typeof value.requestId === "string") && (((((((typeof value.response === "object" && value.response !== null && !(Array.isArray(value.response))) && ("kind" in value.response && (typeof value.response.kind === "string" && value.response.kind === "cancel"))) || ((typeof value.response === "object" && value.response !== null && !(Array.isArray(value.response))) && (("kind" in value.response && "value" in value.response) && ((typeof value.response.kind === "string" && value.response.kind === "select") && typeof value.response.value === "string")))) || ((typeof value.response === "object" && value.response !== null && !(Array.isArray(value.response))) && (("kind" in value.response && "confirmed" in value.response) && ((typeof value.response.kind === "string" && value.response.kind === "confirm") && typeof value.response.confirmed === "boolean")))) || ((typeof value.response === "object" && value.response !== null && !(Array.isArray(value.response))) && (("kind" in value.response && "value" in value.response) && ((typeof value.response.kind === "string" && value.response.kind === "input") && typeof value.response.value === "string")))) || ((typeof value.response === "object" && value.response !== null && !(Array.isArray(value.response))) && (("kind" in value.response && "value" in value.response) && ((typeof value.response.kind === "string" && value.response.kind === "editor") && typeof value.response.value === "string")))) || ((typeof value.response === "object" && value.response !== null && !(Array.isArray(value.response))) && (("kind" in value.response && "answers" in value.response) && ((typeof value.response.kind === "string" && value.response.kind === "form") && (Array.isArray(value.response.answers) && value.response.answers.every((element, index) => (((typeof element === "object" && element !== null && !(Array.isArray(element))) && (("id" in element && "selections" in element) && (((typeof element.id === "string" && (Array.isArray(element.selections) && element.selections.every((element, index) => (typeof element === "string")))) && (element.custom === undefined || (!("custom" in element) || typeof element.custom === "string"))) && (element.comment === undefined || (!("comment" in element) || typeof element.comment === "string"))))))))))))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionId === "string" && source.sessionId.length > 0 &&
			typeof source.requestId === "string" && source.requestId.length > 0
		);
	};
}

const checkRequestRespondUi = buildRequestRespondUi();

/**
 * listSessions 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestListSessions(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (value.cwd === undefined || (!("cwd" in value) || typeof value.cwd === "string"))));
	return check_0;
}

const checkRequestListSessions = buildRequestListSessions();

/**
 * listCommands 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestListCommands(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionId" in value && typeof value.sessionId === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionId === "string" && source.sessionId.length > 0
		);
	};
}

const checkRequestListCommands = buildRequestListCommands();

/**
 * busySessions 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestBusySessions(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestBusySessions = buildRequestBusySessions();

/**
 * createSession 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestCreateSession(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((((((value.cwd === undefined || (!("cwd" in value) || typeof value.cwd === "string")) && (value.model === undefined || (!("model" in value) || ((typeof value.model === "object" && value.model !== null && !(Array.isArray(value.model))) && (("provider" in value.model && "id" in value.model) && (typeof value.model.provider === "string" && typeof value.model.id === "string")))))) && (value.thinkingLevel === undefined || (!("thinkingLevel" in value) || (((((((typeof value.thinkingLevel === "string" && value.thinkingLevel === "off") || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "minimal")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "low")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "medium")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "high")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "xhigh")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "max"))))) && (value.tools === undefined || (!("tools" in value) || (Array.isArray(value.tools) && value.tools.every((element, index) => (typeof element === "string")))))) && (value.excludeTools === undefined || (!("excludeTools" in value) || (Array.isArray(value.excludeTools) && value.excludeTools.every((element, index) => (typeof element === "string")))))) && (value.name === undefined || (!("name" in value) || typeof value.name === "string")))));
	return check_0;
}

const checkRequestCreateSession = buildRequestCreateSession();

/**
 * openSession 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestOpenSession(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionFile" in value && (typeof value.sessionFile === "string" && (value.cwd === undefined || (!("cwd" in value) || typeof value.cwd === "string"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionFile === "string" && source.sessionFile.length > 0
		);
	};
}

const checkRequestOpenSession = buildRequestOpenSession();

/**
 * forkSession 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestForkSession(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionFile" in value && ((typeof value.sessionFile === "string" && (value.beforeEntryId === undefined || (!("beforeEntryId" in value) || typeof value.beforeEntryId === "string"))) && (value.cwd === undefined || (!("cwd" in value) || typeof value.cwd === "string"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionFile === "string" && source.sessionFile.length > 0
		);
	};
}

const checkRequestForkSession = buildRequestForkSession();

/**
 * snapshot 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestSnapshot(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionId" in value && typeof value.sessionId === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionId === "string" && source.sessionId.length > 0
		);
	};
}

const checkRequestSnapshot = buildRequestSnapshot();

/**
 * entries 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestEntries(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionId" in value && ((typeof value.sessionId === "string" && (value.cursor === undefined || (!("cursor" in value) || typeof value.cursor === "string"))) && (value.limit === undefined || (!("limit" in value) || Number.isFinite(value.limit)))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionId === "string" && source.sessionId.length > 0
		);
	};
}

const checkRequestEntries = buildRequestEntries();

/**
 * entriesAfter 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestEntriesAfter(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionId" in value && (typeof value.sessionId === "string" && (value.afterEntryId === undefined || (!("afterEntryId" in value) || typeof value.afterEntryId === "string"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionId === "string" && source.sessionId.length > 0
		);
	};
}

const checkRequestEntriesAfter = buildRequestEntriesAfter();

/**
 * subscribe 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestSubscribe(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("channel" in value && (typeof value.channel === "string" && (value.since === undefined || (!("since" in value) || Number.isFinite(value.since)))))));
	return check_0;
}

const checkRequestSubscribe = buildRequestSubscribe();

/**
 * unsubscribe 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestUnsubscribe(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("channel" in value && typeof value.channel === "string")));
	return check_0;
}

const checkRequestUnsubscribe = buildRequestUnsubscribe();

/**
 * models 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestModels(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (value.providerId === undefined || (!("providerId" in value) || typeof value.providerId === "string"))));
	return check_0;
}

const checkRequestModels = buildRequestModels();

/**
 * availableModels 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestAvailableModels(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestAvailableModels = buildRequestAvailableModels();

/**
 * providers 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestProviders(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestProviders = buildRequestProviders();

/**
 * listDirectory 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestListDirectory(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("cwd" in value && "path" in value) && (typeof value.cwd === "string" && typeof value.path === "string"))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0
		);
	};
}

const checkRequestListDirectory = buildRequestListDirectory();

/**
 * readFile 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestReadFile(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("cwd" in value && "path" in value) && (typeof value.cwd === "string" && typeof value.path === "string"))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0 &&
			typeof source.path === "string" && source.path.length > 0
		);
	};
}

const checkRequestReadFile = buildRequestReadFile();

/**
 * writeFile 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestWriteFile(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (((("cwd" in value && "path" in value) && "content" in value) && "expectedRevision" in value) && (((typeof value.cwd === "string" && typeof value.path === "string") && typeof value.content === "string") && typeof value.expectedRevision === "string"))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0 &&
			typeof source.path === "string" && source.path.length > 0 &&
			typeof source.expectedRevision === "string" && source.expectedRevision.length > 0
		);
	};
}

const checkRequestWriteFile = buildRequestWriteFile();

/**
 * gitStatus 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestGitStatus(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("cwd" in value && (typeof value.cwd === "string" && (value.force === undefined || (!("force" in value) || typeof value.force === "boolean"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0
		);
	};
}

const checkRequestGitStatus = buildRequestGitStatus();

/**
 * gitDiff 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestGitDiff(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("cwd" in value && "path" in value) && ((typeof value.cwd === "string" && typeof value.path === "string") && (value.untracked === undefined || (!("untracked" in value) || typeof value.untracked === "boolean"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0 &&
			typeof source.path === "string" && source.path.length > 0
		);
	};
}

const checkRequestGitDiff = buildRequestGitDiff();

/**
 * gitCommits 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestGitCommits(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("cwd" in value && (typeof value.cwd === "string" && (value.force === undefined || (!("force" in value) || typeof value.force === "boolean"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0
		);
	};
}

const checkRequestGitCommits = buildRequestGitCommits();

/**
 * gitCommit 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestGitCommit(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("cwd" in value && "sha" in value) && (typeof value.cwd === "string" && typeof value.sha === "string"))));
	return check_0;
}

const checkRequestGitCommit = buildRequestGitCommit();

/**
 * gitCommitDiff 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestGitCommitDiff(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("cwd" in value && "sha" in value) && "path" in value) && (((typeof value.cwd === "string" && typeof value.sha === "string") && typeof value.path === "string") && (value.oldPath === undefined || (!("oldPath" in value) || typeof value.oldPath === "string"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0 &&
			typeof source.sha === "string" && source.sha.length > 0 &&
			typeof source.path === "string" && source.path.length > 0
		);
	};
}

const checkRequestGitCommitDiff = buildRequestGitCommitDiff();

/**
 * listProjects 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestListProjects(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestListProjects = buildRequestListProjects();

/**
 * addProject 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestAddProject(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("cwd" in value && (typeof value.cwd === "string" && (value.name === undefined || (!("name" in value) || typeof value.name === "string"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0
		);
	};
}

const checkRequestAddProject = buildRequestAddProject();

/**
 * renameProject 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestRenameProject(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("id" in value && (typeof value.id === "string" && (value.name === undefined || (!("name" in value) || typeof value.name === "string"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.id === "string" && source.id.length > 0
		);
	};
}

const checkRequestRenameProject = buildRequestRenameProject();

/**
 * removeProject 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestRemoveProject(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("id" in value && typeof value.id === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.id === "string" && source.id.length > 0
		);
	};
}

const checkRequestRemoveProject = buildRequestRemoveProject();

/**
 * projectTrust 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestProjectTrust(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("cwd" in value && typeof value.cwd === "string")));
	return check_0;
}

const checkRequestProjectTrust = buildRequestProjectTrust();

/**
 * setProjectTrust 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestSetProjectTrust(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("cwd" in value && "trusted" in value) && (typeof value.cwd === "string" && typeof value.trusted === "boolean"))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.cwd === "string" && source.cwd.length > 0
		);
	};
}

const checkRequestSetProjectTrust = buildRequestSetProjectTrust();

/**
 * revealProject 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestRevealProject(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("id" in value && typeof value.id === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.id === "string" && source.id.length > 0
		);
	};
}

const checkRequestRevealProject = buildRequestRevealProject();

/**
 * revealPath 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestRevealPath(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("path" in value && typeof value.path === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.path === "string" && source.path.length > 0
		);
	};
}

const checkRequestRevealPath = buildRequestRevealPath();

/**
 * renameSession 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestRenameSession(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionFile" in value && (typeof value.sessionFile === "string" && (value.name === undefined || (!("name" in value) || typeof value.name === "string"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionFile === "string" && source.sessionFile.length > 0
		);
	};
}

const checkRequestRenameSession = buildRequestRenameSession();

/**
 * deleteSession 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestDeleteSession(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionFile" in value && typeof value.sessionFile === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.sessionFile === "string" && source.sessionFile.length > 0
		);
	};
}

const checkRequestDeleteSession = buildRequestDeleteSession();

/**
 * markSessionsSeen 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestMarkSessionsSeen(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("sessionFiles" in value && (Array.isArray(value.sessionFiles) && value.sessionFiles.every((element, index) => (typeof element === "string"))))));
	return check_0;
}

const checkRequestMarkSessionsSeen = buildRequestMarkSessionsSeen();

/**
 * getSettings 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestGetSettings(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestGetSettings = buildRequestGetSettings();

/**
 * updateSettings 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestUpdateSettings(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("settings" in value && ((typeof value.settings === "object" && value.settings !== null && !(Array.isArray(value.settings))) && true))));
	return check_0;
}

const checkRequestUpdateSettings = buildRequestUpdateSettings();

/**
 * getAgentDefaults 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestGetAgentDefaults(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestGetAgentDefaults = buildRequestGetAgentDefaults();

/**
 * setAgentDefaults 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestSetAgentDefaults(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((value.model === undefined || (!("model" in value) || ((typeof value.model === "object" && value.model !== null && !(Array.isArray(value.model))) && (("provider" in value.model && "id" in value.model) && (typeof value.model.provider === "string" && typeof value.model.id === "string"))))) && (value.thinkingLevel === undefined || (!("thinkingLevel" in value) || ((((((((typeof value.thinkingLevel === "string" && value.thinkingLevel === "off") || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "minimal")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "low")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "medium")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "high")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "xhigh")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "max")) || value.thinkingLevel === null))))));
	return check_0;
}

const checkRequestSetAgentDefaults = buildRequestSetAgentDefaults();

/**
 * saveCredential 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestSaveCredential(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("providerId" in value && "apiKey" in value) && (typeof value.providerId === "string" && typeof value.apiKey === "string"))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.providerId === "string" && source.providerId.length > 0 &&
			typeof source.apiKey === "string" && source.apiKey.length > 0
		);
	};
}

const checkRequestSaveCredential = buildRequestSaveCredential();

/**
 * deleteCredential 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestDeleteCredential(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("providerId" in value && typeof value.providerId === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.providerId === "string" && source.providerId.length > 0
		);
	};
}

const checkRequestDeleteCredential = buildRequestDeleteCredential();

/**
 * providerLoginStart 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestProviderLoginStart(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("providerId" in value && (typeof value.providerId === "string" && (value.authType === undefined || (!("authType" in value) || ((typeof value.authType === "string" && value.authType === "oauth") || (typeof value.authType === "string" && value.authType === "api_key"))))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.providerId === "string" && source.providerId.length > 0
		);
	};
}

const checkRequestProviderLoginStart = buildRequestProviderLoginStart();

/**
 * providerLoginRespond 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestProviderLoginRespond(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("loginId" in value && "promptId" in value) && "value" in value) && ((typeof value.loginId === "string" && typeof value.promptId === "string") && (typeof value.value === "string" || value.value === null)))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.loginId === "string" && source.loginId.length > 0
		);
	};
}

const checkRequestProviderLoginRespond = buildRequestProviderLoginRespond();

/**
 * providerLoginCancel 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestProviderLoginCancel(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("loginId" in value && typeof value.loginId === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.loginId === "string" && source.loginId.length > 0
		);
	};
}

const checkRequestProviderLoginCancel = buildRequestProviderLoginCancel();

/**
 * diagnostics 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestDiagnostics(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestDiagnostics = buildRequestDiagnostics();

/**
 * testModel 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestTestModel(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("provider" in value && "id" in value) && (typeof value.provider === "string" && typeof value.id === "string"))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.provider === "string" && source.provider.length > 0 &&
			typeof source.id === "string" && source.id.length > 0
		);
	};
}

const checkRequestTestModel = buildRequestTestModel();

/**
 * listCustomProviders 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestListCustomProviders(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestListCustomProviders = buildRequestListCustomProviders();

/**
 * fetchProviderModels 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestFetchProviderModels(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("baseUrl" in value && (((typeof value.baseUrl === "string" && (value.providerId === undefined || (!("providerId" in value) || typeof value.providerId === "string"))) && (value.apiKey === undefined || (!("apiKey" in value) || typeof value.apiKey === "string"))) && (value.api === undefined || (!("api" in value) || typeof value.api === "string"))))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.baseUrl === "string" && source.baseUrl.length > 0
		);
	};
}

const checkRequestFetchProviderModels = buildRequestFetchProviderModels();

/**
 * saveCustomProvider 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestSaveCustomProvider(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("provider" in value && ((typeof value.provider === "object" && value.provider !== null && !(Array.isArray(value.provider))) && ((((("id" in value.provider && "name" in value.provider) && "baseUrl" in value.provider) && "api" in value.provider) && "models" in value.provider) && ((((typeof value.provider.id === "string" && typeof value.provider.name === "string") && typeof value.provider.baseUrl === "string") && typeof value.provider.api === "string") && (Array.isArray(value.provider.models) && value.provider.models.every((element, index) => (((typeof element === "object" && element !== null && !(Array.isArray(element))) && ("id" in element && ((((typeof element.id === "string" && (element.name === undefined || (!("name" in element) || typeof element.name === "string"))) && (element.reasoning === undefined || (!("reasoning" in element) || typeof element.reasoning === "boolean"))) && (element.contextWindow === undefined || (!("contextWindow" in element) || Number.isFinite(element.contextWindow)))) && (element.maxTokens === undefined || (!("maxTokens" in element) || Number.isFinite(element.maxTokens)))))))))))))));
	return check_0;
}

const checkRequestSaveCustomProvider = buildRequestSaveCustomProvider();

/**
 * removeCustomProvider 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestRemoveCustomProvider(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("providerId" in value && typeof value.providerId === "string")));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.providerId === "string" && source.providerId.length > 0
		);
	};
}

const checkRequestRemoveCustomProvider = buildRequestRemoveCustomProvider();

/**
 * listTerminals 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestListTerminals(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && true));
	return check_0;
}

const checkRequestListTerminals = buildRequestListTerminals();

/**
 * createTerminal 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestCreateTerminal(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("cwd" in value && "cols" in value) && "rows" in value) && (((typeof value.cwd === "string" && Number.isFinite(value.cols)) && Number.isFinite(value.rows)) && (value.shell === undefined || (!("shell" in value) || typeof value.shell === "string"))))));
	return check_0;
}

const checkRequestCreateTerminal = buildRequestCreateTerminal();

/**
 * writeTerminal 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestWriteTerminal(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("id" in value && "data" in value) && (typeof value.id === "string" && typeof value.data === "string"))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.id === "string" && source.id.length > 0
		);
	};
}

const checkRequestWriteTerminal = buildRequestWriteTerminal();

/**
 * resizeTerminal 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestResizeTerminal(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("id" in value && "cols" in value) && "rows" in value) && ((typeof value.id === "string" && Number.isFinite(value.cols)) && Number.isFinite(value.rows)))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.id === "string" && source.id.length > 0
		);
	};
}

const checkRequestResizeTerminal = buildRequestResizeTerminal();

/**
 * killTerminal 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestKillTerminal(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("id" in value && typeof value.id === "string")));
	return check_0;
}

const checkRequestKillTerminal = buildRequestKillTerminal();

/**
 * ackTerminal 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestAckTerminal(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("id" in value && "seq" in value) && (typeof value.id === "string" && Number.isFinite(value.seq)))));
	return (value: unknown): boolean => {
		if (!check_0(value)) return false;
		const source = value as Record<string, unknown>;
		return (
			typeof source.id === "string" && source.id.length > 0
		);
	};
}

const checkRequestAckTerminal = buildRequestAckTerminal();

/**
 * serializeTerminal 的参数判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildRequestSerializeTerminal(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("id" in value && typeof value.id === "string")));
	return check_0;
}

const checkRequestSerializeTerminal = buildRequestSerializeTerminal();

/**
 * chat/turnStarted 的动作判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildDispatchChatTurnStarted(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("type" in value && "text" in value) && ((((typeof value.type === "string" && value.type === "chat/turnStarted") && typeof value.text === "string") && (value.images === undefined || (!("images" in value) || (Array.isArray(value.images) && value.images.every((element, index) => (((typeof element === "object" && element !== null && !(Array.isArray(element))) && ((("type" in element && "data" in element) && "mimeType" in element) && (((typeof element.type === "string" && element.type === "image") && typeof element.data === "string") && typeof element.mimeType === "string"))))))))) && (value.streamingBehavior === undefined || (!("streamingBehavior" in value) || ((typeof value.streamingBehavior === "string" && value.streamingBehavior === "steer") || (typeof value.streamingBehavior === "string" && value.streamingBehavior === "followUp"))))))));
	return check_0;
}

const checkDispatchChatTurnStarted = buildDispatchChatTurnStarted();

/**
 * chat/turnCancelled 的动作判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildDispatchChatTurnCancelled(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("type" in value && (typeof value.type === "string" && value.type === "chat/turnCancelled"))));
	return check_0;
}

const checkDispatchChatTurnCancelled = buildDispatchChatTurnCancelled();

/**
 * chat/revertTo 的动作判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildDispatchChatRevertTo(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("type" in value && "entryId" in value) && ((typeof value.type === "string" && value.type === "chat/revertTo") && typeof value.entryId === "string"))));
	return check_0;
}

const checkDispatchChatRevertTo = buildDispatchChatRevertTo();

/**
 * session/titleChanged 的动作判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildDispatchSessionTitleChanged(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (("type" in value && "title" in value) && ((typeof value.type === "string" && value.type === "session/titleChanged") && typeof value.title === "string"))));
	return check_0;
}

const checkDispatchSessionTitleChanged = buildDispatchSessionTitleChanged();

/**
 * session/pendingMessageSet 的动作判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildDispatchSessionPendingMessageSet(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ((("type" in value && "kind" in value) && "text" in value) && (((typeof value.type === "string" && value.type === "session/pendingMessageSet") && ((typeof value.kind === "string" && value.kind === "steering") || (typeof value.kind === "string" && value.kind === "queued"))) && typeof value.text === "string"))));
	return check_0;
}

const checkDispatchSessionPendingMessageSet = buildDispatchSessionPendingMessageSet();

/**
 * session/queueCleared 的动作判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildDispatchSessionQueueCleared(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("type" in value && (typeof value.type === "string" && value.type === "session/queueCleared"))));
	return check_0;
}

const checkDispatchSessionQueueCleared = buildDispatchSessionQueueCleared();

/**
 * session/compact 的动作判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildDispatchSessionCompact(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("type" in value && (typeof value.type === "string" && value.type === "session/compact"))));
	return check_0;
}

const checkDispatchSessionCompact = buildDispatchSessionCompact();

/**
 * session/configChanged 的动作判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildDispatchSessionConfigChanged(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && ("type" in value && (((((typeof value.type === "string" && value.type === "session/configChanged") && (value.model === undefined || (!("model" in value) || ((typeof value.model === "object" && value.model !== null && !(Array.isArray(value.model))) && (("provider" in value.model && "id" in value.model) && (typeof value.model.provider === "string" && typeof value.model.id === "string")))))) && (value.thinkingLevel === undefined || (!("thinkingLevel" in value) || (((((((typeof value.thinkingLevel === "string" && value.thinkingLevel === "off") || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "minimal")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "low")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "medium")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "high")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "xhigh")) || (typeof value.thinkingLevel === "string" && value.thinkingLevel === "max"))))) && (value.activeToolNames === undefined || (!("activeToolNames" in value) || (Array.isArray(value.activeToolNames) && value.activeToolNames.every((element, index) => (typeof element === "string")))))) && (value.persist === undefined || (!("persist" in value) || typeof value.persist === "boolean"))))));
	return check_0;
}

const checkDispatchSessionConfigChanged = buildDispatchSessionConfigChanged();

/**
 * actionFrame 的信封判断。
 *
 * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。
 */
function buildFrameActionFrame(): (value: unknown) => boolean {
	// @ts-ignore
	const check_0 = ((value) => ((typeof value === "object" && value !== null && !(Array.isArray(value))) && (((("type" in value && "channel" in value) && "action" in value) && "serverSeq" in value) && ((((((typeof value.type === "string" && value.type === "action") && typeof value.channel === "string") && ((typeof value.action === "object" && value.action !== null && !(Array.isArray(value.action))) && ("type" in value.action && typeof value.action.type === "string"))) && Number.isFinite(value.serverSeq)) && (value.origin === undefined || (!("origin" in value) || (((typeof value.origin === "object" && value.origin !== null && !(Array.isArray(value.origin))) && (("clientId" in value.origin && "clientSeq" in value.origin) && (typeof value.origin.clientId === "string" && Number.isFinite(value.origin.clientSeq)))) || value.origin === null)))) && (value.rejectionReason === undefined || (!("rejectionReason" in value) || typeof value.rejectionReason === "string"))))));
	return check_0;
}

const checkFrameActionFrame = buildFrameActionFrame();

/** 方法名到契约的表。查不到就是未知方法。 */
export const REQUEST_CONTRACTS: Readonly<Record<string, RequestContract | undefined>> = {
	"respondUi": { auth: "write", check: checkRequestRespondUi },
	"listSessions": { auth: "public", check: checkRequestListSessions },
	"listCommands": { auth: "public", check: checkRequestListCommands },
	"busySessions": { auth: "public", check: checkRequestBusySessions },
	"createSession": { auth: "write", check: checkRequestCreateSession },
	"openSession": { auth: "public", check: checkRequestOpenSession },
	"forkSession": { auth: "write", check: checkRequestForkSession },
	"snapshot": { auth: "public", check: checkRequestSnapshot },
	"entries": { auth: "public", check: checkRequestEntries },
	"entriesAfter": { auth: "public", check: checkRequestEntriesAfter },
	"subscribe": { auth: "public", check: checkRequestSubscribe },
	"unsubscribe": { auth: "public", check: checkRequestUnsubscribe },
	"models": { auth: "public", check: checkRequestModels },
	"availableModels": { auth: "public", check: checkRequestAvailableModels },
	"providers": { auth: "public", check: checkRequestProviders },
	"listDirectory": { auth: "public", check: checkRequestListDirectory },
	"readFile": { auth: "public", check: checkRequestReadFile },
	"writeFile": { auth: "write", check: checkRequestWriteFile },
	"gitStatus": { auth: "public", check: checkRequestGitStatus },
	"gitDiff": { auth: "public", check: checkRequestGitDiff },
	"gitCommits": { auth: "public", check: checkRequestGitCommits },
	"gitCommit": { auth: "public", check: checkRequestGitCommit },
	"gitCommitDiff": { auth: "public", check: checkRequestGitCommitDiff },
	"listProjects": { auth: "public", check: checkRequestListProjects },
	"addProject": { auth: "admin", check: checkRequestAddProject },
	"renameProject": { auth: "admin", check: checkRequestRenameProject },
	"removeProject": { auth: "admin", check: checkRequestRemoveProject },
	"projectTrust": { auth: "public", check: checkRequestProjectTrust },
	"setProjectTrust": { auth: "admin", check: checkRequestSetProjectTrust },
	"revealProject": { auth: "admin", check: checkRequestRevealProject },
	"revealPath": { auth: "admin", check: checkRequestRevealPath },
	"renameSession": { auth: "write", check: checkRequestRenameSession },
	"deleteSession": { auth: "write", check: checkRequestDeleteSession },
	"markSessionsSeen": { auth: "public", check: checkRequestMarkSessionsSeen },
	"getSettings": { auth: "public", check: checkRequestGetSettings },
	"updateSettings": { auth: "admin", check: checkRequestUpdateSettings },
	"getAgentDefaults": { auth: "public", check: checkRequestGetAgentDefaults },
	"setAgentDefaults": { auth: "admin", check: checkRequestSetAgentDefaults },
	"saveCredential": { auth: "admin", check: checkRequestSaveCredential },
	"deleteCredential": { auth: "admin", check: checkRequestDeleteCredential },
	"providerLoginStart": { auth: "admin", check: checkRequestProviderLoginStart },
	"providerLoginRespond": { auth: "admin", check: checkRequestProviderLoginRespond },
	"providerLoginCancel": { auth: "admin", check: checkRequestProviderLoginCancel },
	"diagnostics": { auth: "admin", check: checkRequestDiagnostics },
	"testModel": { auth: "admin", check: checkRequestTestModel },
	"listCustomProviders": { auth: "public", check: checkRequestListCustomProviders },
	"fetchProviderModels": { auth: "admin", check: checkRequestFetchProviderModels },
	"saveCustomProvider": { auth: "admin", check: checkRequestSaveCustomProvider },
	"removeCustomProvider": { auth: "admin", check: checkRequestRemoveCustomProvider },
	"listTerminals": { auth: "public", check: checkRequestListTerminals },
	"createTerminal": { auth: "write", check: checkRequestCreateTerminal },
	"writeTerminal": { auth: "write", check: checkRequestWriteTerminal },
	"resizeTerminal": { auth: "write", check: checkRequestResizeTerminal },
	"killTerminal": { auth: "write", check: checkRequestKillTerminal },
	"ackTerminal": { auth: "public", check: checkRequestAckTerminal },
	"serializeTerminal": { auth: "public", check: checkRequestSerializeTerminal },
};

/** 主机推送的帧信封；生成物带类型谓词，调用方拿到的就是对应类型。 */
export const SERVER_FRAME_CONTRACTS = {
	actionFrame: checkFrameActionFrame as (value: unknown) => value is ActionFrame,
} as const;

/** 客户端可派发动作到契约的表。查不到就是主机内部事件，端点不得接受。 */
export const DISPATCH_CONTRACTS: Readonly<Record<string, DispatchContract | undefined>> = {
	"chat/turnStarted": { auth: "write", check: checkDispatchChatTurnStarted },
	"chat/turnCancelled": { auth: "write", check: checkDispatchChatTurnCancelled },
	"chat/revertTo": { auth: "write", check: checkDispatchChatRevertTo },
	"session/titleChanged": { auth: "write", check: checkDispatchSessionTitleChanged },
	"session/pendingMessageSet": { auth: "write", check: checkDispatchSessionPendingMessageSet },
	"session/queueCleared": { auth: "write", check: checkDispatchSessionQueueCleared },
	"session/compact": { auth: "write", check: checkDispatchSessionCompact },
	"session/configChanged": { auth: "write", check: checkDispatchSessionConfigChanged },
};
