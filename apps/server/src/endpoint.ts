/**
 * 端点接入。
 *
 * 一条 WebSocket 连接对应一个端。连接建立后主机先发 hello(带本次连接的端标识),
 * 之后端点发请求、主机回响应;状态变更走 action 帧,按通道定序推给订阅者。
 * 断线时该端的订阅全部解除,会话本身继续在主机上运行。
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, realpath, rm, stat } from "node:fs/promises";
import { createServer as createSocketServer, type Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { InvalidProviderError, type PiAgentFactory } from "@facet/agent";
import {
	type Action,
	type ActionFrame,
	type Capability,
	type Channel,
	type CustomProviderInfo,
	type ErrorCode,
	encodeFrame,
	type FacetSettings,
	FrameDecoder,
	type HelloFrame,
	PROTOCOL_VERSION,
	parseChannel,
	type RequestParams,
	type ResponseFrame,
	type ServerFrame,
	type SessionSnapshot,
} from "@facet/protocol";
import type { ServerConfig } from "./config.ts";
import { buildDiagnostics } from "./diagnostics.ts";
import { FileAccessError, listDirectory, readTextFile, writeTextFile } from "./files.ts";
import { gitDiff, gitStatus } from "./git.ts";
import type { HostSource } from "./host-identity.ts";
import { ProjectExistsError, ProjectNotFoundError, type ProjectStore } from "./project-store.ts";
import { RevealFailedError, revealInFileManager } from "./reveal.ts";
import {
	type ActionSink,
	ChannelNotFoundError,
	SessionBoundaryNotFoundError,
	SessionBusyError,
	SessionEntryNotFoundError,
	SessionFileMissingError,
	type SessionHub,
	SessionNotFoundError,
} from "./session-hub.ts";
import type { SessionsChannel } from "./sessions-channel.ts";
import type { SettingsStore } from "./settings-store.ts";

/** 当前主机已实现的能力。未列入的入口由端点隐藏。 */
const CAPABILITIES: Capability[] = ["dispatch", "tools", "compaction", "export"];

/** 请求被拒绝时带出的错误。未捕获的其他错误统一归类为内部错误。 */
class RequestError extends Error {
	readonly code: ErrorCode;

	constructor(code: ErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

/**
 * 一条连接。
 *
 * 承载方式（WebSocket 或字节流）只影响怎么收发字节，连接本身只认「发一帧」与「关掉」。
 */
interface Connection {
	/** 本次连接的端标识,写进回放动作的 origin */
	readonly clientId: string;
	/** 对端地址，只有回环地址能结束主机 */
	readonly remoteAddress: string | undefined;
	/** 已订阅的通道与其转发函数,用于取消订阅与断线清理 */
	readonly subscriptions: Map<Channel, ActionSink>;
	/** 令牌是否已校验通过，通过之后才发 hello 并接受请求 */
	authenticated: boolean;
	/** 发一帧给对端 */
	send(frame: ServerFrame): void;
	/** 关掉连接，参数是给对端看的说明 */
	close(code: number, reason: string): void;
}

interface EndpointContext {
	readonly config: ServerConfig;
	readonly factory: PiAgentFactory;
	readonly hub: SessionHub;
	readonly projectStore: ProjectStore;
	readonly settingsStore: SettingsStore;
	readonly hostId: string;
	/** 主机标识的派生来源，诊断里说明这台机器有没有 machine-id */
	readonly hostSource: HostSource;
	readonly connections: Set<Connection>;
	/** 收到结束主机的请求后调用，由进程入口决定怎么收尾 */
	readonly requestShutdown: () => void;
	/** 会话清单通道，所有端订阅同一条 */
	readonly sessions: SessionsChannel;
}

/** 这个对端地址是否是回环地址。IPv4、IPv6 与 IPv4 映射地址都算。 */
export function isLoopbackAddress(address: string | undefined): boolean {
	if (address === undefined) {
		return false;
	}
	const normalized = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
	return normalized === "::1" || normalized === "localhost" || normalized.startsWith("127.");
}

export interface EndpointHandle {
	/** 实际监听的端口,配置为 0 时由系统分配；unix socket 模式下为 0 */
	readonly port: number;
	readonly host: string;
	/** unix socket 路径，TCP 模式下没有 */
	readonly socketPath?: string;
	/** 关闭监听并断开所有连接。会话由调用方负责释放。 */
	close(): Promise<void>;
}

function asObject(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RequestError("bad_params", "params must be an object");
	}
	return value as Record<string, unknown>;
}

function requiredString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new RequestError("bad_params", `missing string param: ${key}`);
	}
	return value;
}

