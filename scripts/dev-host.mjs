/**
 * 只启动主机。
 *
 * 端口缺省固定成 4319，和 `dev:split` 用的是同一个；要换端口用 FACET_PORT 覆盖。主机自己
 * 的缺省端口是 0（系统分配），开发时每次都不一样，桌面端就不好填端点了。
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = process.env.FACET_PORT?.trim() || "4319";
/**
 * 开发实例的数据目录：带 -dev 后缀，与装好的包分开。
 *
 * 桌面在开发模式下按同一规则取目录，两边算法不一致就接不上对方写下的 endpoint.json。
 */
function devDataDir(env) {
	const explicit = env.FACET_DATA_DIR?.trim();
	if (explicit !== undefined && explicit.length > 0) {
		return explicit;
	}
	const xdg = env.XDG_DATA_HOME?.trim();
	const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share");
	return join(base, "facet-dev");
}

console.log(`[host] 端点 ws://127.0.0.1:${port}/endpoint`);

const child = spawn("npm", ["run", "dev", "-w", "@facet/server"], {
	cwd: root,
	stdio: "inherit",
	env: { ...process.env, FACET_PORT: port, FACET_DATA_DIR: devDataDir(process.env) },
});

const shutdown = () => child.kill("SIGTERM");
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => process.exit(code ?? 0));
