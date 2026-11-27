import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpAgentRuntime } from "@facet/agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Connection, RpcContext } from "../context.ts";
import { handleRequest } from "../gateway.ts";

function makeConnection(
	role: Connection["role"] = "admin",
	entry: Connection["entry"] = "desktop",
): Connection {
	return {
		clientId: "c1",
		remoteAddress: "127.0.0.1",
		subscriptions: new Map(),
		authenticated: true,
		trusted: true,
		role,
		entry,
		send: () => {},
		close: () => {},
	};
}

describe("ACP 后端管理 RPC", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "facet-backend-rpc-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("支持 listBackends、saveAcpBackend 与 removeAcpBackend，并按管理档鉴权", async () => {
		const acpRuntime = new AcpAgentRuntime({
			agentDir: dir,
			probeEnv: {
				pathEnv: "/bin",
				platform: "linux",
				isExecutable: (candidate) => candidate === "/bin/agy" || candidate === "/bin/claude-acp",
			},
		});
		const context = {
			config: { hostName: "host", dataDir: dir, host: "127.0.0.1", port: 0, remotePermission: "operate" },
			acpRuntime,
			audit: { record: () => {} },
		} as unknown as RpcContext;

		const listed = (await handleRequest(context, makeConnection("operator"), "listBackends", {})) as {
			backends: Array<{ id: string; available: boolean }>;
		};
		expect(listed.backends.map((b) => [b.id, b.available])).toEqual([
			["pi", true],
			["antigravity", true],
		]);

		// 非管理员（如浏览器端操作档）无法保存自定义后端
		await expect(
			handleRequest(context, makeConnection("operator", "web"), "saveAcpBackend", {
				profile: {
					id: "claude",
					name: "Claude",
					command: "claude-acp",
					args: [],
					enabled: true,
				},
			}),
		).rejects.toMatchObject({ code: "rejected" });

		const saved = (await handleRequest(context, makeConnection("admin"), "saveAcpBackend", {
			profile: {
				id: "claude",
				name: "Claude",
				command: "claude-acp",
				args: ["--acp"],
				enabled: true,
			},
		})) as { backends: Array<{ id: string }>; profiles: Array<{ id: string }> };
		expect(saved.profiles.map((p) => p.id)).toEqual(["antigravity", "claude"]);

		const removed = (await handleRequest(context, makeConnection("admin"), "removeAcpBackend", {
			backendId: "claude",
		})) as { profiles: Array<{ id: string }> };
		expect(removed.profiles.map((p) => p.id)).toEqual(["antigravity"]);
	});
});