function optionalString(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new RequestError("bad_params", `${key} must be a string`);
	}
	return value;
}

function optionalNumber(source: Record<string, unknown>, key: string): number | undefined {
	const value = source[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new RequestError("bad_params", `${key} must be a number`);
	}
	return value;
}

function optionalStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
	const value = source[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new RequestError("bad_params", `${key} must be a string array`);
	}
	return value as string[];
}

function requiredChannel(source: Record<string, unknown>, key: string): Channel {
	const raw = requiredString(source, key);
	const parsed = parseChannel(raw);
	if (!parsed || (parsed.kind !== "session" && parsed.kind !== "chat")) {
		throw new RequestError("unknown_channel", `unsupported channel: ${raw}`);
	}
	return raw as Channel;
}

/** 订阅与退订接受会话清单通道，写操作只针对会话与对话通道。 */
function subscribableChannel(source: Record<string, unknown>, key: string): Channel {
	const raw = requiredString(source, key);
	if (parseChannel(raw)?.kind === "sessions") {
		return raw as Channel;
	}
	return requiredChannel(source, key);
}

/** 退掉一个通道的订阅，会话、对话与清单通道各走各的表。 */
function unsubscribeChannel(context: EndpointContext, channel: Channel, sink: ActionSink): void {
	if (parseChannel(channel)?.kind === "sessions") {
		context.sessions.unsubscribe(sink);
		return;
	}
	context.hub.unsubscribe(channel, sink);
}

function toSink(connection: Connection): ActionSink {
	return { id: connection.clientId, send: (frame) => connection.send(frame) };
}

/** 建立会话并把审批应答接到该会话的中转上。 */
async function createSession(context: EndpointContext, params: unknown): Promise<SessionSnapshot> {
	const source = asObject(params ?? {});
	const model = source.model;
	if (model !== undefined && typeof model !== "object") {
		throw new RequestError("bad_params", "model must be an object");
	}
	const modelRecord = model === undefined ? undefined : asObject(model);
	return await context.hub.createSession({
		cwd: optionalString(source, "cwd"),
		model: modelRecord
			? { provider: requiredString(modelRecord, "provider"), id: requiredString(modelRecord, "id") }
			: undefined,
		thinkingLevel: optionalString(source, "thinkingLevel") as RequestParams["createSession"]["thinkingLevel"],
		tools: optionalStringArray(source, "tools"),
		excludeTools: optionalStringArray(source, "excludeTools"),
		name: optionalString(source, "name"),
	});
}

/** 打开已有会话,模型与工具集从会话记录恢复。 */
async function openSession(context: EndpointContext, params: unknown): Promise<SessionSnapshot> {
	const source = asObject(params);
	return await context.hub.openSession(requiredString(source, "sessionFile"), optionalString(source, "cwd"));
}

/** 应用一条端点派发的动作。返回即表示已受理,主机产生的动作随后从通道推出。 */
async function applyAction(context: EndpointContext, channel: Channel, action: Action): Promise<void> {
	const parsed = parseChannel(channel);
	if (!parsed) {
		throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
	}
	// 回退要挪分支指针,还得往外广播,自己持有会话,不走下面那段串行执行
	if (action.type === "chat/revertTo") {
		await context.hub.revertTo(parsed.id, action.entryId);
		return;
	}
	// 同一会话的动作串行执行,执行期间持有会话,不会被空闲回收
	await context.hub.withSession(parsed.id, async (agent) => {
		switch (action.type) {
			case "chat/turnStarted":
				if (agent.isStreaming && action.streamingBehavior === undefined) {
					throw new RequestError("rejected", "session is running, streamingBehavior is required");
				}
				// prompt 在运行开始后返回,这里不会挂到整轮结束
				await agent.prompt(action.text, {
					images: action.images,
					streamingBehavior: action.streamingBehavior,
				});
				return;
			case "chat/turnCancelled":
				await agent.abort();
				return;
			case "session/pendingMessageSet":
				if (action.kind === "steering") {
					await agent.steer(action.text);
				} else {
					await agent.followUp(action.text);
				}
				return;
			case "session/queueCleared":
				agent.clearQueue();
				return;
			case "session/titleChanged":
				agent.setName(action.title);
				return;
			case "session/configChanged":
				if (action.model) {
					await agent.setModel(action.model, { persist: action.persist });
				}
				if (action.thinkingLevel) {
					agent.setThinkingLevel(action.thinkingLevel, { persist: action.persist });
				}
				if (action.activeToolNames) {
					agent.setActiveTools(action.activeToolNames);
				}
				return;
			default:
				throw new RequestError("unknown_method", `action is produced by the host: ${action.type}`);
		}
	});
}

