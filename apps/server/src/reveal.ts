/**
 * 在系统文件管理器里打开目录。
 *
 * 主机侧执行，所以远端主机在文件管理器里打开的是它自己的目录。管理器按平台选择：
 * Linux 用 xdg-open，macOS 用 open，Windows 用 explorer。进程不等待，管理器自己退出。
 */
import { type ChildProcess, spawn } from "node:child_process";

/** 目录打不开。 */
export class RevealFailedError extends Error {
	readonly path: string;

	constructor(path: string, reason: string) {
		super(`打不开目录:${path} ${reason}`);
		this.name = "RevealFailedError";
		this.path = path;
	}
}

/** 起一个进程的最小接口，测试用替身实现。 */
export type SpawnLike = (
	command: string,
	args: string[],
	options: { detached: boolean; stdio: "ignore" },
) => Pick<ChildProcess, "once" | "unref">;

/** 各平台用来打开目录的命令。 */
export function openerFor(platform: NodeJS.Platform): string {
	if (platform === "darwin") {
		return "open";
	}
	if (platform === "win32") {
		return "explorer";
	}
	return "xdg-open";
}

/**
 * 在文件管理器里打开目录。
 *
 * 命令启动失败时抛错；启动成功即返回，管理器后面怎么退出与主机无关。
 */
export async function revealInFileManager(
	path: string,
	platform: NodeJS.Platform = process.platform,
	start: SpawnLike = spawn,
): Promise<void> {
	const command = openerFor(platform);
	await new Promise<void>((resolve, reject) => {
		const child = start(command, [path], { detached: true, stdio: "ignore" });
		child.once("error", (error: Error) => {
			reject(new RevealFailedError(path, `(${command}: ${error.message})`));
		});
		child.once("spawn", () => {
			child.unref?.();
			resolve();
		});
	});
}
