/**
 * 外部 ACP 子进程的跨平台启动与进程树清理辅助模块。
 *
 * 解决 Windows 下 `.cmd` / `.bat` 包装脚本无法直接 `spawn`（`ENOENT` / `EINVAL`）、
 * Electron 宿主环境变量污染以及子进程树残留问题。
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { extname } from "node:path";

/** Windows `cmd.exe` 需要转义的元字符集合。 */
const WINDOWS_SHELL_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/** 不应透传给独立外部 ACP 子进程的宿主环境变量。 */
const STRIPPED_CHILD_ENV_KEYS = ["ELECTRON_RUN_AS_NODE", "CHROME_CRASHPAD_PIPE_NAME"] as const;

/** 规范化后的 `spawn` 调用参数。 */
export interface AcpSpawnSpec {
	/** 实际传给 `spawn` 的命令（Windows `.cmd`/`.bat` 时为整行转义命令） */
	readonly command: string;
	/** 传给 `spawn` 的参数列表 */
	readonly args: string[];
	/** 是否需要通过系统 shell 执行 */
	readonly shell: boolean;
}

/** 启动 ACP 子进程的选项。 */
export interface SpawnAcpProcessOptions {
	/** 原始命令名或绝对路径 */
	readonly command: string;
	/** 命令行参数 */
	readonly args: readonly string[];
	/** 工作目录（可选） */
	readonly cwd?: string;
	/** 配置附加环境变量 */
	readonly profileEnv?: Readonly<Record<string, string>>;
	/** 宿主基础环境变量（默认 `process.env`） */
	readonly baseEnv?: NodeJS.ProcessEnv;
	/** 后端可选环境变量预处理 */
	readonly prepareEnv?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
	/** 命令解析函数（由注册表提供，避免循环依赖） */
	readonly resolveCommand: (command: string) => string | undefined;
	/** 收到 stderr 单行时的回调 */
	readonly onStderrLine?: (line: string) => void;
	/** 子进程触发 `error` 事件时的回调 */
	readonly onSpawnError?: (error: Error) => void;
}

/**
 * 为 Windows `cmd.exe` 转义单个命令行参数。
 *
 * 同时满足 `cmd.exe` 元字符解析与目标进程 `CommandLineToArgvW` 规则。
 */
export function escapeWindowsShellArg(arg: string): string {
	let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
	escaped = escaped.replace(/(\\*)$/, "$1$1");
	escaped = `"${escaped}"`;
	return escaped.replace(WINDOWS_SHELL_META_CHARS, "^$1");
}

/**
 * 构造跨平台安全的 `spawn` 调用规格。
 *
 * 在 Windows 上先用解析出的真实路径判断扩展名：`.cmd` / `.bat` 拼成单行转义命令并启用
 * `shell: true`（避免 Node `spawn` 报 `EINVAL` 与 DEP0190），其余直接 `shell: false`。
 */
export function buildAcpSpawnSpec(
	command: string,
	args: readonly string[],
	resolveCommand: (command: string) => string | undefined,
	platform: NodeJS.Platform = process.platform,
): AcpSpawnSpec {
	const resolvedCommand = resolveCommand(command) ?? command;
	if (platform !== "win32") {
		return { command: resolvedCommand, args: [...args], shell: false };
	}
	const extension = extname(resolvedCommand).toLowerCase();
	if (extension !== ".cmd" && extension !== ".bat") {
		return { command: resolvedCommand, args: [...args], shell: false };
	}
	return {
		command: [resolvedCommand, ...args].map(escapeWindowsShellArg).join(" "),
		args: [],
		shell: true,
	};
}

/** 构造传给 ACP 子进程的环境变量，剥离会干扰独立 CLI 的 Electron 宿主变量。 */
export function buildAcpChildEnv(
	profileEnv?: Readonly<Record<string, string>>,
	baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = profileEnv ? { ...baseEnv, ...profileEnv } : { ...baseEnv };
	for (const key of STRIPPED_CHILD_ENV_KEYS) {
		delete env[key];
	}
	return env;
}

/** 启动外部 ACP 子进程并挂好 stdio、stderr 缓冲与错误保护。 */
export function spawnAcpProcess(options: SpawnAcpProcessOptions): ChildProcessWithoutNullStreams {
	const mergedEnv = buildAcpChildEnv(options.profileEnv, options.baseEnv);
	const env = options.prepareEnv ? options.prepareEnv(mergedEnv) : mergedEnv;
	const spec = buildAcpSpawnSpec(options.command, options.args, options.resolveCommand);
	const child = spawn(spec.command, spec.args, {
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		env,
		stdio: ["pipe", "pipe", "pipe"],
		shell: spec.shell,
		windowsHide: true,
	});
	child.stdin.on("error", () => undefined);
	child.on("error", (error) => {
		options.onSpawnError?.(error);
	});
	if (options.onStderrLine !== undefined) {
		const emitLine = options.onStderrLine;
		child.stderr.on("data", (chunk: Buffer | string) => {
			for (const line of String(chunk).split(/\r?\n/)) {
				const trimmed = line.trim();
				if (trimmed.length > 0) {
					emitLine(trimmed);
				}
			}
		});
	}
	return child;
}

/** 终止 ACP 子进程；Windows 上同步清理进程树以防 `.cmd` 包装器留下孤儿进程。 */
export function terminateAcpProcess(
	child: ChildProcessWithoutNullStreams | undefined,
	graceMs: number,
	platform: NodeJS.Platform = process.platform,
): void {
	if (child === undefined || child.exitCode !== null || child.killed) {
		return;
	}
	if (platform === "win32" && child.pid !== undefined) {
		try {
			const killer = spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
				stdio: "ignore",
				windowsHide: true,
			});
			killer.on("error", () => {
				try {
					child.kill();
				} catch {
					// 忽略已退出的子进程
				}
			});
			return;
		} catch {
			// 回退到常规 kill
		}
	}
	child.kill("SIGTERM");
	const timer = setTimeout(() => {
		if (child.exitCode === null && !child.killed) {
			child.kill("SIGKILL");
		}
	}, graceMs);
	timer.unref?.();
}
