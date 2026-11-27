/**
 * 会话域的请求处理器。
 *
 * 每个处理器只拿到已经校验过的参数与主机上下文，不做形状检查：参数由
 * `generated/checks.ts` 的契约在网关里挡过一道，这里只处理语义。
 */
import {
	type Channel,
	PI_BACKEND_ID,
	parseChannel,
	type RequestParams,
	type RequestResults,
} from "@facet/protocol";
import { type Connection, RequestError, type RpcContext } from "../context.ts";
import type { RequestHandlerMap } from "../gateway.ts";
import {
	requireSubscribableChannel,
	resolveProjectDirectory,
	toSink,
	unsubscribeChannel,
} from "../helpers.ts";

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
	| "contextDetails"
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
		const backendFilter = params.backendId;
		const piSessions =
			backendFilter === undefined || backendFilter === PI_BACKEND_ID
				? (await context.factory.listSessions(params.cwd)).map((summary) => ({
						backendId: PI_BACKEND_ID,
						...summary,
					}))
				: [];
		const acpSessions =
			backendFilter === undefined || backendFilter !== PI_BACKEND_ID
				? (context.acpRuntime?.index.list(params.cwd, backendFilter) ?? [])
				: [];
		const sessions = [...piSessions, ...acpSessions].sort((left, right) => right.modified - left.modified);
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
	//
	// cwd 由端带过来，必须先按主机自己的磁盘核一遍：端可能还握着另一台机器的路径
	// （Windows 的 `C:\Program Files\facet` 在 Linux 上就是一条不存在的相对路径），直接透传给
	// pi 会在数据目录下凭空建出一个同名目录，并把这个路径当成项目登记下来。
	createSession: async (params, context: RpcContext): Promise<RequestResults["createSession"]> => {
		const cwd = params.cwd === undefined ? undefined : await resolveProjectDirectory(params.cwd);
		return await context.hub.createSession({
			...(cwd === undefined ? {} : { cwd }),
			backendId: params.backendId,
			model: params.model,
			thinkingLevel: params.thinkingLevel,
			tools: params.tools,
			excludeTools: params.excludeTools,
			name: params.name,
		});
	},

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

	contextDetails: async (params, context: RpcContext): Promise<RequestResults["contextDetails"]> =>
		await context.hub.contextDetails(params.sessionId),

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
		if (parsed?.kind === "models") {
			// 模型通道只有一条，标识对不上的按未知通道拒绝
			if (parsed.id !== context.hostId) {
				throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
			}
			return context.modelLog.subscribe(channel, params.since, sink);
		}
		if (parsed?.kind === "terminal") {
			// 终端通道按标识对号，登记里没有的按未知通道拒绝
			if (context.terminals.get(parsed.id) === undefined) {
				throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
			}
			return context.terminals.subscribe(channel, params.since, sink);
		}
		if (parsed?.kind === "workspace") {
			// 工作树通道的标识就是目录，目录不在的按未知通道拒绝
			const subscribed = await context.workspaces.subscribe(channel, params.since, sink);
			if (subscribed === undefined) {
				throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
			}
			return subscribed;
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
