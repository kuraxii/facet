/**
 * 会话域的请求处理器。
 *
 * 每个处理器只拿到已经校验过的参数与主机上下文，不做形状检查：参数由
 * `generated/checks.ts` 的契约在网关里挡过一道，这里只处理语义。
 */
import { type Channel, parseChannel, type RequestParams, type RequestResults } from "@facet/protocol";
import { type Connection, RequestError, type RpcContext } from "../context.ts";
import type { RequestHandlerMap } from "../gateway.ts";
import { requireSubscribableChannel, toSink, unsubscribeChannel } from "../helpers.ts";

/** 会话域负责的方法。 */
type SessionMethod =
	| "respondUi"
	| "listSessions"
	| "listCommands"
	| "busySessions"
	| "createSession"
	| "openSession"
	| "forkSession"
	| "snapshot"
	| "entries"
	| "entriesAfter"
	| "subscribe"
	| "unsubscribe"
	| "renameSession"
	| "deleteSession"
	| "markSessionsSeen";

export const sessionHandlers: Pick<RequestHandlerMap, SessionMethod> = {
	// 不经过 withSession，正在等待这份应答的初始化或命令才能继续。
	respondUi: (params: RequestParams["respondUi"], context: RpcContext): RequestResults["respondUi"] => {
		const agent = context.hub.agent(params.sessionId);
		return { accepted: agent.respondUi(params.requestId, params.response) };
	},

	listCommands: async (params, context: RpcContext): Promise<RequestResults["listCommands"]> => ({
		commands: await context.hub.commands(params.sessionId),
	}),

	listSessions: async (params, context: RpcContext): Promise<RequestResults["listSessions"]> => {
		const sessions = await context.factory.listSessions(params.cwd);
		// 清单已经回给端了，可以在背景里补齐剩下的摘要
		context.onSessionsListed?.();
		// 每条带上主机侧此刻的状态，端重连之后一次往返就能把本地那份对齐
		return {
			sessions: sessions.map((summary) => ({ summary, status: context.hub.statusOf(summary.path) })),
		};
	},

	busySessions: (_params, context: RpcContext): RequestResults["busySessions"] => ({
		files: context.hub.busyFiles(),
	}),

	// 新建会话并返回初始快照；模型与思考档位缺省时由主机侧补齐。
	createSession: async (params, context: RpcContext): Promise<RequestResults["createSession"]> =>
		await context.hub.createSession({
			cwd: params.cwd,
			model: params.model,
			thinkingLevel: params.thinkingLevel,
			tools: params.tools,
			excludeTools: params.excludeTools,
			name: params.name,
		}),

	// 打开已有会话,模型与工具集从会话记录恢复。
	openSession: async (params, context: RpcContext): Promise<RequestResults["openSession"]> =>
		await context.hub.openSession(params.sessionFile, params.cwd),

	forkSession: async (params, context: RpcContext): Promise<RequestResults["forkSession"]> =>
		await context.hub.forkSession({
			sessionFile: params.sessionFile,
			...(params.beforeEntryId === undefined ? {} : { beforeEntryId: params.beforeEntryId }),
			cwd: params.cwd,
		}),

	snapshot: async (params, context: RpcContext): Promise<RequestResults["snapshot"]> =>
		await context.hub.snapshot(params.sessionId),

	entries: async (params, context: RpcContext): Promise<RequestResults["entries"]> =>
		await context.hub.entries(params.sessionId, params.cursor, params.limit),

	entriesAfter: async (params, context: RpcContext): Promise<RequestResults["entriesAfter"]> =>
		await context.hub.entriesAfter(params.sessionId, params.afterEntryId ?? null),

	subscribe: async (
		params,
		context: RpcContext,
		connection: Connection,
	): Promise<RequestResults["subscribe"]> => {
		const channel = requireSubscribableChannel(params.channel);
		const previous = connection.subscriptions.get(channel);
		if (previous !== undefined) {
			unsubscribeChannel(context, channel, previous);
		}
		const sink = toSink(connection);
		connection.subscriptions.set(channel, sink);
		const parsed = parseChannel(channel);
		if (parsed?.kind === "sessions") {
			// 清单通道只有一条，标识对不上的按未知通道拒绝
			if (parsed.id !== context.hostId) {
				throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
			}
			return context.sessions.subscribe(channel, params.since, sink);
		}
		if (parsed?.kind === "terminal") {
			// 终端通道按标识对号，登记里没有的按未知通道拒绝
			if (context.terminals.get(parsed.id) === undefined) {
				throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
			}
			return context.terminals.subscribe(channel, params.since, sink);
		}
		return await context.hub.subscribe(channel, params.since, sink);
	},

	unsubscribe: (params, context: RpcContext, connection: Connection): RequestResults["unsubscribe"] => {
		const channel: Channel = requireSubscribableChannel(params.channel);
		const sink = connection.subscriptions.get(channel);
		if (sink !== undefined) {
			unsubscribeChannel(context, channel, sink);
			connection.subscriptions.delete(channel);
		}
		return {};
	},

	renameSession: async (params, context: RpcContext): Promise<RequestResults["renameSession"]> => {
		await context.hub.renameSession(params.sessionFile, params.name);
		return {};
	},

	deleteSession: async (params, context: RpcContext): Promise<RequestResults["deleteSession"]> => {
		await context.hub.deleteSession(params.sessionFile);
		return {};
	},

	// 只记水位，不读会话文件；主机收到后广播新的状态，多端看到同一份未读结果。
	markSessionsSeen: (params, context: RpcContext): RequestResults["markSessionsSeen"] => {
		for (const file of params.sessionFiles) {
			context.hub.markSeen(file);
		}
		return {};
	},
};
