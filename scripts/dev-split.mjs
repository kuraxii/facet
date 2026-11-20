/**
 * 分开启动 server 与桌面。
 *
 * 先打一份 server 产物，再用它自带的 Node 跑起来；等它打出就绪行之后启动桌面，桌面按固定
 * 路径自己连过去。两边输出各加前缀，Ctrl+C 一起结束。
 */

import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { devServerEnv } from "./dev-dirs.mjs";
import { killTree, NODE_EXECUTABLE, npmLaunch, stopGracefully } from "./dev-process.mjs";

/** 仓库根目录 */
const root = fileURLToPath(new URL("..", import.meta.url));

/** 等 server 打出就绪行，最长等 30 秒 */
const READY_WAIT_MS = 30_000;

/** 退出时留给 server 自己收尾的时间，超时按进程树强杀 */
const GRACEFUL_STOP_MS = 2_000;

/**
 * server 就绪行的标记，与 `apps/server/src/main.ts` 的 `READY_MARKER` 一致。
 *
 * 打到这一行时端点已经在监听，桌面这时候连才连得上；换成在这里自己拼 socket 路径去探，
 * 就得把「unix socket 还是命名管道」那套规则抄一遍。
 */
const READY_MARKER = "facet-host-ready";

const children = [];

/**
 * 起一个子进程并把输出逐行加上前缀转出来。
 *
 * launch 是 `spawn` 的命令与参数，由调用方决定跑什么：server 用它自带的 Node 直接跑，
 * 桌面走 `npmLaunch`（Windows 上得经 cmd.exe）。onLine 拿到的是去掉行尾的整行。
 */
function run(label, launch, env, onLine) {
	const child = spawn(launch.command, launch.args, {
		cwd: root,
		env: { ...process.env, ...env },
		stdio: ["pipe", "pipe", "pipe"],
		windowsVerbatimArguments: launch.windowsVerbatimArguments === true,
	});
	children.push(child);
	const forward = (stream) => {
		stream.setEncoding("utf8");
		let buffer = "";
		const flush = (line) => {
			console.log(`[${label}] ${line}`);
			onLine?.(line);
		};
		stream.on("data", (chunk) => {
			buffer += chunk;
			let index = buffer.indexOf("\n");
			while (index >= 0) {
				// Windows 的换行是 CRLF，行尾的 \r 不进日志也不进判定
				flush(buffer.slice(0, index).replace(/\r$/, ""));
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
			}
		});
		// 进程结束时最后一行可能没有换行，别丢掉
		stream.on("end", () => {
			if (buffer.length > 0) {
				flush(buffer.replace(/\r$/, ""));
				buffer = "";
			}
		});
	};
	forward(child.stdout);
	forward(child.stderr);
	child.on("error", (error) => {
		void stop(`${label} 起不来（${error.message}）`);
	});
	child.on("exit", (code) => {
		if (code !== 0 && code !== null) {
			console.log(`[${label}] 退出码 ${code}`);
		}
	});
	return child;
}

/** 等就绪，超时返回 false。定时器 unref 掉，提前就绪时它不会把进程吊住。 */
function waitReady(ready) {
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve(false), READY_WAIT_MS);
		timer.unref();
	});
	return Promise.race([ready.then(() => true), timeout]).finally(() => clearTimeout(timer));
}

// 产物要与打包后完全一致，所以每次启动都重新打一遍（esbuild 一两百毫秒）
execFileSync(process.execPath, [join(root, "scripts", "build-server.mjs")], { cwd: root, stdio: "inherit" });
const { env, dataDir, agentDir } = devServerEnv(process.env);
console.log(`[split] 数据目录 ${dataDir}`);
console.log(`[split] pi 数据目录 ${agentDir}`);
const artifact = join(root, "apps", "desktop", "dist-server");
let markReady;
const ready = new Promise((resolve) => {
	markReady = resolve;
});
const server = run(
	"server",
	{ command: join(artifact, "bin", NODE_EXECUTABLE), args: [join(artifact, "lib", "server.mjs")] },
	{
		...env,
		// 桌面意外消失时 server 也自己收尾，不留孤儿进程
		FACET_PARENT_PID: String(process.pid),
	},
	(line) => {
		if (line.startsWith(READY_MARKER)) {
			markReady();
		}
	},
);
// 信号处理放在 server 已经起来之后：之前收到信号时还没有什么要收的，交给缺省处理就行
process.on("SIGINT", () => void stop("收到 Ctrl+C"));
process.on("SIGTERM", () => void stop("收到结束信号"));
console.log(`[split] 等 server 就绪`);
if (!(await waitReady(ready))) {
	console.log(`[split] server ${READY_WAIT_MS} 毫秒内没就绪，仍然启动桌面`);
}
// 桌面在开发态按同一个目录取值，这里显式交过去，inherit 来的 FACET_AGENT_DIR 不再参与
const desktop = run("desktop", npmLaunch(["run", "dev", "-w", "@facet/desktop"]), {
	FACET_DEV_AGENT_DIR: agentDir,
});

/**
 * 开发时两边绑在一起：一边退出就把另一边一起收掉。
 *
 * 桌面还没起出来时也要能收（server 自己起不来就是这种情况），所以按已起的子进程清单收，
 * 而不是只认桌面那一个句柄。
 */
let stopping = false;
async function stop(reason) {
	if (stopping) {
		return;
	}
	stopping = true;
	console.log(`[split] ${reason}，收掉 server 与桌面`);
	await Promise.all([
		stopGracefully(server, GRACEFUL_STOP_MS),
		...children.filter((child) => child !== server).map((child) => killTree(child)),
	]);
	process.exit(0);
}

desktop.on("exit", (code) => void stop(`桌面退出（${code ?? "未知"}）`));
server.on("exit", (code) => void stop(`server 退出（${code ?? "未知"}）`));
