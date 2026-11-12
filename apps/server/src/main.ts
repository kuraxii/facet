/**
 * 独立运行入口。
 *
 * 桌面端以子进程方式启动它：就绪后在标准输出打印一行 `facet-host-ready` 加 JSON，父进程据此
 * 拿到端点地址；同时在数据目录写 endpoint.json 供外部工具发现。桌面端用 FACET_ENDPOINT 连
 * 外部主机时也可以手动启动它。
 */
import { rm } from "node:fs/promises";
import { loadServerConfig } from "./config.ts";
import { DISCOVERY_SCHEMA_VERSION, type DiscoveryRecord, writeDiscovery } from "./discovery.ts";
import { type ServerHandle, startServer } from "./index.ts";

/** 就绪行的标记，父进程按它从日志里挑出结构化信息。 */
export const READY_MARKER = "facet-host-ready";

/** 就绪行里的内容，与发现文件同源。 */
export type HostReadyPayload = DiscoveryRecord;

const config = loadServerConfig();

let server: ServerHandle | undefined;
let closing = false;

/** 收尾：删掉发现文件再关端点，最后退出。重复调用只生效一次。 */
const shutdown = (): void => {
	if (closing || server === undefined) {
		return;
	}
	closing = true;
	const handle = server;
	void (async () => {
		// 发现文件先删：外部工具看到它就说明主机还在，留着会连到已经关闭的端口
		await rm(`${config.dataDir}/endpoint.json`, { force: true }).catch(() => undefined);
		// 收尾给一点时间，端点关不干净也要退出，端会按断线自己重连
		await Promise.race([handle.close(), new Promise((resolve) => setTimeout(resolve, 1500))]);
		process.exit(0);
	})();
};

server = await startServer(config, { requestShutdown: shutdown });
const payload: HostReadyPayload = {
	schemaVersion: DISCOVERY_SCHEMA_VERSION,
	endpoint:
		server.socketPath === undefined
			? { transport: "tcp", url: `ws://${server.host}:${server.port}/endpoint` }
			: { transport: "unix", path: server.socketPath },
	token: config.token,
	...(server.remoteSocketPath === undefined && server.remotePort === undefined
		? {}
		: {
				remote:
					server.remoteSocketPath === undefined
						? { transport: "tcp" as const, port: server.remotePort as number }
						: { transport: "unix" as const, path: server.remoteSocketPath },
			}),
	hostId: server.hostId,
	agentDir: server.agentDir,
	pid: process.pid,
	startedAt: Date.now(),
};
await writeDiscovery(config.dataDir, payload);
console.log(`${READY_MARKER} ${JSON.stringify(payload)}`);
console.log(`数据目录 ${config.dataDir}`);
console.log(
	`连接方式 ${payload.endpoint.transport === "unix" ? payload.endpoint.path : payload.endpoint.url}`,
);
console.log("按 Ctrl+C 结束");

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Electron 以 Node 方式运行时自带信号处理，SIGTERM 不一定送到这里；由桌面端拉起时改用
// 标准输入的 stop 行结束，好让会话与发现文件都正常收尾。
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	if (chunk.trim() === "stop") {
		shutdown();
	}
});

// 由桌面端拉起时，父进程被强制结束后子进程不该继续留在后台：定期确认它还在。
const parentPid = Number(process.env.FACET_PARENT_PID ?? "");
if (Number.isInteger(parentPid) && parentPid > 0) {
	const timer = setInterval(() => {
		try {
			process.kill(parentPid, 0);
		} catch {
			shutdown();
		}
	}, 2000);
	timer.unref();
}
