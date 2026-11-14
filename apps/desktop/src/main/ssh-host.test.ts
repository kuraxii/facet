/**
 * SSH 连接的测试。
 *
 * 只测能离线验的部分：目标写法、ssh_config 解析、密码与私钥两条认证路径，以及用假连接
 * 跑一遍「按家目录拼固定 socket 路径 → 开通道」的流程。
 */
import type { ConnectConfig } from "ssh2";
import { describe, expect, it } from "vitest";
import {
	isSshTarget,
	matchSshConfig,
	parseSshConfig,
	parseSshTarget,
	type SshClientLike,
	SshHosts,
	sshTargetLabel,
} from "./ssh-host.ts";

describe("parseSshTarget", () => {
	it("user@host、带端口与 ssh:// 前缀都认", () => {
		expect(parseSshTarget("dev@laptop")).toEqual({ user: "dev", host: "laptop", port: 22 });
		expect(parseSshTarget("dev@laptop:2222")).toEqual({ user: "dev", host: "laptop", port: 2222 });
		expect(parseSshTarget("ssh://dev@10.0.0.2:2200")).toEqual({ user: "dev", host: "10.0.0.2", port: 2200 });
		expect(parseSshTarget("laptop")).toEqual({ user: undefined, host: "laptop", port: 22 });
		expect(parseSshTarget("[::1]:2200")).toEqual({ user: undefined, host: "::1", port: 2200 });
	});

	it("写错的给 undefined", () => {
		expect(parseSshTarget("")).toBeUndefined();
		expect(parseSshTarget("主机")).toBeUndefined();
		expect(parseSshTarget("dev@laptop:70000")).toBeUndefined();
		expect(parseSshTarget("dev@a/b")).toBeUndefined();
	});

	it("isSshTarget 只认前缀，label 去掉前缀", () => {
		expect(isSshTarget("ssh://dev@laptop")).toBe(true);
		expect(isSshTarget("laptop:6767")).toBe(false);
		expect(sshTargetLabel({ user: "dev", host: "laptop", port: 2222 })).toBe("dev@laptop:2222");
		expect(sshTargetLabel({ user: undefined, host: "laptop", port: 22 })).toBe("laptop");
	});
});

describe("ssh_config", () => {
	const text = `
Host dev
  HostName 10.0.0.2
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_dev

Host *
  User default
`;

	it("按 Host 块收字段，HostName 覆盖连接地址", () => {
		const config = parseSshConfig(text);
		expect(matchSshConfig(config, "dev")).toEqual({
			hostName: "10.0.0.2",
			user: "deploy",
			port: 2222,
			identityFiles: [expect.stringContaining("/.ssh/id_dev")],
		});
	});

	it("通配块兜底", () => {
		expect(matchSshConfig(parseSshConfig(text), "别的机器")?.user).toBe("default");
	});
});

