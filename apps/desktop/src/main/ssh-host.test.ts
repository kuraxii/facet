/**
 * SSH 连接的测试。
 *
 * 只测能离线验的部分：目标写法、ssh_config 解析、密码与私钥两条认证路径，以及用假连接
 * 跑一遍「读远端发现文件 → 打开 socket 通道」的流程。
 */
import type { ConnectConfig } from "ssh2";
import { describe, expect, it } from "vitest";
import {
	isSshTarget,
	matchSshConfig,
	parseSshConfig,
	parseSshTarget,
	remoteDiscoveryCommand,
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
	/** 一条假的 SSH 连接：exec 返回给定文本，打开通道时记下参数。 */
	function fakeClient(discovery: string, opened: { path?: string; tcp?: string; config?: ConnectConfig }) {
		return async (config: ConnectConfig): Promise<SshClientLike> => {
			opened.config = config;
			return {
				exec: async () => discovery,
				openStreamLocal: async (path) => {
					opened.path = path;
					return emptyStream();
				},
				openTcp: async (host, port) => {
					opened.tcp = `${host}:${port}`;
					return emptyStream();
				},
				close: () => {},
			};
		};
	}

	const discovery = JSON.stringify({
		schemaVersion: 2,
		endpoint: { transport: "unix", path: "/home/u/.local/share/facet/host.sock" },
		token: "远端令牌",
		pid: 1,
	});

	const read = async (path: string): Promise<string | undefined> => {
		if (path.endsWith(".ssh/config")) {
			return "Host laptop\n  User dev\n  HostName 10.0.0.9\n";
		}
		if (path.endsWith("known_hosts")) {
			return "10.0.0.9 ssh-ed25519 KEY";
		}
		return undefined;
	};

	it("连上之后按远端发现文件打开 socket，带回令牌", async () => {
		const opened: { path?: string } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient(
				JSON.stringify({
					schemaVersion: 2,
					endpoint: { transport: "unix", path: "/home/u/.local/share/facet/host.sock" },
					token: "远端令牌",
					pid: 1,
				}),
				opened,
			),
		});
		const result = await hosts.open("ssh://dev@laptop");
		expect(opened.path).toBe("/home/u/.local/share/facet/host.sock");
		expect(result.token).toBe("远端令牌");
	});

	it("远端只监听 TCP 时退回 direct-tcpip", async () => {
		const opened: { tcp?: string } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient(
				JSON.stringify({
					schemaVersion: 2,
					endpoint: { transport: "tcp", url: "ws://127.0.0.1:4319/endpoint" },
					token: "t",
					pid: 1,
				}),
				opened,
			),
		});
		await hosts.open("ssh://dev@laptop");
		expect(opened.tcp).toBe("127.0.0.1:4319");
	});

	it("没有 ssh-agent 也没有私钥时要求输密码", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: {},
			readLocalFile: async (path) => (path.endsWith("config") ? undefined : undefined),
			connect: fakeClient("{}", {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({ code: "need_password" });
	});

	it("给了密码就按密码登录，不再读私钥", async () => {
		const opened: { config?: ConnectConfig } = {};
		const hosts = new SshHosts({
			home: "/home/u",
			env: {},
			readLocalFile: async (path) => (path.endsWith("config") ? undefined : undefined),
			connect: fakeClient(discovery, opened),
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
			readLocalFile: async (path) => (path.endsWith("config") ? undefined : undefined),
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

	it("读远端发现文件的命令按主机相同的规则取数据目录", () => {
		expect(remoteDiscoveryCommand()).toContain("XDG_DATA_HOME:-$HOME/.local/share");
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
