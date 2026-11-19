/**
 * 当前工作区在用的那台主机。
 *
 * 工作区里的组件直接取 `client` / `terminalClient` 来发请求的地方不算少，靠 props 一层层
 * 带下去每个都用得着的对象不现实；这里按「当前挂载的是哪台主机」给一份运行时，组件从
 * context 取，切主机时整棵子树连带换掉。
 */
import type { SessionClient, TerminalClient } from "@facet/client-core";
import { createContext, type ReactNode, useContext } from "react";
import type { HostRuntime } from "./host-runtime.ts";

const HostRuntimeContext = createContext<HostRuntime | undefined>(undefined);

/** 给一棵子树指定它属于哪台主机。 */
export function HostRuntimeProvider({
	runtime,
	children,
}: {
	runtime: HostRuntime;
	children: ReactNode;
}): ReactNode {
	return <HostRuntimeContext.Provider value={runtime}>{children}</HostRuntimeContext.Provider>;
}

/** 当前主机的运行时；不在工作区里取用是错误。 */
export function useHostRuntime(): HostRuntime {
	const runtime = useContext(HostRuntimeContext);
	if (runtime === undefined) {
		throw new Error("useHostRuntime must be used inside HostRuntimeProvider");
	}
	return runtime;
}

/** 当前主机的会话客户端。 */
export function useHostClient(): SessionClient {
	return useHostRuntime().client;
}

/** 当前主机的终端客户端。 */
export function useHostTerminalClient(): TerminalClient {
	return useHostRuntime().terminalClient;
}
