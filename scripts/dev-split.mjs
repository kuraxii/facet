/**
 * 分开启动 server 与桌面。
 *
 * 先打一份 server 产物，再用它自带的 Node 跑起来；等 socket 建出来之后启动桌面，桌面按固定
 * 路径自己连过去。两边输出各加前缀，Ctrl+C 一起结束。
 */

import { execFileSync, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录 */
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

/** 等主机端点响应，最长等 30 秒 */
const READY_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

const children = [];

/** 主机的数据目录：开发实例带 -dev 后缀 */

/** 起一个子进程并把输出加上前缀转出来。args 第一项以路径分隔符开头时按命令直接跑。 */
function run(label, args, env) {
	const direct = args[0]?.includes("/") === true;
	const child = spawn(direct ? args[0] : "npm", direct ? args.slice(1) : args, {
		cwd: root,
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	const forward = (stream) => {
		stream.setEncoding("utf8");
		let buffer = "";
		stream.on("data", (chunk) => {
			buffer += chunk;
			let index = buffer.indexOf("\n");
			while (index >= 0) {
				console.log(`[${label}] ${buffer.slice(0, index)}`);
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
			}
		});
	};
	forward(child.stdout);
	forward(child.stderr);
	child.on("exit", (code) => {
		if (code !== 0 && code !== null) {
			console.log(`[${label}] 退出码 ${code}`);
		}
	});
	return child;
}

/** 轮询固定 socket，server 起来之前桌面就连会一直失败。 */
async function waitForHost() {
	// 连接位置是固定契约：优先运行目录里的 <数据目录名>.sock，没有运行目录时在数据目录下
	const runtime = process.env.XDG_RUNTIME_DIR?.trim();
	const dataDir = devDataDir(process.env);
	const socket =
		runtime !== undefined && runtime.length > 0 && isAbsolute(runtime)
			? join(runtime, `${dataDir.split("/").pop()}.sock`)
			: join(dataDir, "facet.sock");
	const deadline = Date.now() + READY_WAIT_MS;
	while (Date.now() < deadline) {
		try {
			await access(socket);
			return true;
		} catch {
			// 还没建出来，继续等
		}
		await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
	}
	return false;
}

/** 结束所有子进程。 */
function shutdown() {
	for (const child of children) {
		child.kill("SIGTERM");
	}
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 产物要与打包后完全一致，所以每次启动都重新打一遍（esbuild 一两百毫秒）
execFileSync("node", ["scripts/build-server.mjs"], { cwd: root, stdio: "inherit" });
const artifact = join(root, "apps", "desktop", "dist-server");
const server = run("server", [join(artifact, "bin", "node"), join(artifact, "lib", "server.mjs")], {
	FACET_DATA_DIR: devDataDir(process.env),
	// 桌面意外消失时 server 也自己收尾，不留孤儿进程
	FACET_PARENT_PID: String(process.pid),
});
console.log(`[split] 等 server 建出 socket`);
if (!(await waitForHost())) {
	console.log(`[split] server ${READY_WAIT_MS} 毫秒内没就绪，仍然启动桌面`);
}
const desktop = run("desktop", ["run", "dev", "-w", "@facet/desktop"], {});

/** 开发时两边绑在一起：桌面退出就把 server 一起收掉。 */
let stopping = false;
function stop(reason) {
	if (stopping) {
		return;
	}
	stopping = true;
	console.log(`[split] ${reason}，收掉 server 与桌面`);
	server.kill("SIGTERM");
	desktop.kill("SIGTERM");
	process.exit(0);
}

desktop.on("exit", (code) => stop(`桌面退出（${code ?? "未知"}）`));
server.on("exit", (code) => stop(`server 退出（${code ?? "未知"}）`));
