/**
 * 主机上有哪些终端可用、缺省挑哪一个。
 *
 * 与 VS Code 的终端 profile 是同一套思路，只做到主机这一侧需要的那一步：在几个已知位置与
 * `PATH` 上找可执行的 shell，排出一个从「最像用户习惯」到「一定存在」的顺序，缺省取第一个。
 * 界面要选具体的 shell 时传 `createTerminal` 的 `shell` / `args`，这里只负责「有哪些」与
 * 「没指定时用哪个」。
 *
 * Windows 上没有 `SHELL` 这回事，也不是「有 bash 就行」：pwsh、Windows PowerShell、Git Bash、
 * WSL、`cmd.exe` 的启动参数各不相同（PowerShell 会打横幅、Git Bash 要 `--login -i`），
 * 一律用 `/bin/sh` 起不来的。POSIX 上沿用原来的口径：`$SHELL`，没有就退到 `/bin/sh`。
 *
 * 判断「在不在」由调用方注入：探测是纯函数，用例可以在任何平台上把 Windows 的那几个位置
 * 摆出来验。
 */

import { existsSync } from "node:fs";

/** 一个可用的终端。 */
export interface TerminalProfile {
	/** 稳定标识：界面记住选中项、协议里传它 */
	id: string;
	/** 显示名 */
	label: string;
	/** 可执行文件路径 */
	path: string;
	/** 启动参数 */
	args: string[];
}

/** 探测参数。 */
export interface DetectTerminalProfilesOptions {
	/** 目标平台 */
	platform: NodeJS.Platform;
	/** 环境变量（只读用） */
	env: Record<string, string | undefined>;
	/** 这个路径上有没有文件 */
	exists: (path: string) => boolean;
}

/** Windows 的路径分隔符；只有 win32 那几个候选会用它拼路径。 */
const WINDOWS_SEPARATOR = "\\";

/** 把环境变量里的目录拼成绝对路径，缺变量时返回 undefined。 */
function underEnvDir(
	env: Record<string, string | undefined>,
	name: string,
	...rest: readonly string[]
): string | undefined {
	const base = env[name]?.trim();
	if (base === undefined || base.length === 0) {
		return undefined;
	}
	return [base.replace(/[\\/]+$/, ""), ...rest].join(WINDOWS_SEPARATOR);
}

/** `PATH` 里每一个目录下的这个可执行文件。 */
function onPath(env: Record<string, string | undefined>, file: string): string[] {
	const path = env.PATH ?? env.Path ?? "";
	return path
		.split(";")
		.map((dir) => dir.trim().replace(/^"|"$/g, ""))
		.filter((dir) => dir.length > 0)
		.map((dir) => `${dir.replace(/[\\/]+$/, "")}${WINDOWS_SEPARATOR}${file}`);
}

/** 探测用的候选：标识、显示名、参数，加一串按优先级排好的路径。 */
interface WindowsCandidate {
	/** 稳定标识 */
	id: string;
	/** 显示名 */
	label: string;
	/** 启动参数 */
	args: readonly string[];
	/** 可能的安装位置，按优先级 */
	paths: readonly (string | undefined)[];
}

/**
 * Windows 上的探测顺序。
 *
 * 与 VS Code 一致：pwsh（PowerShell 7）→ Windows PowerShell → Git Bash → WSL → `cmd.exe`。
 * 前两个都给 `-NoLogo`：PowerShell 默认会先打一段版权横幅，那不是用户要看的内容。Git Bash
 * 用 `--login -i` 才有正常的登录环境（`/etc/profile` 里的 PATH）。`cmd.exe` 落在最后：它是
 * 唯一一定存在的，但也是 power user 最不想要的那个。
 */
