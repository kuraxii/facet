/**
 * 端点接入。
 *
 * 一条 WebSocket 连接对应一个端。连接建立后主机先发 hello(带本次连接的端标识),
 * 之后端点发请求、主机回响应;状态变更走 action 帧,按通道定序推给订阅者。
 * 断线时该端的订阅全部解除,会话本身继续在主机上运行。
 */
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute } from "node:path";
import { InvalidProviderError, type PiAgentFactory } from "@facet/agent";
import {
	type Action,
	type ActionFrame,
	type Capability,
	type Channel,
	type CustomProviderInfo,
	type ErrorCode,
	type FacetSettings,
	type HelloFrame,
	PROTOCOL_VERSION,
	parseChannel,
	type RequestParams,
	type ResponseFrame,
	type ServerFrame,
	type SessionSnapshot,
} from "@facet/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "./config.ts";
import { buildDiagnostics } from "./diagnostics.ts";
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
import type { SettingsStore } from "./settings-store.ts";

const ENDPOINT_PATH = "/endpoint";
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

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

interface Connection {
	readonly ws: WebSocket;
	/** 本次连接的端标识,写进回放动作的 origin */
	readonly clientId: string;
	/** 已订阅的通道与其转发函数,用于取消订阅与断线清理 */
	readonly subscriptions: Map<Channel, ActionSink>;
}

interface EndpointContext {
	readonly config: ServerConfig;
	readonly factory: PiAgentFactory;
	readonly hub: SessionHub;
	readonly projectStore: ProjectStore;
	readonly settingsStore: SettingsStore;
	readonly hostId: string;
	readonly connections: Set<Connection>;
}

export interface EndpointHandle {
	/** 实际监听的端口,配置为 0 时由系统分配 */
	readonly port: number;
	readonly host: string;
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

function send(ws: WebSocket, frame: ServerFrame): void {
	if (ws.readyState !== WebSocket.OPEN) {
		return;
	}
	ws.send(JSON.stringify(frame));
}

function toSink(connection: Connection): ActionSink {
	return { id: connection.clientId, send: (frame) => send(connection.ws, frame) };
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
			const channel = requiredChannel(source, "channel");
			const previous = connection.subscriptions.get(channel);
			if (previous) {
				context.hub.unsubscribe(channel, previous);
			}
			const sink = toSink(connection);
			connection.subscriptions.set(channel, sink);
			return await context.hub.subscribe(channel, optionalNumber(source, "since"), sink);
		}
		case "unsubscribe": {
			const source = asObject(params);
			const channel = requiredChannel(source, "channel");
			const sink = connection.subscriptions.get(channel);
			if (sink) {
				context.hub.unsubscribe(channel, sink);
				connection.subscriptions.delete(channel);
			}
			return {};
		}
		case "models": {
			const source = asObject(params ?? {});
			return { models: context.factory.models(optionalString(source, "providerId")) };
		}
		case "providers":
			return { providers: context.factory.providers() };
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
		case "diagnostics": {
			const [sessions, settings] = await Promise.all([
				context.factory.listSessions(),
				Promise.resolve(context.settingsStore.get()),
			]);
			return {
				text: await buildDiagnostics({
					protocolVersion: PROTOCOL_VERSION,
					hostId: context.hostId,
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
		send(connection.ws, {
			type: "action",
			channel,
			action,
			serverSeq: context.hub.lastSeq(channel),
			origin: { clientId: connection.clientId, clientSeq },
			rejectionReason: failure.message,
		} satisfies ActionFrame);
	});
}

async function handleFrame(context: EndpointContext, connection: Connection, text: string): Promise<void> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		connection.ws.close(1003, "invalid json");
		return;
	}
	if (typeof parsed !== "object" || parsed === null) {
		connection.ws.close(1003, "invalid frame");
		return;
	}
	const frame = parsed as { type?: unknown; id?: unknown; method?: unknown; params?: unknown };
	if (frame.type === "dispatch") {
		try {
			await handleDispatch(context, connection, frame);
		} catch (error) {
			connection.ws.close(1008, toProtocolError(error).message);
		}
		return;
	}
	if (frame.type !== "request" || typeof frame.id !== "string" || typeof frame.method !== "string") {
		connection.ws.close(1003, "invalid frame");
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
	send(connection.ws, response);
}

/** 启动端点监听。返回实际端口,供嵌入方写入自己的握手信息。 */
export async function startEndpoint(options: {
	config: ServerConfig;
	factory: PiAgentFactory;
	hub: SessionHub;
	projectStore: ProjectStore;
	settingsStore: SettingsStore;
	hostId: string;
}): Promise<EndpointHandle> {
	const context: EndpointContext = {
		config: options.config,
		factory: options.factory,
		hub: options.hub,
		projectStore: options.projectStore,
		settingsStore: options.settingsStore,
		hostId: options.hostId,
		connections: new Set(),
	};

	const httpServer = createServer((_request, response) => {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end(`facet host endpoint, use websocket at ${ENDPOINT_PATH}\n`);
	});

	const wss = new WebSocketServer({ server: httpServer, path: ENDPOINT_PATH, maxPayload: MAX_FRAME_BYTES });

	wss.on("connection", (ws: WebSocket) => {
		const connection: Connection = { ws, clientId: randomUUID(), subscriptions: new Map() };
		context.connections.add(connection);
		const hello: HelloFrame = {
			type: "hello",
			protocolVersion: PROTOCOL_VERSION,
			hostId: context.hostId,
			hostName: context.config.hostName,
			clientId: connection.clientId,
			capabilities: CAPABILITIES,
		};
		send(ws, hello);
		ws.on("message", (raw) => {
			void handleFrame(context, connection, raw.toString());
		});
		ws.on("close", () => {
			for (const [channel, sink] of connection.subscriptions) {
				context.hub.unsubscribe(channel, sink);
			}
			connection.subscriptions.clear();
			context.connections.delete(connection);
		});
	});

	await new Promise<void>((resolve, reject) => {
		httpServer.once("error", reject);
		httpServer.listen(options.config.port, options.config.host, () => {
			httpServer.off("error", reject);
			resolve();
		});
	});

	const address = httpServer.address();
	const port = typeof address === "object" && address !== null ? address.port : options.config.port;

	return {
		port,
		host: options.config.host,
		close: async () => {
			for (const connection of context.connections) {
				connection.ws.close(1001, "host shutting down");
			}
			context.connections.clear();
			await new Promise<void>((resolve) => {
				wss.close(() => resolve());
			});
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
		},
	};
}
