import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	findRunningHost,
	hostSocketPath,
	isProcessAlive,
	readDiscoveryFile,
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
		expect(resolveDataDir({ XDG_DATA_HOME: "/xdg" }, { isDev: true })).toBe("/xdg/facet-dev");
		expect(resolveDataDir({ XDG_DATA_HOME: "/xdg" })).toBe("/xdg/facet");
	});

	it("socket 固定落在数据目录下", () => {
		expect(hostSocketPath("/data/facet-dev")).toBe("/data/facet-dev/facet.sock");
	});

	it("按 XDG_DATA_HOME 取，没有或不是绝对路径时用家目录", () => {
		expect(resolveDataDir({ XDG_DATA_HOME: "/xdg" })).toBe("/xdg/facet");
		expect(resolveDataDir({ XDG_DATA_HOME: "relative" }).endsWith("/.local/share/facet")).toBe(true);
	});
});

describe("findRunningHost", () => {
	it("固定路径上的 socket 握手通过时返回主机", async () => {
		const dataDir = await tempDir();
		const found = await findRunningHost({
			dataDir,
			probe: async (host) => host.path === join(dataDir, "facet.sock"),
		});
		expect(found?.path).toBe(join(dataDir, "facet.sock"));
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