describe("SshHosts", () => {
	/** 一条假的 SSH 连接：脚本输出与能否打开 socket 都由用例指定。 */
	function fakeClient(
		options: { socket?: string | Error; outputs?: (string | Error)[]; openable?: string[] },
		opened: { paths?: string[]; scripts?: string[]; config?: ConnectConfig },
	) {
		return async (config: ConnectConfig): Promise<SshClientLike> => {
			opened.config = config;
			opened.paths = [];
			return {
				run: async (script) => {
					opened.scripts = [...(opened.scripts ?? []), script];
					const next = options.outputs?.shift() ?? options.socket;
					if (next instanceof Error) {
						throw next;
					}
					return next === undefined ? "" : `${next}\n`;
				},
				openStreamLocal: async (path) => {
					opened.paths?.push(path);
					if (options.openable !== undefined && !options.openable.includes(path)) {
						throw new Error(`connect ENOENT ${path}`);
					}
					return emptyStream();
				},
				close: () => {},
			};
		};
	}

	const read = async (path: string): Promise<string | undefined> => {
		if (path.endsWith(".ssh/config")) {
			return "Host laptop\n  User dev\n  HostName 10.0.0.9\n";
		}
		return undefined;
	};

	it("按脚本给出的路径直接开通道，不再逐个试", async () => {
		const opened: { paths?: string[]; scripts?: string[] } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient({ socket: "/run/user/1000/facet.sock" }, opened),
		});
		const result = await hosts.open("ssh://dev@laptop");
		expect(result.address).toBe("/run/user/1000/facet.sock");
		expect(opened.paths).toEqual(["/run/user/1000/facet.sock"]);
		// 脚本走标准输入，命令行只有解释器
		expect(opened.scripts?.[0]).toContain("XDG_RUNTIME_DIR");
		expect(opened.scripts?.[0]).toContain(".local/share/facet/facet.sock");
	});

	it("没在跑时先拉起主机，等到 socket 出现就连上", async () => {
		const opened: { paths?: string[]; scripts?: string[] } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			socketWaitMs: 2_000,
			connect: fakeClient(
				{
					outputs: ["", "started", "/run/user/1000/facet.sock"],
					openable: ["/run/user/1000/facet.sock"],
				},
				opened,
			),
		});
		const result = await hosts.open("ssh://dev@laptop");
		expect(result.address).toBe("/run/user/1000/facet.sock");
		// 第一条是找 socket，第二条是启动，第三条又是找 socket
		expect(opened.scripts).toHaveLength(3);
		// 只从包安装目录起，不从用户目录里找
		expect(opened.scripts?.[1]).toContain("install=/opt/Facet/resources/server");
	});

	it("远端没装 facet 时直接失败并说明原因", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			socketWaitMs: 200,
			connect: fakeClient({ outputs: ["", "none"] }, {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({
			code: "not_installed",
			message: expect.stringContaining("没有安装 facet"),
		});
	});

	it("拉起来但等不到 socket 时说明等了多久", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			socketWaitMs: 300,
			connect: fakeClient({ outputs: ["", "started"] }, {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({
			code: "no_socket",
			message: expect.stringContaining("没等到 socket"),
		});
	});

	it("查 socket 的脚本本身跑不起来时说明原因", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			socketWaitMs: 200,
			connect: fakeClient({ outputs: [new Error("/bin/sh: not found")] }, {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({
			code: "no_socket",
			message: expect.stringContaining("查不到主机位置"),
		});
	});

	it("没有 ssh-agent 也没有私钥时要求输密码", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: {},
			readLocalFile: async () => undefined,
			connect: fakeClient({ socket: "/home/dev/.local/share/facet/facet.sock" }, {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({ code: "need_password" });
	});

	it("给了密码就按密码登录，不再读私钥", async () => {
		const opened: { config?: ConnectConfig } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: {},
			readLocalFile: async () => undefined,
			connect: fakeClient({ socket: "/run/user/0/facet.sock" }, opened),
		});
		await hosts.open("ssh://root@10.1.10.152", "root");
		expect(opened.config?.password).toBe("root");
		// 有的服务器只开 keyboard-interactive，密码要能自动回上去
		expect(opened.config?.tryKeyboard).toBe(true);
		expect(opened.config?.privateKey).toBeUndefined();
	});

	it("密码被拒时还要求密码，并说明是密码不对", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: {},
			readLocalFile: async () => undefined,
			connect: async () => {
				throw Object.assign(new Error("All configured authentication methods failed"), {
					level: "client-authentication",
				});
			},
		});
		await expect(hosts.open("ssh://root@10.1.10.152", "错的")).rejects.toMatchObject({
			code: "need_password",
			message: expect.stringContaining("密码不对"),
		});
	});

	it("私钥被拒时也转成要密码", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: async () => {
				throw Object.assign(new Error("All configured authentication methods failed"), {
					level: "client-authentication",
				});
			},
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({ code: "need_password" });
	});
});

/** 一条什么都不做的字节流。 */
function emptyStream() {
	return {
		write: () => {},
		onData: () => () => {},
		onClose: () => () => {},
		close: () => {},
	};
}
