/**
 * 表驱动的双轨分发。
 *
 * 请求是「一问一答」，动作是「只发不回」：两条路都先查 `generated/checks.ts` 里的契约，
 * 再判权限档，最后交给按领域拆开的处理器。参数形状不在这里手写，任何一个方法漏实现都会
 * 在 `REQUEST_HANDLERS` 的类型上编译不过。
 */

import type { DispatchContract, RequestContract } from "@facet/protocol";
import {
	type ActionEcho,
	type ActionFrame,
	type AuthTier,
	type Channel,
	type ClientRole,
	DISPATCH_CONTRACTS,
	makeChannel,
	parseChannel,
	REQUEST_CONTRACTS,
	type RejectedActionFrame,
	type RequestMethod,
	type RequestParams,
	type RequestResults,
} from "@facet/protocol";
import {
	auditRemote,
	type Connection,
	canManage,
	RequestError,
	type RpcContext,
	toProtocolError,
} from "./context.ts";
import { DispatchLog } from "./dispatch-log.ts";
import { backendHandlers } from "./handlers/backend-handlers.ts";
import type { DispatchHandlerMap } from "./handlers/chat-handlers.ts";
import { chatHandlers } from "./handlers/chat-handlers.ts";
import { sessionHandlers } from "./handlers/session-handlers.ts";
import { systemHandlers } from "./handlers/system-handlers.ts";
import { terminalHandlers } from "./handlers/terminal-handlers.ts";
import { requireActionChannel } from "./helpers.ts";

/**
 * 一个请求处理器。
 *
 * 参数与返回值按方法名绑定：方法名写错这里就编译不过。
 */
export type RequestHandler<K extends RequestMethod> = (
	params: RequestParams[K],
	context: RpcContext,
	connection: Connection,
) => Promise<RequestResults[K]> | RequestResults[K];

/** 全部请求方法的处理器表。 */
export type RequestHandlerMap = { [K in RequestMethod]: RequestHandler<K> };

/** 合并各领域处理器；任何一域漏了方法，这里就缺键。 */
export const REQUEST_HANDLERS: RequestHandlerMap = {
	...sessionHandlers,
	...terminalHandlers,
	...systemHandlers,
	...backendHandlers,
};

/** 判断这条连接能不能调用某个权限档的方法。 */
function assertTierAllowed(connection: Connection, tier: AuthTier): void {
	if (connection.role === "admin") {
		return;
	}
	if (tier === "admin" && !canManage(connection)) {
		throw new RequestError("rejected", "This operation is only available in the desktop app");
	}
	if (connection.role === "viewer" && tier === "write") {
		throw new RequestError("rejected", "This connection is read-only");
	}
}

/** 记一笔远程写操作。 */
function auditIfRemoteWrite(
	context: RpcContext,
	connection: Connection,
	method: string,
	contract: RequestContract,
): void {
	if (connection.role !== "admin" && contract.auth !== "public") {
		auditRemote(context, connection, method);
	}
}

/**
 * 处理一条请求。
 *
 * 顺序与重构前一致：未知方法先判未知，再做权限判定（被拒的记审计），最后校验参数。
 */
export async function handleRequest(
	context: RpcContext,
	connection: Connection,
	method: string,
	params: unknown,
): Promise<unknown> {
	const contract = REQUEST_CONTRACTS[method];
	if (contract === undefined) {
		throw new RequestError("unknown_method", `unknown method: ${method}`);
	}
	try {
		assertTierAllowed(connection, contract.auth);
	} catch (error) {
		auditRemote(context, connection, method, toProtocolError(error).message);
		throw error;
	}
	auditIfRemoteWrite(context, connection, method, contract);
	const handler = REQUEST_HANDLERS[method as RequestMethod];
	// 没有参数的方法允许调用方整条省掉 params
	const input: unknown = params ?? {};
	if (!contract.check(input)) {
		throw new RequestError("bad_params", `invalid params for ${method}`);
	}
	return await (handler as RequestHandler<RequestMethod>)(input as never, context, connection);
}

/** 从通道上取会话标识：动作本身不带 sessionId，归属的通道就是会话。 */
function requireActionSessionId(channel: Channel): string {
	const parsed = parseChannel(channel);
	if (parsed === undefined) {
		throw new RequestError("unknown_channel", `unsupported channel: ${channel}`);
	}
	return parsed.id;
}

/**
 * 回显客户端发来的动作。
 *
 * 被拒的动作不保证符合契约，能带回去的只有它原本的字段与 `type`；端点按 `type` 认
 * 是哪一类动作、按 `origin` 核销，不看其余载荷。
 */
function echoAction(action: unknown, type: string): ActionEcho {
	if (typeof action === "object" && action !== null && !Array.isArray(action)) {
		return { ...action, type };
	}
	return { type };
}

/** 回一条带拒绝原因的帧，不写进通道序号流。 */
function rejectDispatch(
	context: RpcContext,
	connection: Connection,
	channel: Channel,
	action: unknown,
	clientSeq: number,
	reason: string,
): void {
	connection.send({
		type: "action",
		channel,
		action: echoAction(action, actionTypeOf(action)),
		serverSeq: context.hub.lastSeq(channel),
		origin: { clientId: connection.clientId, clientSeq },
		rejectionReason: reason,
	} satisfies RejectedActionFrame);
}

/** 取动作的 `type`，认不出时给空串：拒绝帧要把种类带回去。 */
function actionTypeOf(action: unknown): string {
	if (typeof action === "object" && action !== null && "type" in action) {
		const type = action.type;
		return typeof type === "string" ? type : "";
	}
	return "";
}