async function handleRequest(
	context: EndpointContext,
	connection: Connection,
	method: string,
	params: unknown,
): Promise<unknown> {
	switch (method) {
		case "listSessions": {
			const source = asObject(params ?? {});
			return { sessions: await context.factory.listSessions(optionalString(source, "cwd")) };
		}
		case "createSession":
			return await createSession(context, params);
		case "openSession":
			return await openSession(context, params);
		case "forkSession": {
			const source = asObject(params);
			const beforeEntryId = optionalString(source, "beforeEntryId");
			return await context.hub.forkSession({
				sessionFile: requiredString(source, "sessionFile"),
				...(beforeEntryId === undefined ? {} : { beforeEntryId }),
				cwd: optionalString(source, "cwd"),
			});
		}
		case "snapshot": {
			const source = asObject(params);
			return await context.hub.snapshot(requiredString(source, "sessionId"));
		}
		case "entries": {
			const source = asObject(params);
			return await context.hub.entries(
				requiredString(source, "sessionId"),
				optionalString(source, "cursor"),
				optionalNumber(source, "limit"),
			);
		}
		case "entriesAfter": {
			const source = asObject(params);
			return await context.hub.entriesAfter(
				requiredString(source, "sessionId"),
				optionalString(source, "afterEntryId") ?? null,
			);
		}
		case "subscribe": {
			const source = asObject(params);
			const channel = subscribableChannel(source, "channel");
			const previous = connection.subscriptions.get(channel);
			if (previous) {
				unsubscribeChannel(context, channel, previous);
			}
			const sink = toSink(connection);
			connection.subscriptions.set(channel, sink);
			if (parseChannel(channel)?.kind === "sessions") {
				// 清单通道只有一条，标识对不上的按未知通道拒绝
				if (parseChannel(channel)?.id !== context.hostId) {
					throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
				}
				return context.sessions.subscribe(channel, optionalNumber(source, "since"), sink);
			}
			return await context.hub.subscribe(channel, optionalNumber(source, "since"), sink);
		}
		case "unsubscribe": {
			const source = asObject(params);
			const channel = subscribableChannel(source, "channel");
			const sink = connection.subscriptions.get(channel);
			if (sink) {
				unsubscribeChannel(context, channel, sink);
				connection.subscriptions.delete(channel);
			}
			return {};
		}
		case "models": {
			const source = asObject(params ?? {});
			return { models: context.factory.models(optionalString(source, "providerId")) };
		}
		case "availableModels":
			return { models: await context.factory.availableModels() };
		case "providers":
			return { providers: context.factory.providers() };
		case "listDirectory": {
			const source = asObject(params);
			const cwd = await resolveProjectDirectory(requiredString(source, "cwd"));
			return { entries: await asFileError(listDirectory(cwd, optionalString(source, "path") ?? "")) };
		}
		case "readFile": {
			const source = asObject(params);
			const cwd = await resolveProjectDirectory(requiredString(source, "cwd"));
			return await asFileError(readTextFile(cwd, requiredString(source, "path")));
		}
		case "writeFile": {
			const source = asObject(params);
			const cwd = await resolveProjectDirectory(requiredString(source, "cwd"));
			return await asFileError(
				writeTextFile(
					cwd,
					requiredString(source, "path"),
					requiredString(source, "content"),
					requiredString(source, "expectedRevision"),
				),
			);
		}
		case "gitStatus":
			return await gitStatus(await resolveProjectDirectory(requiredString(asObject(params), "cwd")));
		case "gitDiff": {
			const source = asObject(params);
			const cwd = await resolveProjectDirectory(requiredString(source, "cwd"));
			return await gitDiff(cwd, requiredString(source, "path"), source.untracked === true);
		}
		case "listProjects":
			return { projects: [...context.projectStore.list()] };
		case "addProject": {
			const source = asObject(params);
			const cwd = await resolveProjectDirectory(requiredString(source, "cwd"));
			return await context.projectStore.add({ cwd, name: optionalString(source, "name") });
		}
		case "renameProject": {
			const source = asObject(params);
			return await context.projectStore.rename(requiredString(source, "id"), optionalString(source, "name"));
		}
		case "removeProject": {
			const source = asObject(params);
			await context.projectStore.remove(requiredString(source, "id"));
			return {};
		}
		case "projectTrust": {
			const source = asObject(params);
			return context.factory.projectTrust(await resolveProjectDirectory(requiredString(source, "cwd")));
		}
		case "setProjectTrust": {
			const source = asObject(params);
			const trusted = source.trusted;
			if (typeof trusted !== "boolean") {
				throw new RequestError("bad_params", "trusted must be a boolean");
			}
			context.factory.setProjectTrust(await resolveProjectDirectory(requiredString(source, "cwd")), trusted);
			return {};
		}
		case "getSettings":
			return { settings: context.settingsStore.get() };
		case "updateSettings": {
			const source = asObject(params);
			const settings = source.settings;
			if (typeof settings !== "object" || settings === null) {
				throw new RequestError("bad_params", "settings must be an object");
			}
			return { settings: await context.settingsStore.save(settings as FacetSettings) };
		}
		case "busySessions":
			return { files: context.hub.busyFiles() };
		case "shutdownHost": {
			// 结束主机等于把主机上正在跑的任务一起停掉，只允许本机操作
			if (!isLoopbackAddress(connection.remoteAddress)) {
				throw new RequestError("rejected", "只有本机连接可以结束主机");
			}
			// 先给出应答再退，否则发出请求的端只会看到连接断开
			setTimeout(() => context.requestShutdown(), 50).unref();
			return {};
		}
		case "diagnostics": {
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
		}
		case "listCustomProviders":
			return { providers: await context.factory.customProviders() };
		case "saveCustomProvider": {
			const source = asObject(params);
			const provider = asObject(source.provider);
			await context.factory.saveCustomProvider({
				id: requiredString(provider, "id"),
				name: requiredString(provider, "name"),
				baseUrl: requiredString(provider, "baseUrl"),
				api: requiredString(provider, "api"),
				models: Array.isArray(provider.models) ? (provider.models as CustomProviderInfo["models"]) : [],
			});
			return { providers: await context.factory.customProviders() };
		}
		case "removeCustomProvider": {
			const source = asObject(params);
			await context.factory.removeCustomProvider(requiredString(source, "providerId"));
			return { providers: await context.factory.customProviders() };
		}
		case "setProviderBaseUrl": {
			const source = asObject(params);
			await context.factory.setProviderBaseUrl(
				requiredString(source, "providerId"),
				optionalString(source, "baseUrl") ?? "",
			);
			return { providers: context.factory.providers() };
		}
		case "testModel": {
			const source = asObject(params);
			return await context.factory.testModel({
				provider: requiredString(source, "provider"),
				id: requiredString(source, "id"),
			});
		}
		case "saveCredential": {
			const source = asObject(params);
			await context.factory.saveCredential(
				requiredString(source, "providerId"),
				requiredString(source, "apiKey"),
			);
			return { providers: context.factory.providers() };
		}
		case "deleteCredential": {
			const source = asObject(params);
			await context.factory.deleteCredential(requiredString(source, "providerId"));
			return { providers: context.factory.providers() };
		}
		case "renameSession": {
			const source = asObject(params);
			await context.hub.renameSession(requiredString(source, "sessionFile"), optionalString(source, "name"));
			return {};
		}
		case "deleteSession": {
			const source = asObject(params);
			await context.hub.deleteSession(requiredString(source, "sessionFile"));
			return {};
		}
		case "revealProject": {
			const source = asObject(params);
			const id = requiredString(source, "id");
			const project = context.projectStore.get(id);
			if (project === undefined) {
				throw new ProjectNotFoundError(id);
			}
			await revealInFileManager(project.cwd);
			return {};
		}
		default:
			throw new RequestError("unknown_method", `unknown method: ${method}`);
	}
}

