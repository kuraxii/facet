/**
 * 主机侧入口。
 *
 * 装配共享的运行时、会话登记与端点监听，供嵌入方（桌面主进程）与独立进程共用。
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PiAgentFactory } from "@facet/agent";
import { loadServerConfig, type ServerConfig } from "./config.ts";
import { type EndpointHandle, startEndpoint } from "./endpoint.ts";
import { debugLog, setDebugLog } from "./log.ts";
import { ProjectCatalog } from "./project-catalog.ts";
import { ProjectStore } from "./project-store.ts";
import { SessionHub } from "./session-hub.ts";
import { SettingsStore } from "./settings-store.ts";

/** 主机启动后的句柄。port 为实际监听端口，hostId 是本进程的主机标识。 */
export interface ServerHandle extends EndpointHandle {
	readonly hostId: string;
	/** 实际生效的数据目录 */
	readonly agentDir: string;
	/** 会话登记，嵌入方可直接使用 */
	readonly hub: SessionHub;
	/** 会话目录里提取出的项目，启动时扫描一次 */
	readonly projects: ProjectCatalog;
	/** 用户添加的项目清单，持久化在数据目录里 */
	readonly projectStore: ProjectStore;
	/** 界面偏好设置，持久化在数据目录里 */
	readonly settingsStore: SettingsStore;
	/** 关闭端点并释放全部会话与运行时 */
	close(): Promise<void>;
}

/**
 * 启动主机侧服务。
 *
 * 缺省只监听回环地址、由系统分配端口，因此适合嵌入到桌面主进程；独立运行时通过
 * FACET_PORT 指定固定端口。
 */
export async function startServer(options: Partial<ServerConfig> = {}): Promise<ServerHandle> {
	const config: ServerConfig = { ...loadServerConfig(), ...options };
	setDebugLog(config.debug);
	const factory = await PiAgentFactory.create({
		agentDir: config.agentDir,
		sessionDir: config.sessionDir,
	});
	const hub = new SessionHub({
		factory,
		replayLimit: config.replayLimit,
		idleCloseMs: config.sessionIdleMs,
	});
	const projects = new ProjectCatalog(factory);
	await projects.refresh().catch((error: unknown) => {
		console.error("项目扫描失败", error);
	});
	const projectStore = await ProjectStore.open({ file: join(config.dataDir, "projects.json") });
	const settingsStore = await SettingsStore.open({ file: join(config.dataDir, "settings.json") });
	const hostId = randomUUID();
	const endpoint = await startEndpoint({ config, factory, hub, projectStore, settingsStore, hostId });
	debugLog("server", "主机端点就绪", { endpoint: `ws://${endpoint.host}:${endpoint.port}/endpoint`, hostId });

	return {
		...endpoint,
		hostId,
		agentDir: factory.agentDir,
		hub,
		projects,
		projectStore,
		settingsStore,
		close: async () => {
			await endpoint.close();
			hub.dispose();
			factory.dispose();
		},
	};
}

export type { ChannelAction } from "./action-projector.ts";
export { ActionProjector } from "./action-projector.ts";
export type { ServerConfig } from "./config.ts";
export { loadServerConfig } from "./config.ts";
export type { EndpointHandle } from "./endpoint.ts";
export { EventLog } from "./event-log.ts";
export { debugLog, isDebugLogEnabled, setDebugLog } from "./log.ts";
export type { ProjectSource } from "./project-catalog.ts";
export { ProjectCatalog } from "./project-catalog.ts";
export type { ProjectStoreOptions, StoredProject } from "./project-store.ts";
export { ProjectExistsError, ProjectNotFoundError, ProjectStore } from "./project-store.ts";
export type { ActionSink, HubAgent, Subscription } from "./session-hub.ts";
export {
	ChannelNotFoundError,
	SessionBoundaryNotFoundError,
	SessionHub,
	SessionNotFoundError,
} from "./session-hub.ts";