function windowsCandidates(env: Record<string, string | undefined>): WindowsCandidate[] {
	return [
		{
			id: "pwsh",
			label: "PowerShell 7",
			args: ["-NoLogo"],
			paths: [
				...onPath(env, "pwsh.exe"),
				underEnvDir(env, "ProgramFiles", "PowerShell", "7", "pwsh.exe"),
				underEnvDir(env, "ProgramFiles", "PowerShell", "6", "pwsh.exe"),
				underEnvDir(env, "LOCALAPPDATA", "Microsoft", "WindowsApps", "pwsh.exe"),
			],
		},
		{
			id: "powershell",
			label: "Windows PowerShell",
			args: ["-NoLogo"],
			paths: [
				underEnvDir(env, "SystemRoot", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
				underEnvDir(env, "windir", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			],
		},
		{
			id: "git-bash",
			label: "Git Bash",
			args: ["--login", "-i"],
			paths: [
				underEnvDir(env, "ProgramFiles", "Git", "bin", "bash.exe"),
				underEnvDir(env, "ProgramW6432", "Git", "bin", "bash.exe"),
				underEnvDir(env, "ProgramFiles(x86)", "Git", "bin", "bash.exe"),
				underEnvDir(env, "LOCALAPPDATA", "Programs", "Git", "bin", "bash.exe"),
			],
		},
		{
			id: "wsl",
			label: "WSL",
			args: [],
			paths: [
				underEnvDir(env, "SystemRoot", "System32", "wsl.exe"),
				underEnvDir(env, "windir", "System32", "wsl.exe"),
			],
		},
		{
			id: "cmd",
			label: "Command Prompt",
			args: [],
			paths: [
				env.ComSpec?.trim(),
				underEnvDir(env, "SystemRoot", "System32", "cmd.exe"),
				underEnvDir(env, "windir", "System32", "cmd.exe"),
			],
		},
	];
}

/**
 * 探测可用的终端，按从「更可能是用户想要的」到「一定存在」的顺序。
 *
 * 返回空数组只会在一个 shell 都找不到时出现（例如被人为裁剪过的容器），此时调用方该怎么
 * 报错由它自己决定。
 */
export function detectTerminalProfiles(options: DetectTerminalProfilesOptions): TerminalProfile[] {
	if (options.platform !== "win32") {
		const shell = options.env.SHELL?.trim() || "/bin/sh";
		return [{ id: "default", label: shell.split("/").at(-1) ?? shell, path: shell, args: [] }];
	}
	const profiles: TerminalProfile[] = [];
	for (const candidate of windowsCandidates(options.env)) {
		const found = candidate.paths.find(
			(path) => path !== undefined && path.length > 0 && options.exists(path),
		);
		if (found !== undefined) {
			profiles.push({ id: candidate.id, label: candidate.label, path: found, args: [...candidate.args] });
		}
	}
	return profiles;
}

/**
 * 没指定 shell 时用哪一个：探测顺序里的第一个。
 *
 * 一个都探不到时仍给出各平台最后的手段（`cmd.exe` / `/bin/sh`），让失败落在真正的执行错误
 * 上，而不是「没有可用终端」这种无从下手的话。
 */
export function defaultTerminalProfile(options: DetectTerminalProfilesOptions): TerminalProfile {
	return (
		detectTerminalProfiles(options)[0] ?? {
			id: "fallback",
			label: options.platform === "win32" ? "Command Prompt" : "sh",
			path: options.platform === "win32" ? "cmd.exe" : "/bin/sh",
			args: [],
		}
	);
}

/**
 * 本机此刻可用的终端。
 *
 * 唯一一处不纯的地方：把 `process` 上的东西交给上面那些纯函数。主机侧的处理器与 pty 子进程
 * 都走它，两边算出来的清单因此不会不一样。
 */
export function hostTerminalProfiles(): TerminalProfile[] {
	return detectTerminalProfiles({ platform: process.platform, env: process.env, exists: existsSync });
}

/**
 * 从一份清单里挑出标识对应的那一个。
 *
 * 空标识与认不出来的标识都给 `undefined`，由调用方决定回落成什么：设置里存的是别的机器上的
 * shell（换主机、卸载了 Git Bash）属于常态，回落比拒绝执行更贴近用户意图。
 */
export function pickTerminalProfile(
	profiles: readonly TerminalProfile[],
	id: string | undefined,
): TerminalProfile | undefined {
	const wanted = id?.trim();
	if (wanted === undefined || wanted.length === 0) {
		return undefined;
	}
	return profiles.find((profile) => profile.id === wanted);
}

/** 按设置里存下来的标识解析本机的终端，认不出来时用探测顺序里的第一个。 */
export function resolveHostTerminal(id: string | undefined): TerminalProfile {
	const profiles = hostTerminalProfiles();
	return (
		pickTerminalProfile(profiles, id) ??
		defaultTerminalProfile({
			platform: process.platform,
			env: process.env,
			exists: existsSync,
		})
	);
}

/** 这个标识对应的终端；标识不认识时返回 undefined。 */
export function terminalProfileById(
	options: DetectTerminalProfilesOptions,
	id: string,
): TerminalProfile | undefined {
	return detectTerminalProfiles(options).find((profile) => profile.id === id);
}
