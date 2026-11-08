/**
 * 设备侧入口。
 *
 * 装配共享的运行时、会话登记与端点监听，供嵌入方（桌面主进程）与独立进程共用。
 */
import { randomUUID } from "node:crypto";
import { PiAgentRuntime } from "@facet/agent";
import { loadServerConfig, type ServerConfig } from "./config.ts";
import { type EndpointHandle, startEndpoint } from "./endpoint.ts";
import { SessionHub } from "./session-hub.ts";

/** 设备启动后的句柄。port 为实际监听端口，hostId 是本进程的设备标识。 */
export interface ServerHandle extends EndpointHandle {
	readonly hostId: string;
	/** 会话登记，嵌入方可直接使用 */
	readonly hub: SessionHub;
	/** 关闭端点并释放全部会话与运行时 */
	close(): Promise<void>;
}

/**
 * 启动设备侧服务。
 *
 * 缺省只监听回环地址、由系统分配端口，因此适合嵌入到桌面主进程；独立运行时通过
 * FACET_PORT 指定固定端口。
 */
export async function startServer(options: Partial<ServerConfig> = {}): Promise<ServerHandle> {
	const config: ServerConfig = { ...loadServerConfig(), ...options };
	const runtime = await PiAgentRuntime.create({
		agentDir: config.agentDir,
		sessionDir: config.sessionDir,
	});
	const hub = new SessionHub({ replayLimit: config.replayLimit });
	const hostId = randomUUID();
	const endpoint = await startEndpoint({ config, runtime, hub, hostId });

	return {
		...endpoint,
		hostId,
		hub,
		close: async () => {
			await endpoint.close();
			hub.dispose();
			runtime.dispose();
		},
	};
}

export { ApprovalBroker } from "./approval-broker.ts";
export type { ServerConfig } from "./config.ts";
export { loadServerConfig } from "./config.ts";
export type { EndpointHandle } from "./endpoint.ts";
export { EventLog } from "./event-log.ts";
export type { EventSink, Subscription } from "./session-hub.ts";
export { SessionHub, SessionNotFoundError } from "./session-hub.ts";
