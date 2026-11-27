/**
 * 代理后端与 ACP 认证请求处理器。
 *
 * 参数形状已由生成物校验，这里处理后端列表、可用性探测与 ACP 登录流程。
 */
import { PI_BACKEND_ID, type RequestResults } from "@facet/protocol";
import { RequestError, type RpcContext } from "../context.ts";
import type { RequestHandlerMap } from "../gateway.ts";

/** 后端配置域负责的方法。 */
type BackendMethod = "listBackends" | "probeBackend" | "acpLoginStart" | "acpLoginSubmit" | "acpLoginCancel";

function requireAcpRuntime(context: RpcContext) {
	if (context.acpRuntime === undefined) {
		throw new RequestError("rejected", "ACP runtime is not configured on this host");
	}
	return context.acpRuntime;
}

export const backendHandlers: Pick<RequestHandlerMap, BackendMethod> = {
	listBackends: (_params, context: RpcContext): RequestResults["listBackends"] => {
		if (context.acpRuntime === undefined) {
			return {
				backends: [
					{
						id: PI_BACKEND_ID,
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
			backends: context.acpRuntime.registry.listAvailability(),
			profiles: context.acpRuntime.registry.listProfiles(),
		};
	},

	probeBackend: async (params, context: RpcContext): Promise<RequestResults["probeBackend"]> => {
		const acpRuntime = requireAcpRuntime(context);
		try {
			const backend = await acpRuntime.probeBackend(params.backendId);
			return { backend };
		} catch (error) {
			throw new RequestError("bad_params", error instanceof Error ? error.message : String(error));
		}
	},

	acpLoginStart: async (params, context: RpcContext): Promise<RequestResults["acpLoginStart"]> => {
		const acpRuntime = requireAcpRuntime(context);
		try {
			return await acpRuntime.loginStart(params.backendId);
		} catch (error) {
			throw new RequestError("bad_params", error instanceof Error ? error.message : String(error));
		}
	},

	acpLoginSubmit: async (params, context: RpcContext): Promise<RequestResults["acpLoginSubmit"]> => {
		const acpRuntime = requireAcpRuntime(context);
		try {
			const backend = await acpRuntime.loginSubmit(params.loginId, params.code);
			return { backend };
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
