import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AcpRegistryStore,
	BUILTIN_ACP_PROFILES,
	inspectAcpAvailability,
	mergeAcpProfiles,
	normalizeAcpProfile,
	resolveCommandPath,
} from "./acp-registry.ts";

describe("ACP 后端注册表", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "facet-acp-reg-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("解析 PATH 上的可执行命令与内置探测状态", () => {
		const env = {
			pathEnv: "/usr/local/bin:/usr/bin",
			platform: "linux" as const,
			isExecutable: (p: string) => p === "/usr/local/bin/agy",
		};
		expect(resolveCommandPath("agy", env)).toBe("/usr/local/bin/agy");
		expect(resolveCommandPath("missing", env)).toBeUndefined();

		const antigravity = BUILTIN_ACP_PROFILES[0];
		if (antigravity === undefined) {
			throw new Error("Expected built-in antigravity profile");
		}
		expect(inspectAcpAvailability(antigravity, env)).toMatchObject({
			id: "antigravity",
			kind: "acp",
			available: true,
			binaryPath: "/usr/local/bin/agy",
			loginHint: "agy acp --login",
		});
		expect(inspectAcpAvailability({ ...antigravity, command: "missing" }, env)).toMatchObject({
			available: false,
			issue: "Executable not found: missing",
		});
	});

	it("拒绝保留的 pi 标识与空字段，并保留内置预设", async () => {
		const builtInIds = new Set(["antigravity"]);
		expect(normalizeAcpProfile({ id: "pi", name: "x", command: "x" }, builtInIds)).toBeUndefined();
		expect(normalizeAcpProfile({ id: " ", name: "x", command: "x" }, builtInIds)).toBeUndefined();

		const merged = mergeAcpProfiles([
			{ id: "antigravity", name: "Antigravity", command: "/opt/agy", args: ["acp"], enabled: false },
			{ id: "claude", name: "Claude Code", command: "claude-acp", args: [], enabled: true },
		]);
		expect(merged.find((item) => item.id === "antigravity")).toMatchObject({
			command: "/opt/agy",
			enabled: false,
			builtIn: true,
			loginHint: "agy acp --login",
		});
		expect(merged.find((item) => item.id === "claude")).toBeDefined();
	});

	it("支持自定义配置持久化和握手失败原因缓存", async () => {
		const store = new AcpRegistryStore({
			agentDir: dir,
			probeEnv: {
				pathEnv: "/bin",
				platform: "linux",
				isExecutable: (p) => p === "/bin/agy" || p === "/bin/codex-acp",
			},
		});

		await store.saveProfile({
			id: "codex",
			name: "Codex",
			command: "codex-acp",
			args: [],
			enabled: true,
		});
		expect(store.listProfiles().map((p) => p.id)).toEqual(["antigravity", "codex"]);

		const failed = await store.probe("antigravity", async () => ({
			ok: false,
			issue: "Not authenticated",
		}));
		expect(failed.available).toBe(false);
		expect(failed.issue).toBe("Not authenticated");
		expect(store.listAvailability().find((b) => b.id === "antigravity")?.issue).toBe("Not authenticated");

		await store.removeProfile("codex");
		expect(store.listProfiles().map((p) => p.id)).toEqual(["antigravity"]);
		await expect(store.removeProfile("antigravity")).rejects.toThrow(/Built-in/);
	});
});