/**
 * 校验并统一项目目录。
 *
 * 目录不存在或不是目录时直接拒绝；符号链接与 `..` 一律换成实际路径，同一个目录只认一个标识。
 */
/** 把文件操作的失败换成端点统一的错误码，界面据此给出不同提示。 */
async function asFileError<T>(work: Promise<T>): Promise<T> {
	try {
		return await work;
	} catch (error) {
		if (error instanceof FileAccessError) {
			throw new RequestError(error.code, error.message);
		}
		throw error;
	}
}

async function resolveProjectDirectory(cwd: string): Promise<string> {
	if (!isAbsolute(cwd)) {
		throw new RequestError("bad_params", `项目目录必须是绝对路径:${cwd}`);
	}
	let target: string;
	try {
		target = await realpath(cwd);
	} catch {
		throw new RequestError("rejected", `项目目录不存在:${cwd}`);
	}
	const info = await stat(target).catch(() => undefined);
	if (info === undefined || !info.isDirectory()) {
		throw new RequestError("rejected", `不是目录:${cwd}`);
	}
	return target;
}

function toProtocolError(error: unknown): { code: ErrorCode; message: string } {
	if (error instanceof RequestError) {
		return { code: error.code, message: error.message };
	}
	if (error instanceof SessionNotFoundError) {
		return { code: "unknown_session", message: error.message };
	}
	if (error instanceof ChannelNotFoundError) {
		return { code: "unknown_channel", message: error.message };
	}
	if (error instanceof InvalidProviderError) {
		return { code: "rejected", message: error.message };
	}
	if (
		error instanceof ProjectExistsError ||
		error instanceof ProjectNotFoundError ||
		error instanceof RevealFailedError
	) {
		return { code: "rejected", message: error.message };
	}
	if (
		error instanceof SessionEntryNotFoundError ||
		error instanceof SessionBoundaryNotFoundError ||
		error instanceof SessionBusyError ||
		error instanceof SessionFileMissingError
	) {
		return { code: "rejected", message: error.message };
	}
	return { code: "internal", message: error instanceof Error ? error.message : String(error) };
}

