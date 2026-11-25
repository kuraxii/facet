/**
 * 终端探测的用例。
 *
 * 探测是纯函数：平台、环境变量与「这个路径在不在」都由用例给，所以 Windows 那套位置与顺序
 * 在任何平台上都验得到。
 */
import { describe, expect, it } from "vitest";
import {
	defaultTerminalProfile,
	detectTerminalProfiles,
	type TerminalProfile,
	terminalProfileById,
} from "./terminal-profiles.ts";

/** 一台装了这些东西的 Windows：pwsh 7、Windows PowerShell、Git Bash、WSL、cmd。 */
const WINDOWS_ENV = {
	SystemRoot: "C:\\Windows",
	ProgramFiles: "C:\\Program Files",
	LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
	PATH: "C:\\Windows\\system32",
	ComSpec: "C:\\Windows\\system32\\cmd.exe",
} as const;

/** `exists` 只认这几条路径。 */
function existsAmong(...paths: readonly string[]): (path: string) => boolean {
	const set = new Set(paths);
	return (path) => set.has(path);
}

const PWSH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const WSL = "C:\\Windows\\System32\\wsl.exe";
const CMD = "C:\\Windows\\system32\\cmd.exe";

/** 取探测结果的标识顺序，断言顺序时用。 */
function ids(profiles: readonly TerminalProfile[]): string[] {
	return profiles.map((profile) => profile.id);
}

describe("Windows 上的终端探测", () => {
	it("按 pwsh → PowerShell → Git Bash → WSL → cmd 的顺序给出装了的那些", () => {
		const profiles = detectTerminalProfiles({
			platform: "win32",
			env: WINDOWS_ENV,
			exists: existsAmong(PWSH, POWERSHELL, GIT_BASH, WSL, CMD),
		});
		expect(ids(profiles)).toEqual(["pwsh", "powershell", "git-bash", "wsl", "cmd"]);
	});

	it("没装 pwsh 就从 Windows PowerShell 起", () => {
		const profiles = detectTerminalProfiles({
			platform: "win32",
			env: WINDOWS_ENV,
			exists: existsAmong(POWERSHELL, GIT_BASH, CMD),
		});
		expect(ids(profiles)).toEqual(["powershell", "git-bash", "cmd"]);
		expect(
			defaultTerminalProfile({
				platform: "win32",
				env: WINDOWS_ENV,
				exists: existsAmong(POWERSHELL, GIT_BASH, CMD),
			}).path,
		).toBe(POWERSHELL);
	});

	it("每个 shell 带自己的启动参数", () => {
		const profiles = detectTerminalProfiles({
			platform: "win32",
			env: WINDOWS_ENV,
			exists: existsAmong(PWSH, POWERSHELL, GIT_BASH, WSL, CMD),
		});
		const args = new Map(profiles.map((profile) => [profile.id, profile.args]));
		// PowerShell 默认会打一段版权横幅，那不是用户要看的内容
		expect(args.get("pwsh")).toEqual(["-NoLogo"]);
		expect(args.get("powershell")).toEqual(["-NoLogo"]);
		// Git Bash 只有带 `--login -i` 才有正常的登录环境
		expect(args.get("git-bash")).toEqual(["--login", "-i"]);
		expect(args.get("wsl")).toEqual([]);
		expect(args.get("cmd")).toEqual([]);
	});

	it("pwsh 也认 PATH 里的那一个", () => {
		const onPath = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";
		const profiles = detectTerminalProfiles({
			platform: "win32",
			env: { ...WINDOWS_ENV, PATH: "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps" },
			exists: existsAmong(onPath),
		});
		expect(profiles[0]?.path).toBe(onPath);
	});

	it("一个都探不到时退回 cmd.exe，让失败落在执行错误上", () => {
		const profile = defaultTerminalProfile({ platform: "win32", env: {}, exists: () => false });
		expect(profile.path).toBe("cmd.exe");
	});

	it("按标识取回那一条，认不出来时给 undefined", () => {
		const options = {
			platform: "win32" as const,
			env: WINDOWS_ENV,
			exists: existsAmong(GIT_BASH, CMD),
		};
		expect(terminalProfileById(options, "git-bash")?.path).toBe(GIT_BASH);
		expect(terminalProfileById(options, "pwsh")).toBeUndefined();
	});
});

describe("POSIX 上的终端探测", () => {
	it("用 $SHELL，标签取文件名", () => {
		const profiles = detectTerminalProfiles({
			platform: "linux",
			env: { SHELL: "/usr/bin/zsh" },
			exists: () => false,
		});
		expect(profiles).toEqual([{ id: "default", label: "zsh", path: "/usr/bin/zsh", args: [] }]);
	});

	it("没有 $SHELL 时退回 /bin/sh", () => {
		const profile = defaultTerminalProfile({ platform: "darwin", env: {}, exists: () => false });
		expect(profile).toEqual({ id: "default", label: "sh", path: "/bin/sh", args: [] });
	});
});
