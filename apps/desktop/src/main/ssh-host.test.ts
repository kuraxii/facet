/**
 * SSH 连接的测试。
 *
 * 只测能离线验的部分：目标写法、known_hosts 校验（含哈希条目）、ssh_config 解析，以及
 * 用假连接跑一遍「读远端发现文件 → 打开 socket 通道」的流程。
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	isSshTarget,
	matchSshConfig,
	parseKnownHosts,
	parseSshConfig,
	parseSshTarget,
	remoteDiscoveryCommand,
	type SshClientLike,
	SshHostError,
	SshHosts,
	sshTargetLabel,
	verifyHostKey,
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

describe("known_hosts", () => {
	const keyType = "ssh-ed25519";
	const key = "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey";

	it("明文条目按主机与端口匹配", () => {
		const entries = parseKnownHosts(`laptop ${keyType} ${key}\n[other]:2222 ${keyType} ${key}\n`);
		expect(verifyHostKey(entries, "laptop", 22, keyType, key)).toBe(true);
		expect(verifyHostKey(entries, "other", 2222, keyType, key)).toBe(true);
		expect(verifyHostKey(entries, "other", 22, keyType, key)).toBe(false);
	});

	it("密钥不同、类型不同都不算匹配", () => {
		const entries = parseKnownHosts(`laptop ${keyType} ${key}`);
		expect(verifyHostKey(entries, "laptop", 22, keyType, "别的公钥")).toBe(false);
		expect(verifyHostKey(entries, "laptop", 22, "ssh-rsa", key)).toBe(false);
	});

	it("Fedora 缺省的哈希条目也能匹配", () => {
		const salt = Buffer.from("0123456789abcdef");
		const digest = createHmac("sha1", salt).update("laptop").digest("base64");
		const entries = parseKnownHosts(`|1|${salt.toString("base64")}|${digest} ${keyType} ${key}`);
		expect(verifyHostKey(entries, "laptop", 22, keyType, key)).toBe(true);
		expect(verifyHostKey(entries, "别的机器", 22, keyType, key)).toBe(false);
	});

	it("注释与空行跳过", () => {
		expect(parseKnownHosts("# 注释\n\nlaptop ssh-ed25519 abc\n")).toHaveLength(1);
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
	function fakeClient(discovery: string, opened: { path?: string; tcp?: string }) {
		return async (): Promise<SshClientLike> => ({
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
		});
	}

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
					remote: { transport: "unix", path: "/home/u/.local/share/facet/remote.sock" },
					token: "远端令牌",
					pid: 1,
				}),
				opened,
			),
		});
		const result = await hosts.open("ssh://dev@laptop");
		// 远程端连的是远程监听，不是本机那条
		expect(opened.path).toBe("/home/u/.local/share/facet/remote.sock");
		expect(result.token).toBe("远端令牌");
		expect(result.address).toBe("/home/u/.local/share/facet/remote.sock");
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
					remote: { transport: "tcp", port: 4319 },
					token: "t",
					pid: 1,
				}),
				opened,
			),
		});
		await hosts.open("ssh://dev@laptop");
		expect(opened.tcp).toBe("127.0.0.1:4319");
	});

	it("主机没开远程接入时说明原因", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient(
				JSON.stringify({
					schemaVersion: 2,
					endpoint: { transport: "unix", path: "/home/u/.local/share/facet/host.sock" },
					token: "t",
					pid: 1,
				}),
				{},
			),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({ code: "no_discovery" });
	});

	it("远端没有发现文件时报没有主机", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: { SSH_AUTH_SOCK: "/tmp/agent.sock" },
			readLocalFile: read,
			connect: fakeClient("cat: no such file", {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toMatchObject({ code: "no_discovery" });
	});

	it("没有 ssh-agent 也没有私钥时说明原因", async () => {
		const hosts = new SshHosts({
			home: "/home/u",
			env: {},
			readLocalFile: async (path) => (path.endsWith("config") ? undefined : undefined),
			connect: fakeClient("{}", {}),
		});
		await expect(hosts.open("ssh://dev@laptop")).rejects.toBeInstanceOf(SshHostError);
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
