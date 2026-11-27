/**
 * 代理后端与 ACP 注册表请求处理器。
 *
 * 参数形状已由生成物校验，这里处理读写注册表与后端可用性探测。
 */
import { normalizeAcpProfile } from "@facet/agent";
import { PI_BACKEND_ID, type RequestResults } from "@facet/protocol";
import { RequestError, type RpcContext } from "../context.ts";
import type { RequestHandlerMap } from "../gateway.ts";

/** 后端配置域负责的方法。 */
type BackendMethod = "listBackends" | "saveAcpBackend" | "removeAcpBackend" | "probeBackend";

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

	saveAcpBackend: async (params, context: RpcContext): Promise<RequestResults["saveAcpBackend"]> => {
		const acpRuntime = requireAcpRuntime(context);
		const builtInIds = new Set(
			acpRuntime.registry
				.listProfiles()
				.filter((p) => p.builtIn)
				.map((p) => p.id),
		);
		const normalized = normalizeAcpProfile(params.profile, builtInIds);
		if (normalized === undefined) {
			throw new RequestError("bad_params", `Invalid ACP backend profile: ${params.profile.id}`);
		}
		try {
			const profiles = await acpRuntime.registry.saveProfile(normalized);
			return {
				backends: acpRuntime.registry.listAvailability(),
				profiles,
			};
		} catch (error) {
			throw new RequestError("bad_params", error instanceof Error ? error.message : String(error));
		}
	},

	removeAcpBackend: async (params, context: RpcContext): Promise<RequestResults["removeAcpBackend"]> => {
		const acpRuntime = requireAcpRuntime(context);
		try {
			const profiles = await acpRuntime.registry.removeProfile(params.backendId);
			return {
				backends: acpRuntime.registry.listAvailability(),
				profiles,
			};
		} catch (error) {
			throw new RequestError("rejected", error instanceof Error ? error.message : String(error));
		}
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
};
