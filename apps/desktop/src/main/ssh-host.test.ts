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
	/** 一条假的 SSH 连接：家目录可给，打开 socket 时记下走过的路径。 */
	function fakeClient(
		options: { home?: string; uid?: number; openable?: string[] },
		opened: { paths?: string[]; config?: ConnectConfig },
	) {
		return async (config: ConnectConfig): Promise<SshClientLike> => {
			opened.config = config;
			opened.paths = [];
			return {
				home: async () => options.home,
				uid: async () => options.uid,
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

	it("运行目录优先：先试 /run/user/<uid> 下的 socket", async () => {
		const opened: { paths?: string[] } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient({ home: "/home/dev", uid: 1000, openable: ["/run/user/1000/facet.sock"] }, opened),
		});
		const result = await hosts.open("ssh://dev@laptop");
		expect(result.address).toBe("/run/user/1000/facet.sock");
		expect(opened.paths).toEqual(["/run/user/1000/facet.sock"]);
	});

	it("运行目录没有时退到家目录下的固定路径", async () => {
		const opened: { paths?: string[] } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient(
				{ home: "/home/dev", uid: 1000, openable: ["/home/dev/.local/share/facet/facet.sock"] },
				opened,
			),
		});
		const result = await hosts.open("ssh://dev@laptop");
		expect(result.address).toBe("/home/dev/.local/share/facet/facet.sock");
		// 运行目录两条都没中，才走家目录
		expect(opened.paths).toEqual([
			"/run/user/1000/facet.sock",
			"/run/user/1000/facet-dev.sock",
			"/home/dev/.local/share/facet/facet.sock",
		]);
	});

	it("开发实例的 socket 也能连", async () => {
		const opened: { paths?: string[] } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient(
				{ home: "/home/dev", uid: 1000, openable: ["/run/user/1000/facet-dev.sock"] },
				opened,
			),
		});
		const result = await hosts.open("ssh://dev@laptop");
		expect(result.address).toBe("/run/user/1000/facet-dev.sock");
	});

	it("取不到 uid 时只试家目录下的路径", async () => {
		const opened: { paths?: string[] } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient(
				{ home: "/home/dev", openable: ["/home/dev/.local/share/facet/facet.sock"] },
				opened,
			),
		});
		await hosts.open("ssh://dev@laptop");
		expect(opened.paths).toEqual(["/home/dev/.local/share/facet/facet.sock"]);
	});

	it("两个路径都连不上时报「没有在跑的主机」", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient({ home: "/home/dev", openable: [] }, {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({ code: "no_socket" });
	});

	it("拿不到远端家目录时说明原因", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient({}, {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({ code: "no_home" });
	});

	it("没有 ssh-agent 也没有私钥时要求输密码", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: {},
			readLocalFile: async () => undefined,
			connect: fakeClient({ home: "/home/dev" }, {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({ code: "need_password" });
	});

	it("给了密码就按密码登录，不再读私钥", async () => {
		const opened: { config?: ConnectConfig } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: {},
			readLocalFile: async () => undefined,
			connect: fakeClient({ home: "/root" }, opened),
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
