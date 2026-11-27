import { describe, expect, it } from "vitest";
import { buildAcpChildEnv, buildAcpSpawnSpec, escapeWindowsShellArg } from "./acp-spawn.ts";

describe("ACP 跨平台启动辅助", () => {
	it("在 Windows 上为 .cmd/.bat 脚本启用 shell 并转义参数", () => {
		const cmdSpec = buildAcpSpawnSpec(
			"agy",
			["acp", "--dir", "C:\\Program Files\\My App"],
			() => "C:\\Users\\test\\bin\\agy.cmd",
			"win32",
		);
		expect(cmdSpec.shell).toBe(true);
		expect(cmdSpec.args).toEqual([]);
		expect(cmdSpec.command).toContain('^"C:\\Users\\test\\bin\\agy.cmd^"');
		expect(cmdSpec.command).toContain('^"acp^"');
		expect(cmdSpec.command).toContain('^"C:\\Program^ Files\\My^ App^"');

		const exeSpec = buildAcpSpawnSpec("agy", ["acp"], () => "C:\\Users\\test\\bin\\agy.exe", "win32");
		expect(exeSpec).toEqual({
			command: "C:\\Users\\test\\bin\\agy.exe",
			args: ["acp"],
			shell: false,
		});
	});

	it("在 POSIX 上保留解析结果且不启用 shell", () => {
		const spec = buildAcpSpawnSpec("agy", ["acp"], () => "/usr/local/bin/agy", "linux");
		expect(spec).toEqual({
			command: "/usr/local/bin/agy",
			args: ["acp"],
			shell: false,
		});
	});

	it("转义 Windows cmd 元字符与尾部反斜杠", () => {
		expect(escapeWindowsShellArg("a&b")).toBe('^"a^&b^"');
		expect(escapeWindowsShellArg('say "hi"\\')).toBe('^"say^ \\^"hi\\^"\\\\^"');
	});

	it("从子进程环境剥离 Electron 宿主干扰变量", () => {
		const env = buildAcpChildEnv(
			{ CUSTOM_KEY: "1" },
			{
				PATH: "C:\\bin",
				ELECTRON_RUN_AS_NODE: "1",
				CHROME_CRASHPAD_PIPE_NAME: "\\\\.\\pipe\\crashpad",
			},
		);
		expect(env.PATH).toBe("C:\\bin");
		expect(env.CUSTOM_KEY).toBe("1");
		expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
		expect(env.CHROME_CRASHPAD_PIPE_NAME).toBeUndefined();
	});
});
