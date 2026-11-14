/**
 * 主机侧入口。
 *
 * 装配共享的运行时、会话登记与端点监听，供嵌入方（桌面主进程）与独立进程共用。
 */
import { join } from "node:path";
import { PiAgentFactory } from "@facet/agent";
import { sessionsChannelFor } from "@facet/protocol";
import { loadServerConfig, type ServerConfig } from "./config.ts";
import { type EndpointHandle, startEndpoint } from "./endpoint.ts";
import { type HostIdentity, loadOrCreateHostId } from "./host-identity.ts";
import { debugLog, setDebugLog } from "./log.ts";
import { ProjectCatalog } from "./project-catalog.ts";
import { ProjectStore } from "./project-store.ts";
import { ChildPtyBackend } from "./pty-host.ts";
import { SessionHub } from "./session-hub.ts";
import { SessionIndex } from "./session-index.ts";
import { SessionsChannel } from "./sessions-channel.ts";
import { SettingsStore } from "./settings-store.ts";
import { TerminalService } from "./terminals.ts";

/** 主机启动后的句柄。port 为实际监听端口，hostId 是本进程的主机标识。 */
export interface ServerHandle extends EndpointHandle {
	readonly hostId: string;
	/** 主机身份，含标识、来源与首次生成时间 */
	readonly hostIdentity: HostIdentity;
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
	/** 会话清单通道，所有端订阅同一条 */
	readonly sessions: SessionsChannel;
	/** 终端登记与终端通道 */
	readonly terminals: TerminalService;
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
	const hostIdentity = await loadOrCreateHostId({ dataDir: config.dataDir });
	const hostId = hostIdentity.id;
	const sessions = new SessionsChannel(config.replayLimit);
	let sessionIndex: SessionIndex | undefined;
	const hub = new SessionHub({
		factory,
		replayLimit: config.replayLimit,
		idleCloseMs: config.sessionIdleMs,
		onSessionChanged: (file, change) => sessionIndex?.note(file, change),
	});
	// 索引要读会话目录与运行状态，两样都在 hub 建好之后才齐
	sessionIndex = new SessionIndex({
		channel: sessions,
		uri: sessionsChannelFor(hostId),
		source: {
			listSessions: (cwd) => factory.listSessions(cwd),
			peekSessionCwd: (file) => factory.peekSessionCwd(file),
			busyFiles: () => hub.busyFiles(),
		},
	});
	const projects = new ProjectCatalog(factory);
	await projects.refresh().catch((error: unknown) => {
		console.error("项目扫描失败", error);
	});
	const projectStore = await ProjectStore.open({ file: join(config.dataDir, "projects.json") });
	const settingsStore = await SettingsStore.open({ file: join(config.dataDir, "settings.json") });
	// 每隔一段时间按数量上限回收闲置会话：长时间开着也不该越攒越多
	const evictionTimer = setInterval(() => {
		try {
			const removed = hub.enforceLimits({ maxSessions: 8 });
			if (removed.length > 0) {
				debugLog("server", "回收闲置会话", { removed: removed.length, ...hub.stats() });
			}
		} catch (error) {
			debugLog("server", "回收闲置会话失败", { error: String(error) });
		}
	}, 60_000);
	evictionTimer.unref();

	// 终端跑在单独的 pty 子进程里，登记写进数据目录，主机重启后据此把以前开过的列成已结束
	const terminals = new TerminalService({
		backend: new ChildPtyBackend(),
		file: join(config.dataDir, "terminals.json"),
	});
	await terminals.load().catch((error: unknown) => {
		console.error("终端登记读取失败", error);
	});
	debugLog("server", "终端就绪", { unavailable: terminals.unavailable });

	const endpoint = await startEndpoint({
		config,
		factory,
		hub,
		projectStore,
		settingsStore,
		hostId,
		hostSource: hostIdentity.source,
		sessions,
		terminals,
	});
	debugLog("server", "主机端点就绪", { endpoint: `ws://${endpoint.host}:${endpoint.port}/endpoint`, hostId });

	return {
		...endpoint,
		hostId,
		hostIdentity,
		agentDir: factory.agentDir,
		hub,
		projects,
		projectStore,
		settingsStore,
		sessions,
		terminals,
		close: async () => {
			clearInterval(evictionTimer);
			sessionIndex?.stop();
			await endpoint.close();
			terminals.dispose();
			hub.dispose();
			factory.dispose();
		},
	};
}

export type { ChannelAction } from "./action-projector.ts";
export { ActionProjector } from "./action-projector.ts";
export type { AuditEntry } from "./audit.ts";
export { AuditLog } from "./audit.ts";
export type { ServerConfig } from "./config.ts";
export { defaultSocketPath, generateToken, loadServerConfig } from "./config.ts";
export type { DiscoveryEndpoint, DiscoveryRecord } from "./discovery.ts";
export {
	DISCOVERY_SCHEMA_VERSION,
	describeDiscovery,
	discoveryFile,
	parseDiscovery,
	writeDiscovery,
} from "./discovery.ts";
export type { EndpointHandle } from "./endpoint.ts";
export { EventLog } from "./event-log.ts";
export type { HostIdentity, HostSource } from "./host-identity.ts";
export { loadOrCreateHostId } from "./host-identity.ts";
export { debugLog, isDebugLogEnabled, setDebugLog } from "./log.ts";
export type { ProjectSource } from "./project-catalog.ts";
export { ProjectCatalog } from "./project-catalog.ts";
export type { ProjectStoreOptions, StoredProject } from "./project-store.ts";
export { ProjectExistsError, ProjectNotFoundError, ProjectStore } from "./project-store.ts";
export type { PtyBackend, PtyHandle, PtySink, PtySpawnOptions } from "./pty-host.ts";
export { ChildPtyBackend, DisabledPtyBackend } from "./pty-host.ts";
export type { ActionSink, HubAgent, Subscription } from "./session-hub.ts";
export {
	ChannelNotFoundError,
	SessionBoundaryNotFoundError,
	SessionHub,
	SessionNotFoundError,
} from "./session-hub.ts";
export type { SessionChange, SessionIndexSource } from "./session-index.ts";
export { SessionIndex } from "./session-index.ts";
export { SessionsChannel } from "./sessions-channel.ts";
export type { CreateTerminalOptions, TerminalSink, TerminalSnapshot } from "./terminals.ts";
export { TerminalService } from "./terminals.ts";
