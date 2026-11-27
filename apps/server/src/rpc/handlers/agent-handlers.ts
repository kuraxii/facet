/**
 * Agent 与 ACP 认证请求处理器。
 *
 * 参数形状已由生成物校验，这里处理 Agent 列表、可用性探测与 ACP 登录流程。
 */
import { PI_AGENT_ID, type RequestResults } from "@facet/protocol";
import { RequestError, type RpcContext } from "../context.ts";
import type { RequestHandlerMap } from "../gateway.ts";

/** 后端配置域负责的方法。 */
type AgentMethod = "listAgents" | "probeAgent" | "acpLoginStart" | "acpLoginSubmit" | "acpLoginCancel";

function requireAcpRuntime(context: RpcContext) {
	if (context.acpRuntime === undefined) {
		throw new RequestError("rejected", "ACP runtime is not configured on this host");
	}
	return context.acpRuntime;
}

export const agentHandlers: Pick<RequestHandlerMap, AgentMethod> = {
	listAgents: (_params, context: RpcContext): RequestResults["listAgents"] => {
		if (context.acpRuntime === undefined) {
			return {
				agents: [
					{
						id: PI_AGENT_ID,
						kind: "pi",
						name: "Pi",
						available: true,
						enabled: true,
						builtIn: true,
					},
				],
				profiles: [],
			};
		}
		return {
			agents: context.acpRuntime.registry.listAvailability(),
			profiles: context.acpRuntime.registry.listProfiles(),
		};
	},

	probeAgent: async (params, context: RpcContext): Promise<RequestResults["probeAgent"]> => {
		const acpRuntime = requireAcpRuntime(context);
		try {
			const agent = await acpRuntime.probeAgent(params.agentId);
			return { agent };
		} catch (error) {
			throw new RequestError("bad_params", error instanceof Error ? error.message : String(error));
		}
	},

	acpLoginStart: async (params, context: RpcContext): Promise<RequestResults["acpLoginStart"]> => {
		const acpRuntime = requireAcpRuntime(context);
		try {
			return await acpRuntime.loginStart(params.agentId);
		} catch (error) {
			throw new RequestError("bad_params", error instanceof Error ? error.message : String(error));
		}
	},

	acpLoginSubmit: async (params, context: RpcContext): Promise<RequestResults["acpLoginSubmit"]> => {
		const acpRuntime = requireAcpRuntime(context);
		try {
			const agent = await acpRuntime.loginSubmit(params.loginId, params.code);
			return { agent };
		} catch (error) {
			throw new RequestError("bad_params", error instanceof Error ? error.message : String(error));
		}
	},

	acpLoginCancel: (params, context: RpcContext): RequestResults["acpLoginCancel"] => {
		const acpRuntime = requireAcpRuntime(context);
		acpRuntime.loginCancel(params.loginId);
		return {};
	},
};
