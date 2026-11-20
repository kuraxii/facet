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
import { killTree, NODE_EXECUTABLE, stopGracefully } from "./dev-process.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Ctrl+C 之后留给 server 自己收尾的时间，超时按进程树强杀 */
const GRACEFUL_STOP_MS = 2_000;

// 两个目录都由 scripts/dev-dirs.mjs 算：桌面在开发模式下按同一规则取目录
const { env, dataDir, agentDir } = devServerEnv(process.env);
console.log(`[server] 数据目录 ${dataDir}`);
console.log(`[server] pi 数据目录 ${agentDir}`);

// 每次启动都重新打一遍：esbuild 只要一两百毫秒，换来「跑的就是打包后的东西」
execFileSync(process.execPath, [join(root, "scripts", "build-server.mjs")], { cwd: root, stdio: "inherit" });

const artifact = join(root, "apps", "desktop", "dist-server");
const child = spawn(join(artifact, "bin", NODE_EXECUTABLE), [join(artifact, "lib", "server.mjs")], {
	cwd: root,
	// 标准输入留着：退出时往里面写一行 stop，它才会删掉发现文件再关端点
	stdio: ["pipe", "inherit", "inherit"],
	env,
});

let stopping = false;

/** 先请 server 自己收尾，等不到就强杀；重复触发只生效一次。 */
const shutdown = () => {
	if (stopping) {
		return;
	}
	stopping = true;
	void stopGracefully(child, GRACEFUL_STOP_MS).then(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => killTree(child));
child.on("exit", (code) => process.exit(code ?? 0));
