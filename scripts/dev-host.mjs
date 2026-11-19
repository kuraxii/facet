/**
 * 只启动 server。
 *
 * 先打一份 server 产物（`apps/desktop/dist-server`），再用它自带的 Node 跑起来，与打包后的
 * 启动方式一致；原生模块因此只需要针对 Node ABI 构建一次。
 */

import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { devServerEnv } from "./dev-dirs.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// 两个目录都由 scripts/dev-dirs.mjs 算：桌面在开发模式下按同一规则取目录
const { env, dataDir, agentDir } = devServerEnv(process.env);
console.log(`[server] 数据目录 ${dataDir}`);
console.log(`[server] pi 数据目录 ${agentDir}`);

// 每次启动都重新打一遍：esbuild 只要一两百毫秒，换来「跑的就是打包后的东西」
execFileSync("node", [join(root, "scripts", "build-server.mjs")], { cwd: root, stdio: "inherit" });

const artifact = join(root, "apps", "desktop", "dist-server");
const child = spawn(join(artifact, "bin", "node"), [join(artifact, "lib", "server.mjs")], {
	cwd: root,
	stdio: "inherit",
	env,
});

const shutdown = () => child.kill("SIGTERM");
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => process.exit(code ?? 0));
