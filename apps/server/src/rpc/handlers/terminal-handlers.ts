/**
 * 终端域的请求处理器。
 *
 * 参数形状已由生成物校验，这里只处理语义：启动目录必须真实存在、终端标识必须登记过。
 */
import { homedir } from "node:os";
import type { RequestParams, RequestResults } from "@facet/protocol";
import { hostTerminalProfiles, resolveHostTerminal } from "../../terminal-profiles.ts";
import type { RequestHandlerMap } from "../gateway.ts";
import { resolveTerminalCwd } from "../helpers.ts";

/** 终端域负责的方法。 */
type TerminalMethod =
	| "listTerminals"
	| "listTerminalProfiles"
	| "createTerminal"
	| "writeTerminal"
	| "resizeTerminal"
	| "killTerminal"
	| "ackTerminal"
	| "serializeTerminal";

export const terminalHandlers: Pick<RequestHandlerMap, TerminalMethod> = {
	listTerminals: (_params, context): RequestResults["listTerminals"] => ({
		terminals: context.terminals.list(),
	}),

	// 探测是本机的事：Windows 上有几套 shell、POSIX 上 $SHELL 是什么，端不需要知道
	listTerminalProfiles: (): RequestResults["listTerminalProfiles"] => ({
		profiles: hostTerminalProfiles().map((profile) => ({
			id: profile.id,
			label: profile.label,
			path: profile.path,
		})),
	}),

	createTerminal: async (
		params: RequestParams["createTerminal"],
		context,
	): Promise<RequestResults["createTerminal"]> => {
		// cwd 为空时落在主机用户的 home：界面还没有打开会话或项目时也能开终端
		const requested = params.cwd.trim();
		const cwd = await resolveTerminalCwd(requested.length > 0 ? requested : homedir());
		/*
		 * 用哪个 shell：端直接点名时听它的（那是一个具体路径）；否则按设置里选中的 profile，
		 * 设置里是「自动」或标识在本机认不出来时，回落到探测顺序里的第一个。
		 */
		const explicit = params.shell?.trim();
		const profile =
			explicit === undefined || explicit.length === 0
				? resolveHostTerminal(context.settingsStore.get().terminal.profile)
				: undefined;
		const terminal = await context.terminals.create({
			cwd,
			cols: params.cols,
			rows: params.rows,
			shell: explicit === undefined || explicit.length === 0 ? profile?.path : explicit,
			args: profile?.args,
		});
		return { terminal };
	},

	writeTerminal: (params, context): RequestResults["writeTerminal"] => {
		context.terminals.write(params.id, params.data);
		return {};
	},

	resizeTerminal: (params, context): RequestResults["resizeTerminal"] => {
		context.terminals.resize(params.id, params.cols, params.rows);
		return {};
	},

	killTerminal: (params, context): RequestResults["killTerminal"] => {
		context.terminals.kill(params.id);
		return {};
	},

	ackTerminal: (params, context): RequestResults["ackTerminal"] => {
		context.terminals.ack(params.id, params.seq);
		return {};
	},

	serializeTerminal: (params, context): RequestResults["serializeTerminal"] =>
		context.terminals.serialize(params.id),
};
