/**
 * 独立运行入口。
 *
 * 桌面端嵌入时直接调用 startServer，不经过这里。
 */
import { startServer } from "./index.ts";

const server = await startServer();
const url = `ws://${server.host}:${server.port}/endpoint`;
console.log(`facet device ${server.hostId} listening on ${url}`);
console.log(`数据目录 ${server.agentDir}`);
console.log("按 Ctrl+C 结束");

let closing = false;
const shutdown = () => {
	if (closing) {
		return;
	}
	closing = true;
	void server.close().then(() => {
		process.exit(0);
	});
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