/** 拒绝一条端点派发的动作:回一个带 rejectionReason 的帧给发起方,不写进通道序号流。 */
async function handleDispatch(context: EndpointContext, connection: Connection, raw: unknown): Promise<void> {
	const source = asObject(raw);
	const channel = requiredChannel(source, "channel");
	const action = source.action as Action;
	const clientSeq = optionalNumber(source, "clientSeq") ?? 0;
	if (typeof action !== "object" || action === null || typeof action.type !== "string") {
		throw new RequestError("bad_params", "action must carry a type");
	}
	// 受理后立即返回:动作的执行结果由通道上的动作反映,拒绝才回一个带原因的帧。
	// 不等待执行完成,否则同一端连续发出的动作会被前一条阻塞。
	void applyAction(context, channel, action).catch((error) => {
		const failure = toProtocolError(error);
		connection.send({
			type: "action",
			channel,
			action,
			serverSeq: context.hub.lastSeq(channel),
			origin: { clientId: connection.clientId, clientSeq },
			rejectionReason: failure.message,
		} satisfies ActionFrame);
	});
}

/** 令牌是否与主机配置一致。主机没设令牌时放行，只用于本机调试环境。 */
function matchesToken(context: EndpointContext, token: string): boolean {
	const expected = context.config.token;
	if (expected === undefined || expected.length === 0) {
		return true;
	}
	return token === expected;
}

async function handleFrame(context: EndpointContext, connection: Connection, text: string): Promise<void> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		connection.close(1003, "invalid json");
		return;
	}
	if (typeof parsed !== "object" || parsed === null) {
		connection.close(1003, "invalid frame");
		return;
	}
	const frame = parsed as {
		type?: unknown;
		id?: unknown;
		method?: unknown;
		params?: unknown;
		token?: unknown;
	};
	if (!connection.authenticated) {
		// 首帧必须是令牌；校验不过直接断开，之后才发 hello
		if (frame.type !== "auth" || typeof frame.token !== "string") {
			connection.close(1008, "需要先认证");
			return;
		}
		if (!matchesToken(context, frame.token)) {
			connection.close(1008, "令牌不匹配");
			return;
		}
		connection.authenticated = true;
		connection.send({
			type: "hello",
			protocolVersion: PROTOCOL_VERSION,
			hostId: context.hostId,
			hostName: context.config.hostName,
			clientId: connection.clientId,
			capabilities: CAPABILITIES,
		} satisfies HelloFrame);
		return;
	}
	if (frame.type === "dispatch") {
		try {
			await handleDispatch(context, connection, frame);
		} catch (error) {
			connection.close(1008, toProtocolError(error).message);
		}
		return;
	}
	if (frame.type !== "request" || typeof frame.id !== "string" || typeof frame.method !== "string") {
		connection.close(1003, "invalid frame");
		return;
	}
	const response: ResponseFrame = await (async () => {
		try {
			const data = await handleRequest(context, connection, frame.method as string, frame.params);
			return { type: "response", id: frame.id as string, ok: true, data } as ResponseFrame;
		} catch (error) {
			return {
				type: "response",
				id: frame.id as string,
				ok: false,
				error: toProtocolError(error),
			} satisfies ResponseFrame;
		}
	})();
	connection.send(response);
}

