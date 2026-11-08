/**
 * 端点接入。
 *
 * 一条 WebSocket 连接对应一个端。连接建立后设备先发 hello(带本次连接的端标识),
 * 之后端点发请求、设备回响应;状态变更走 action 帧,按通道定序推给订阅者。
 * 断线时该端的订阅全部解除,会话本身继续在设备上运行。
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { PiAgentRuntime } from "@facet/agent";
import {
	type Action,
	type ActionFrame,
	type Capability,
	type Channel,
	type ErrorCode,
	type HelloFrame,
	PROTOCOL_VERSION,
	parseChannel,
	type RequestParams,
	type ResponseFrame,
	type ServerFrame,
	type SessionSnapshot,
} from "@facet/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { ApprovalBroker } from "./approval-broker.ts";
import type { ServerConfig } from "./config.ts";
import {
	type ActionSink,
	ChannelNotFoundError,
	type SessionHub,
	SessionNotFoundError,
} from "./session-hub.ts";

const ENDPOINT_PATH = "/endpoint";
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

/** 当前设备已实现的能力。未列入的入口由端点隐藏。 */
const CAPABILITIES: Capability[] = ["dispatch", "approval", "tools", "compaction", "export"];

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
	readonly runtime: PiAgentRuntime;
	readonly hub: SessionHub;
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
	return (frame: ActionFrame) => {
		send(connection.ws, frame);
	};
}

/** 建立会话并把审批应答接到该会话的中转上。 */
async function createSession(context: EndpointContext, params: unknown): Promise<SessionSnapshot> {
	const source = asObject(params ?? {});
	const model = source.model;
	if (model !== undefined && typeof model !== "object") {
		throw new RequestError("bad_params", "model must be an object");
	}
	const modelRecord = model === undefined ? undefined : asObject(model);
	const broker = new ApprovalBroker();
	const agent = await context.runtime.createAgent({
		cwd: optionalString(source, "cwd"),
		model: modelRecord
			? { provider: requiredString(modelRecord, "provider"), id: requiredString(modelRecord, "id") }
			: undefined,
		thinkingLevel: optionalString(source, "thinkingLevel") as RequestParams["createSession"]["thinkingLevel"],
		tools: optionalStringArray(source, "tools"),
		excludeTools: optionalStringArray(source, "excludeTools"),
		name: optionalString(source, "name"),
		approvalHandler: broker.handler,
	});
	context.hub.attach(agent, broker);
	return agent.snapshot();
}

/** 打开已有会话,模型与工具集从会话记录恢复。 */
async function openSession(context: EndpointContext, params: unknown): Promise<SessionSnapshot> {
	const source = asObject(params);
	const broker = new ApprovalBroker();
	const agent = await context.runtime.openAgent({
		sessionFile: requiredString(source, "sessionFile"),
		cwd: optionalString(source, "cwd"),
		approvalHandler: broker.handler,
	});
	context.hub.attach(agent, broker);
	return agent.snapshot();
}

/** 应用一条端点派发的动作。返回即表示已受理,设备产生的动作随后从通道推出。 */
async function applyAction(context: EndpointContext, channel: Channel, action: Action): Promise<void> {
	const parsed = parseChannel(channel);
	if (!parsed) {
		throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
	}
	const sessionId = parsed.id;
	switch (action.type) {
		case "chat/turnStarted": {
			const agent = context.hub.agent(sessionId);
			if (agent.isStreaming && action.streamingBehavior === undefined) {
				throw new RequestError("rejected", "session is running, streamingBehavior is required");
			}
			await agent.prompt(action.text, {
				images: action.images,
				streamingBehavior: action.streamingBehavior,
			});
			return;
		}
		case "chat/turnCancelled":
			await context.hub.agent(sessionId).abort();
			return;
		case "chat/pendingMessageSet": {
			const agent = context.hub.agent(sessionId);
			if (action.kind === "steering") {
				await agent.steer(action.text);
			} else {
				await agent.followUp(action.text);
			}
			return;
		}
		case "chat/queueCleared":
			context.hub.agent(sessionId).clearQueue();
			return;
		case "chat/toolCallConfirmed":
			context.hub.respondApproval(sessionId, action.requestId, action.decision);
			return;
		case "session/titleChanged":
			context.hub.agent(sessionId).setName(action.title);
			return;
		case "session/configChanged": {
			const agent = context.hub.agent(sessionId);
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
		}
		default:
			throw new RequestError("unknown_method", `action is produced by the device: ${action.type}`);
	}
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
			return { sessions: await context.runtime.listSessions(optionalString(source, "cwd")) };
		}
		case "createSession":
			return await createSession(context, params);
		case "openSession":
			return await openSession(context, params);
		case "closeSession": {
			const source = asObject(params);
			context.hub.release(requiredString(source, "sessionId"));
			return {};
		}
		case "snapshot": {
			const source = asObject(params);
			return context.hub.snapshot(requiredString(source, "sessionId"));
		}
		case "entries": {
			const source = asObject(params);
			return context.hub.entries(
				requiredString(source, "sessionId"),
				optionalString(source, "cursor"),
				optionalNumber(source, "limit"),
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
			return context.hub.subscribe(channel, optionalNumber(source, "since"), sink);
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
			return { models: context.runtime.models(optionalString(source, "providerId")) };
		}
		case "providers":
			return { providers: context.runtime.providers() };
		default:
			throw new RequestError("unknown_method", `unknown method: ${method}`);
	}
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
	runtime: PiAgentRuntime;
	hub: SessionHub;
	hostId: string;
}): Promise<EndpointHandle> {
	const context: EndpointContext = {
		config: options.config,
		runtime: options.runtime,
		hub: options.hub,
		hostId: options.hostId,
		connections: new Set(),
	};

	const httpServer = createServer((_request, response) => {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end(`facet device endpoint, use websocket at ${ENDPOINT_PATH}\n`);
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
				connection.ws.close(1001, "device shutting down");
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
