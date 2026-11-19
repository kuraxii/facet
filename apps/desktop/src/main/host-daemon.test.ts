import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	findRunningHost,
	hostSocketPath,
	isProcessAlive,
	readDiscoveryFile,
	resolveAgentDir,
	resolveDataDir,
} from "./host-daemon.ts";

const created: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "facet-daemon-"));
	created.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readDiscoveryFile", () => {
	it("读出 unix socket、令牌、标识与进程", () => {
		const text = JSON.stringify({
			schemaVersion: 2,
			endpoint: { transport: "unix", path: "/run/user/1000/facet.sock" },
			token: "令牌",
			hostId: "abc",
			agentDir: "/home/u/.pi/agent-dev",
			pid: 4242,
			startedAt: 1,
		});
		expect(readDiscoveryFile(text)).toEqual({
			schemaVersion: 2,
			endpoint: { transport: "unix", path: "/run/user/1000/facet.sock" },
			token: "令牌",
			hostId: "abc",
			agentDir: "/home/u/.pi/agent-dev",
			pid: 4242,
			startedAt: 1,
		});
	});

	it("TCP 端点同样认", () => {
		const text = JSON.stringify({
			endpoint: { transport: "tcp", url: "ws://127.0.0.1:4319/endpoint" },
			pid: 1,
		});
		expect(readDiscoveryFile(text)?.endpoint).toEqual({
			transport: "tcp",
			url: "ws://127.0.0.1:4319/endpoint",
		});
	});

	it("不是 JSON、缺端点、进程标识不是正整数时都不要", () => {
		expect(readDiscoveryFile("{")).toBeUndefined();
		expect(readDiscoveryFile("[]")).toBeUndefined();
		expect(readDiscoveryFile(JSON.stringify({ pid: 1 }))).toBeUndefined();
		expect(
			readDiscoveryFile(JSON.stringify({ endpoint: { transport: "tcp", url: "x" }, pid: 0 })),
		).toBeUndefined();
		expect(
			readDiscoveryFile(JSON.stringify({ endpoint: { transport: "tcp", url: "x" }, pid: 1.5 })),
		).toBeUndefined();
		expect(readDiscoveryFile(JSON.stringify({ endpoint: { transport: "pipe" }, pid: 1 }))).toBeUndefined();
	});
});

describe("resolveDataDir", () => {
	it("显式给出 FACET_DATA_DIR 时用它", () => {
		expect(resolveDataDir({ FACET_DATA_DIR: "/data/facet", XDG_DATA_HOME: "/xdg" })).toBe("/data/facet");
	});

	it("开发实例的数据目录带 -dev 后缀，与发布实例分开", () => {
		expect(resolveDataDir({ XDG_DATA_HOME: "/xdg" }, { isDev: true })).toBe(join("/xdg", "facet-dev"));
		expect(resolveDataDir({ XDG_DATA_HOME: "/xdg" })).toBe(join("/xdg", "facet"));
	});

	it("socket 优先落在运行目录，没有时落在数据目录", () => {
		expect(hostSocketPath("/data/facet-dev", { XDG_RUNTIME_DIR: "/run/user/1000" }, "linux")).toBe(
			join("/run/user/1000", "facet-dev.sock"),
		);
		expect(hostSocketPath("/data/facet-dev", {}, "linux")).toBe(join("/data/facet-dev", "facet.sock"));
	});

	it("Windows 上改用具名管道，与主机侧算出同一个名字", () => {
		// 摘要与 apps/server/src/config.ts 的 defaultSocketPath 一致：两边算出同一个管道名才连得上
		expect(hostSocketPath("/data/facet", {}, "win32")).toBe("\\\\.\\pipe\\facet-252272ec9bcb");
		expect(hostSocketPath("/data/facet-dev", { XDG_RUNTIME_DIR: "/run/user/1000" }, "win32")).toBe(
			"\\\\.\\pipe\\facet-80d4e7bdd3a2",
		);
	});

	it("按 XDG_DATA_HOME 取，没有或不是绝对路径时用家目录", () => {
		expect(resolveDataDir({ XDG_DATA_HOME: "/xdg" })).toBe(join("/xdg", "facet"));
		expect(resolveDataDir({ XDG_DATA_HOME: "relative" })).toBe(join(homedir(), ".local", "share", "facet"));
	});
});

describe("resolveAgentDir", () => {
	it("发布版与 pi 共用 ~/.pi/agent，也认 FACET_AGENT_DIR", () => {
		expect(resolveAgentDir({})).toBe(join(homedir(), ".pi", "agent"));
		expect(resolveAgentDir({ FACET_AGENT_DIR: "/data/agent" })).toBe("/data/agent");
	});

	it("开发态只认 FACET_DEV_AGENT_DIR，继承来的真实目录不参与", () => {
		expect(resolveAgentDir({}, { isDev: true })).toBe(join(homedir(), ".pi", "agent-dev"));
		expect(resolveAgentDir({ FACET_DEV_AGENT_DIR: "/data/agent-dev" }, { isDev: true })).toBe(
			"/data/agent-dev",
		);
		// facet 自带的终端与 pi 的 shell 都会带上这两个变量，指向真实目录
		expect(
			resolveAgentDir(
				{ FACET_AGENT_DIR: "/data/agent", PI_CODING_AGENT_DIR: "/data/agent" },
				{ isDev: true },
			),
		).toBe(join(homedir(), ".pi", "agent-dev"));
	});
});

describe("findRunningHost", () => {
	it("固定路径上的 socket 握手通过时返回主机", async () => {
		const dataDir = await tempDir();
		const expected = hostSocketPath(dataDir);
		const found = await findRunningHost({ dataDir, probe: async (host) => host.path === expected });
		expect(found?.path).toBe(expected);
	});

	it("握手不通时按没有主机处理", async () => {
		expect(await findRunningHost({ dataDir: await tempDir(), probe: async () => false })).toBeUndefined();
	});

	it("发现文件不影响判断：它是排障用的，连不上就是没开", async () => {
		const dataDir = await tempDir();
		await writeFile(
			join(dataDir, "endpoint.json"),
			JSON.stringify({
				endpoint: { transport: "unix", path: "/tmp/host.sock" },
				hostId: "h",
				pid: process.pid,
			}),
		);
		expect(await findRunningHost({ dataDir, probe: async () => false })).toBeUndefined();
	});
});

describe("isProcessAlive", () => {
	it("自己肯定活着，不存在的进程不在", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
		expect(isProcessAlive(999_999)).toBe(false);
	});
});
