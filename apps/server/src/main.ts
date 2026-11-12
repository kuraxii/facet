/**
 * 独立运行入口。
 *
 * 桌面端以子进程方式启动它：就绪后在标准输出打印一行 `facet-host-ready` 加 JSON，父进程据此
 * 拿到端点地址；同时在数据目录写 endpoint.json 供外部工具发现。桌面端用 FACET_ENDPOINT 连
 * 外部主机时也可以手动启动它。
 */
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadServerConfig } from "./config.ts";
import { startServer } from "./index.ts";

/** 就绪行的标记，父进程按它从日志里挑出结构化信息。 */
export const READY_MARKER = "facet-host-ready";

/** 写进 endpoint.json 与就绪行的内容。 */
export interface HostReadyPayload {
	/** WebSocket 端点地址 */
	endpoint: string;
	/** 主机标识 */
	hostId: string;
	/** 实际生效的 pi 数据目录 */
	agentDir: string;
	/** 进程标识，外部工具据此判断发现文件是否还有效 */
	pid: number;
}

const config = loadServerConfig();
const server = await startServer(config);
const payload: HostReadyPayload = {
	endpoint: `ws://${server.host}:${server.port}/endpoint`,
	hostId: server.hostId,
	agentDir: server.agentDir,
	pid: process.pid,
};
const discoveryFile = join(config.dataDir, "endpoint.json");
await writeFile(discoveryFile, `${JSON.stringify({ ...payload, startedAt: Date.now() }, null, 2)}\n`, "utf8");
console.log(`${READY_MARKER} ${JSON.stringify(payload)}`);
console.log(`数据目录 ${config.dataDir}`);
console.log("按 Ctrl+C 结束");

let closing = false;
const shutdown = () => {
	if (closing) {
		return;
	}
	closing = true;
	void (async () => {
		// 发现文件随进程一起走，留下的旧文件会让外部工具连到已经关闭的端口
		await rm(discoveryFile, { force: true }).catch(() => undefined);
		await server.close();
		process.exit(0);
	})();
};

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
