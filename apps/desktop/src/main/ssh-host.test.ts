/**
 * SSH 连接的测试。
 *
 * 只测能离线验的部分：目标写法、known_hosts 校验（含哈希条目）、ssh_config 解析，以及
 * 用假连接跑一遍「读远端发现文件 → 打开 socket 通道」的流程。
 */
import { createHmac } from "node:crypto";
import type { ConnectConfig } from "ssh2";
import { describe, expect, it } from "vitest";
import {
	isSshTarget,
	matchSshConfig,
	parseHostKeyBlob,
	parseKnownHosts,
	parseSshConfig,
	parseSshTarget,
	remoteDiscoveryCommand,
	type SshClientLike,
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

describe("parseHostKeyBlob", () => {
	/** 照 SSH 线上的写法拼一个公钥 blob：4 字节长度 + 算法名 + 密钥数据。 */
	const blob = (keyType: string, keyData: Buffer): Buffer => {
		const name = Buffer.from(keyType, "utf8");
		const length = Buffer.alloc(4);
		length.writeUInt32BE(name.length, 0);
		return Buffer.concat([length, name, keyData]);
	};

	it("从二进制 blob 里取出算法名与 base64", () => {
		const raw = Buffer.from("密钥数据", "utf8");
		const parsed = parseHostKeyBlob(blob("ssh-ed25519", raw));
		expect(parsed?.keyType).toBe("ssh-ed25519");
		// known_hosts 存的是整段 blob 的 base64，和握手给的字节一致
		expect(parsed?.key).toBe(blob("ssh-ed25519", raw).toString("base64"));
	});

	it("解析结果能直接和 known_hosts 对上", () => {
		const raw = Buffer.from("密钥数据", "utf8");
		const key = blob("ssh-ed25519", raw);
		const entries = parseKnownHosts(`10.1.10.152 ssh-ed25519 ${key.toString("base64")}`);
		const parsed = parseHostKeyBlob(key);
		expect(parsed).toBeDefined();
		expect(verifyHostKey(entries, "10.1.10.152", 22, parsed?.keyType ?? "", parsed?.key ?? "")).toBe(true);
	});

	it("长度越界或算法名不像公钥类型时给 undefined", () => {
		const truncated = Buffer.from([0, 0, 0, 40, 0x61]);
		expect(parseHostKeyBlob(truncated)).toBeUndefined();
		expect(parseHostKeyBlob(Buffer.alloc(0))).toBeUndefined();
		const weird = Buffer.from([0, 0, 0, 3, 0x41, 0x42, 0x43]);
		expect(parseHostKeyBlob(weird)).toBeUndefined();
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
