/**
 * 端点接入。
 *
 * 一条 WebSocket 连接对应一个端。连接建立后设备先发 hello，之后端点发请求、设备回响应，
 * 订阅中的会话事件按序号推给该端。断线时该端的订阅全部解除，会话本身继续在设备上运行。
 */
import { createServer } from "node:http";
import type { PiAgentRuntime } from "@facet/agent";
import {
	type ApprovalDecision,
	type Capability,
	type ErrorCode,
	type EventFrame,
	type HelloFrame,
	PROTOCOL_VERSION,
	type RequestParams,
	type ResponseFrame,
	type ServerFrame,
	type SessionSnapshot,
} from "@facet/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { ApprovalBroker } from "./approval-broker.ts";
import type { ServerConfig } from "./config.ts";
import { type EventSink, type SessionHub, SessionNotFoundError } from "./session-hub.ts";

const ENDPOINT_PATH = "/endpoint";
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

/** 当前设备已实现的能力。未列入的入口由端点隐藏。 */
const CAPABILITIES: Capability[] = ["approval", "tools", "compaction", "export"];

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
	/** 已订阅的会话与其转发函数，用于取消订阅与断线清理 */
	readonly subscriptions: Map<string, EventSink>;
}

interface EndpointContext {
	readonly config: ServerConfig;
	readonly runtime: PiAgentRuntime;
	readonly hub: SessionHub;
	readonly hostId: string;
	readonly connections: Set<Connection>;
}

export interface EndpointHandle {
	/** 实际监听的端口，配置为 0 时由系统分配 */
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

function send(ws: WebSocket, frame: ServerFrame): void {
	if (ws.readyState !== WebSocket.OPEN) {
		return;
	}
	ws.send(JSON.stringify(frame));
}

function toEventSink(connection: Connection): EventSink {
	return (frame: EventFrame) => {
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

/** 打开已有会话，模型与工具集从会话记录恢复。 */
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

async function dispatch(context: EndpointContext, connection: Connection, method: string, params: unknown) {
	switch (method) {
		case "listSessions": {
			const source = asObject(params ?? {});
			return { sessions: await context.runtime.listSessions(optionalString(source, "cwd")) };
		}
		case "createSession":
			return await createSession(context, params);
		case "openSession":
			return await openSession(context, params);
		case "subscribe": {
			const source = asObject(params);
			const sessionId = requiredString(source, "sessionId");
			const previous = connection.subscriptions.get(sessionId);
			if (previous) {
				context.hub.unsubscribe(sessionId, previous);
			}
			const sink = toEventSink(connection);
			connection.subscriptions.set(sessionId, sink);
			return context.hub.subscribe(sessionId, optionalNumber(source, "since"), sink);
		}
		case "unsubscribe": {
			const source = asObject(params);
			const sessionId = requiredString(source, "sessionId");
			const sink = connection.subscriptions.get(sessionId);
			if (sink) {
				context.hub.unsubscribe(sessionId, sink);
				connection.subscriptions.delete(sessionId);
			}
			return {};
		}
		case "prompt": {
			const source = asObject(params);
			const sessionId = requiredString(source, "sessionId");
			const agent = context.hub.agent(sessionId);
			if (agent.isStreaming && source.streamingBehavior === undefined) {
				throw new RequestError("rejected", "session is running, streamingBehavior is required");
			}
			const disposition = await agent.prompt(requiredString(source, "text"), {
				images: source.images as RequestParams["prompt"]["images"],
				streamingBehavior: source.streamingBehavior as RequestParams["prompt"]["streamingBehavior"],
			});
			return { disposition };
		}
		case "abort": {
			const source = asObject(params);
			await context.hub.agent(requiredString(source, "sessionId")).abort();
			return {};
		}
		case "approve": {
			const source = asObject(params);
			const sessionId = requiredString(source, "sessionId");
			const accepted = context.hub.respondApproval(
				sessionId,
				requiredString(source, "requestId"),
				source.decision as ApprovalDecision,
			);
			return { accepted };
		}
		case "snapshot": {
			const source = asObject(params);
			return context.hub.snapshot(requiredString(source, "sessionId"));
		}
		case "entries": {
			const source = asObject(params);
			const agent = context.hub.agent(requiredString(source, "sessionId"));
			const since = optionalString(source, "since");
			try {
				return agent.entries(since);
			} catch (error) {
				throw new RequestError("rejected", error instanceof Error ? error.message : "unknown entry");
			}
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
	return { code: "internal", message: error instanceof Error ? error.message : String(error) };
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
	if (frame.type !== "request" || typeof frame.id !== "string" || typeof frame.method !== "string") {
		connection.ws.close(1003, "invalid frame");
		return;
	}
	const response: ResponseFrame = await (async () => {
		try {
			const data = await dispatch(context, connection, frame.method as string, frame.params);
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

/** 启动端点监听。返回实际端口，供嵌入方写入自己的握手信息。 */
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
		const connection: Connection = { ws, subscriptions: new Map() };
		context.connections.add(connection);
		const hello: HelloFrame = {
			type: "hello",
			protocolVersion: PROTOCOL_VERSION,
			hostId: context.hostId,
			hostName: context.config.hostName,
			capabilities: CAPABILITIES,
		};
		send(ws, hello);
		ws.on("message", (raw) => {
			void handleFrame(context, connection, raw.toString());
		});
		ws.on("close", () => {
			for (const [sessionId, sink] of connection.subscriptions) {
				context.hub.unsubscribe(sessionId, sink);
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
