/**
 * 分开启动主机与桌面。
 *
 * 先把主机单独跑起来（改主机代码只重启它，桌面界面不受影响），等端点可用之后再启动桌面并
 * 指向那个端点。两边输出各加前缀，Ctrl+C 一起结束。
 */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录 */
const root = fileURLToPath(new URL("..", import.meta.url));

/** 主机端口，可用 FACET_PORT 覆盖 */
const port = process.env.FACET_PORT?.trim() || "4319";
const endpoint = `ws://127.0.0.1:${port}/endpoint`;
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

/** 起一个子进程并把输出加上前缀转出来。 */
function run(label, args, env) {
	const child = spawn("npm", args, {
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

/** 轮询端点，主机起来之前桌面就连会一直失败。 */
async function waitForHost() {
	// 主机监听的是按帧收发的字节流，不能用 HTTP 探活；就绪的凭据是它写下的发现文件
	const discovery = join(devDataDir(process.env), "endpoint.json");
	const deadline = Date.now() + READY_WAIT_MS;
	while (Date.now() < deadline) {
		try {
			const record = JSON.parse(await readFile(discovery, "utf8"));
			if (record?.endpoint !== undefined) {
				return true;
			}
		} catch {
			// 还没写出来，继续等
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

run("host", ["run", "dev", "-w", "@facet/server"], { FACET_PORT: port, FACET_DATA_DIR: devDataDir(process.env) });
console.log(`[split] 等主机就绪 ${endpoint}`);
if (!(await waitForHost())) {
	console.log(`[split] 主机 ${READY_WAIT_MS} 毫秒内没响应，仍然启动桌面`);
}
run("desktop", ["run", "dev", "-w", "@facet/desktop"], { FACET_ENDPOINT: endpoint });