/**
 * 每条连接一份去重窗口。
 *
 * 窗口只按连接挂：`clientId` 是连接建立时分配的，连接关闭就没人再用这个标识，挂在
 * `WeakMap` 上随连接一起回收，不需要额外的清理路径。
 */
const dispatchLogs = new WeakMap<Connection, DispatchLog>();

function dispatchLogFor(connection: Connection): DispatchLog {
	const existing = dispatchLogs.get(connection);
	if (existing !== undefined) {
		return existing;
	}
	const created = new DispatchLog();
	dispatchLogs.set(connection, created);
	return created;
}

/** 给发起方补一条消费回执：动作已经进了会话，只差告诉它「收到」。 */
function sendInputHandled(
	context: RpcContext,
	connection: Connection,
	channel: Channel,
	clientSeq: number,
): void {
	const parsed = parseChannel(channel);
	if (parsed === undefined) {
		return;
	}
	const chatChannel = makeChannel("chat", parsed.id);
	connection.send({
		type: "action",
		channel: chatChannel,
		action: { type: "chat/inputHandled" },
		serverSeq: context.hub.lastSeq(chatChannel),
		origin: { clientId: connection.clientId, clientSeq },
	} satisfies ActionFrame);
}

/**
 * 处理一条客户端派发的动作。
 *
 * 契约表里没有的 `type` 一律按「主机内部事件」拒绝：客户端不能伪造 `sessions/*`、
 * `chat/delta` 这类只由主机产生的动作。整条动作过了契约才进处理器。
 */
export async function handleDispatch(
	context: RpcContext,
	connection: Connection,
	raw: { channel?: unknown; action?: unknown; clientSeq?: unknown },
): Promise<void> {
	if (typeof raw.channel !== "string") {
		throw new RequestError("bad_params", "channel must be a string");
	}
	const channel = requireActionChannel(raw.channel);
	const action: unknown = raw.action;
	if (typeof action !== "object" || action === null || Array.isArray(action)) {
		throw new RequestError("bad_params", "action must be an object");
	}
	const type = (action as { type?: unknown }).type;
	if (typeof type !== "string") {
		throw new RequestError("bad_params", "action must carry a type");
	}
	// 没有序号就没有去重的键：老端点不报 clientSeq 时按原样处理，不做幂等
	const hasClientSeq = typeof raw.clientSeq === "number" && Number.isFinite(raw.clientSeq);
	const clientSeq = hasClientSeq ? (raw.clientSeq as number) : 0;
	if (connection.role === "viewer") {
		// 只读连接派发动作直接拒绝：回一条带原因的帧，不写任何东西
		const reason = "This connection is read-only";
		auditRemote(context, connection, type, reason);
		rejectDispatch(context, connection, channel, action, clientSeq, reason);
		return;
	}
	auditRemote(context, connection, type);
	// 端口会重投同一条动作：同一个 (clientId, clientSeq) 只处理一次
	const window = hasClientSeq ? dispatchLogFor(connection) : undefined;
	const known = window?.peek(clientSeq);
	if (known !== undefined) {
		if (known.state === "inflight") {
			// 首条还没出结果，重复帧直接丢弃，等首条回应
			return;
		}
		if (known.state === "rejected") {
			rejectDispatch(context, connection, channel, action, clientSeq, known.reason);
			return;
		}
		// 处理过且成功：不再触发处理器，只把当初那条消费回执补发一次
		if (known.handled) {
			sendInputHandled(context, connection, channel, clientSeq);
		}
		return;
	}
	const contract: DispatchContract | undefined = DISPATCH_CONTRACTS[type];
	if (contract === undefined) {
		const reason = `action is produced by the host: ${type}`;
		window?.settle(clientSeq, { state: "rejected", reason });
		rejectDispatch(context, connection, channel, action, clientSeq, reason);
		return;
	}
	if (!contract.check(action)) {
		const reason = `bad_params: action does not match ${type}`;
		window?.settle(clientSeq, { state: "rejected", reason });
		rejectDispatch(context, connection, channel, action, clientSeq, reason);
		return;
	}
	const handler = chatHandlers[type as keyof DispatchHandlerMap];
	// 受理后立即返回：动作的执行结果由通道上的动作反映，拒绝才回一个带原因的帧。
	// 不等待执行完成，否则同一端连续发出的动作会被前一条阻塞。
	const call = { context, connection, channel, sessionId: requireActionSessionId(channel) };
	window?.begin(clientSeq);
	void Promise.resolve()
		.then(() => handler(action as never, call))
		.then((result) => {
			const handled = result === "handled";
			window?.settle(clientSeq, { state: "accepted", handled });
			if (handled) {
				sendInputHandled(context, connection, channel, clientSeq);
			}
		})
		.catch((error: unknown) => {
			const reason = toProtocolError(error).message;
			window?.settle(clientSeq, { state: "rejected", reason });
			rejectDispatch(context, connection, channel, action, clientSeq, reason);
		});
}

/**
 * 认证帧里声明的档位换算成实际授予的档位。
 *
 * 不声明就是管理档（本机连接）；声明操作档时按主机配置收窄，配置为只读时一律给只读。
 */
export function grantedRole(context: RpcContext, requested: unknown, fallback: ClientRole): ClientRole {
	if (requested === undefined) {
		return fallback;
	}
	if (requested === "operator") {
		return context.config.remotePermission === "operate" ? "operator" : "viewer";
	}
	return "viewer";
}

/** 令牌是否与主机配置一致。主机没设令牌时放行，只用于本机调试环境。 */
export function matchesToken(context: RpcContext, token: string): boolean {
	const expected = context.config.token;
	if (expected === undefined || expected.length === 0) {
		return true;
	}
	return token === expected;
}
