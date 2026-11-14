/**
 * 只启动主机。
 *
 * 主机在本机只开 unix socket（`$XDG_RUNTIME_DIR/facet-dev/host.sock`），桌面按数据目录里
 * 的发现文件连它，两边都不用填端口。
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

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

console.log(`[host] 数据目录 ${devDataDir(process.env)}`);

const child = spawn("npm", ["run", "dev", "-w", "@facet/server"], {
	cwd: root,
	stdio: "inherit",
	env: { ...process.env, FACET_DATA_DIR: devDataDir(process.env) },
});

const shutdown = () => child.kill("SIGTERM");
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => process.exit(code ?? 0));
