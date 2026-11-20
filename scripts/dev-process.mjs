/**
 * 开发脚本起子进程时的平台差异。
 *
 * 两件事在 Windows 上与 unix 不同：npm 只有 `npm.cmd`，它是批处理文件，必须经 `cmd.exe`
 * 才起得来（Node 对 `.cmd` 直接 spawn 会抛 EINVAL）；server 产物里的 Node 可执行文件带
 * `.exe`。另外 Windows 上没有可用的信号，收进程树只能 `taskkill /T`。
 */

import { spawnSync } from "node:child_process";

/** 宿主是否 Windows，其余平台一律按 POSIX 处理 */
export const isWindows = process.platform === "win32";

/** server 产物里自带的 Node 可执行文件名，与 scripts/build-server.mjs 的产物布局一致 */
export const NODE_EXECUTABLE = isWindows ? "node.exe" : "node";

/** npm 的命令名，Windows 上实际被调用的是 `npm.cmd` */
const NPM_COMMAND = isWindows ? "npm.cmd" : "npm";

/**
 * 一个 npm 子命令的启动方式（`spawn` 的命令与参数）。
 *
 * Windows 的 npm 是批处理文件，Node 对 `.cmd` 直接 spawn 会抛 EINVAL，只能经 `cmd.exe`
 * 跑；整条命令放进一个引号里交给 `/c`，并让 Node 不自己转义参数（`windowsVerbatimArguments`），
 * 与 Node 内部的 `shell: true` 做法一致。参数里因此不能带引号与重定向，开发脚本用到的
 * 都是固定字面量。其余平台直接跑 npm。
 */
export function npmLaunch(args) {
	if (!isWindows) {
		return { command: NPM_COMMAND, args };
	}
	const line = [NPM_COMMAND, ...args].join(" ");
	return {
		command: process.env.ComSpec ?? "cmd.exe",
		args: ["/d", "/s", `/c "${line}"`],
		windowsVerbatimArguments: true,
	};
}

/**
 * 收掉一个子进程以及它拉起的整棵树。
 *
 * 桌面的 `npm run dev` 下面还压着 npm、electron-vite 与 electron 三层，只收直接子进程会
 * 留下孤儿窗口。Windows 上 `child.kill()` 是 TerminateProcess，既不认 SIGTERM 也带不走
 * 子进程，所以改走 `taskkill /T /F`。已经退出的进程直接跳过。
 */
export function killTree(child) {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	if (isWindows) {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		return;
	}
	child.kill("SIGTERM");
}

/**
 * 请 server 自己收尾，返回的 Promise 在它退出或超时强杀之后兑现。
 *
 * server 认标准输入里的一行 `stop`，走这条路才会删掉发现文件、关掉端点再退出；Windows 上
 * 直接 TerminateProcess 会把这些收尾全跳过，留下过期的 `endpoint.json`。等待有上限，
 * 超时就按进程树强杀，不能让开发脚本挂在收尾上。
 */
export function stopGracefully(child, waitMs) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			killTree(child);
			resolve();
		}, waitMs);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
		child.stdin?.write("stop\n");
	});
}