/** 启动端点监听。返回实际端口,供嵌入方写入自己的握手信息。 */
export async function startEndpoint(options: {
	config: ServerConfig;
	factory: PiAgentFactory;
	hub: SessionHub;
	projectStore: ProjectStore;
	settingsStore: SettingsStore;
	hostId: string;
	/** 主机标识的派生来源，缺省当作由 machine-id 派生 */
	hostSource?: HostSource;
	/** 收到 shutdownHost 请求后调用 */
	requestShutdown?: () => void;
	/** 会话清单通道 */
	sessions: SessionsChannel;
}): Promise<EndpointHandle> {
	const context: EndpointContext = {
		config: options.config,
		factory: options.factory,
		hub: options.hub,
		projectStore: options.projectStore,
		settingsStore: options.settingsStore,
		hostId: options.hostId,
		hostSource: options.hostSource ?? "machine-id",
		connections: new Set(),
		requestShutdown: options.requestShutdown ?? (() => {}),
		sessions: options.sessions,
	};

	/** 连接关闭时的清理：退掉订阅、从表里摘掉。 */
	const cleanup = (connection: Connection): void => {
		if (!context.connections.delete(connection)) {
			return;
		}
		for (const [channel, sink] of connection.subscriptions) {
			unsubscribeChannel(context, channel, sink);
		}
		connection.subscriptions.clear();
	};

	/** 一条新连接：按行切帧，首帧认令牌，通过后发 hello。 */
	const accept = (socket: Socket): void => {
		const connection: Connection = {
			clientId: randomUUID(),
			remoteAddress: socket.remoteAddress,
			subscriptions: new Map(),
			authenticated: false,
			send: (frame) => {
				if (!socket.destroyed) {
					socket.write(encodeFrame(frame));
				}
			},
			close: (_code, reason) => {
				socket.end();
				socket.destroy();
				cleanup(connection);
				void reason;
			},
		};
		context.connections.add(connection);
		const decoder = new FrameDecoder();
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			let lines: string[];
			try {
				lines = decoder.push(chunk);
			} catch {
				connection.close(1009, "帧超过上限");
				return;
			}
			for (const line of lines) {
				void handleFrame(context, connection, line);
			}
		});
		socket.on("close", () => cleanup(connection));
		socket.on("error", () => cleanup(connection));
	};

	const useUnixSocket = options.config.socketPath !== undefined && options.config.socketPath.length > 0;
	const socketServer = createSocketServer((socket) => accept(socket));

	if (useUnixSocket) {
		const path = options.config.socketPath as string;
		// 上一次异常退出可能留下同名的 socket 文件，先清掉再监听
		await rm(path, { force: true }).catch(() => undefined);
		await mkdir(dirname(path), { recursive: true, mode: 0o700 }).catch(() => undefined);
		await new Promise<void>((resolve, reject) => {
			socketServer.once("error", reject);
			socketServer.listen(path, () => {
				socketServer.off("error", reject);
				resolve();
			});
		});
		// socket 本身也收成仅本人可读写，同机的其他用户连不上
		await chmod(path, 0o600).catch(() => undefined);
	} else {
		await new Promise<void>((resolve, reject) => {
			socketServer.once("error", reject);
			socketServer.listen(options.config.port, options.config.host, () => {
				socketServer.off("error", reject);
				resolve();
			});
		});
	}

	const address = socketServer.address();
	const port = typeof address === "object" && address !== null ? address.port : 0;

	return {
		port,
		host: options.config.host,
		...(useUnixSocket ? { socketPath: options.config.socketPath as string } : {}),
		close: async () => {
			for (const connection of [...context.connections]) {
				connection.close(1001, "host shutting down");
			}
			context.connections.clear();
			context.sessions.clear();
			await new Promise<void>((resolve) => {
				socketServer.close(() => resolve());
			});
		},
	};
}
