/**
 * 只启动主机。
 *
 * 端口缺省固定成 4319，和 `dev:split` 用的是同一个；要换端口用 FACET_PORT 覆盖。主机自己
 * 的缺省端口是 0（系统分配），开发时每次都不一样，桌面端就不好填端点了。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = process.env.FACET_PORT?.trim() || "4319";
console.log(`[host] 端点 ws://127.0.0.1:${port}/endpoint`);

const child = spawn("npm", ["run", "dev", "-w", "@facet/server"], {
	cwd: root,
	stdio: "inherit",
	env: { ...process.env, FACET_PORT: port },
});

const shutdown = () => child.kill("SIGTERM");
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => process.exit(code ?? 0));
