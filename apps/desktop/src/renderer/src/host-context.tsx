/**
 * 双层主机上下文：
 *
 * 1. `HostRegistryContext`（全局）：持有全部主机的运行时注册表、主机列表与后台连断动作，
 *    不随当前查看的会话切换。
 * 2. `HostRuntimeContext`（目标作用域）：绑定当前活跃会话（或新建面板选定）所属的那台
 *    `HostRuntime`，供对话、文件、Git 与终端消费者直接读取。
 */
import type { SessionClient, TerminalClient } from "@facet/client-core";
import { createContext, type ReactNode, useContext } from "react";
import type { Hosts } from "./hooks/useHosts.ts";
import type { HostRuntime } from "./host-runtime.ts";

const HostRegistryContext = createContext<Hosts | undefined>(undefined);
const HostRuntimeContext = createContext<HostRuntime | undefined>(undefined);

/** 全局主机连接管理上下文。 */
export function HostRegistryProvider({ hosts, children }: { hosts: Hosts; children: ReactNode }): ReactNode {
	return <HostRegistryContext.Provider value={hosts}>{children}</HostRegistryContext.Provider>;
}

/** 读取全局主机连接管理域。 */
export function useHostRegistry(): Hosts {
	const hosts = useContext(HostRegistryContext);
	if (hosts === undefined) {
		throw new Error("useHostRegistry must be used inside HostRegistryProvider");
	}
	return hosts;
}

/** 给目标作用域指定它当前面向哪台主机。 */
export function HostRuntimeProvider({
	runtime,
	children,
}: {
	runtime: HostRuntime;
	children: ReactNode;
}): ReactNode {
	return <HostRuntimeContext.Provider value={runtime}>{children}</HostRuntimeContext.Provider>;
}

/** 当前目标主机的运行时；不在工作区里取用是错误。 */
export function useHostRuntime(): HostRuntime {
	const runtime = useContext(HostRuntimeContext);
	if (runtime === undefined) {
		throw new Error("useHostRuntime must be used inside HostRuntimeProvider");
	}
	return runtime;
}

/** 当前目标主机的会话客户端。 */
export function useHostClient(): SessionClient {
	return useHostRuntime().client;
}

/** 当前目标主机的终端客户端。 */
export function useHostTerminalClient(): TerminalClient {
	return useHostRuntime().terminalClient;
}
