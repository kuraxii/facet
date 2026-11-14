/**
 * 只启动 server。
 *
 * 先打一份 server 产物（`apps/desktop/dist-server`），再用它自带的 Node 跑起来，与打包后的
 * 启动方式一致；原生模块因此只需要针对 Node ABI 构建一次。
 */

import { execFileSync, spawn } from "node:child_process";
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

console.log(`[server] 数据目录 ${devDataDir(process.env)}`);

// 每次启动都重新打一遍：esbuild 只要一两百毫秒，换来「跑的就是打包后的东西」
execFileSync("node", [join(root, "scripts", "build-server.mjs")], { cwd: root, stdio: "inherit" });

const artifact = join(root, "apps", "desktop", "dist-server");
const child = spawn(join(artifact, "bin", "node"), [join(artifact, "lib", "server.mjs")], {
	cwd: root,
	stdio: "inherit",
	env: { ...process.env, FACET_DATA_DIR: devDataDir(process.env) },
});

const shutdown = () => child.kill("SIGTERM");
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => process.exit(code ?? 0));
