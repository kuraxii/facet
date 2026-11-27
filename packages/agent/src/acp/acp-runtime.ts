/**
 * 外部 ACP 后端的进程级运行时容器。
 *
 * 与 `PiAgentFactory` 各自独立维护生命周期：拥有 ACP 注册表、轻量会话索引与创建/恢复/探测入口，
 * 不混入 Pi 的 `ModelRuntime` 与 `.jsonl` 目录扫描逻辑。
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AcpBackendProfile, BackendAvailability } from "@facet/protocol";
import { AcpAgent, formatAcpInitFailure } from "./acp-agent.ts";
import { AcpRegistryStore, type CommandProbeEnv } from "./acp-registry.ts";
import { AcpSessionIndex } from "./acp-session-index.ts";

/** 构造 `AcpAgentRuntime` 的参数。 */
export interface AcpAgentRuntimeOptions {
	/** 宿主数据目录，注册表与轻量索引都落在此目录下 */
	agentDir: string;
	/** 测试可注入自定义命令探测环境 */
	probeEnv?: CommandProbeEnv;
	onError?: (error: unknown) => void;
}

/** 外部 ACP 会话运行时工厂与配置管理。 */
export class AcpAgentRuntime {
	readonly registry: AcpRegistryStore;
	readonly index: AcpSessionIndex;
	private readonly onError?: (error: unknown) => void;

	constructor(options: AcpAgentRuntimeOptions) {
		this.registry = new AcpRegistryStore({
			agentDir: options.agentDir,
			probeEnv: options.probeEnv,
		});
		this.index = new AcpSessionIndex(options.agentDir);
		this.onError = options.onError;
	}

	/** 创建一条新的 ACP 会话（先同步建好句柄，由 SessionHub 订阅后调 initialize）。 */
	create(options: { backendId: string; cwd?: string; name?: string }): AcpAgent {
		const profile = this.requireEnabledProfile(options.backendId);
		const cwd = options.cwd ?? process.cwd();
		return new AcpAgent({
			id: randomUUID(),
			profile,
			cwd,
			name: options.name,
			onIndexSync: (info) => {
				void this.index.upsert(info).catch((error) => this.onError?.(error));
			},
			onError: this.onError,
		});
	}

	/** 从轻量索引恢复一条已有 ACP 会话。 */
	open(locator: string, cwdOverride?: string): AcpAgent {
		const record = this.index.get(locator);
		if (record === undefined) {
			throw new Error(`ACP session not found in index: ${locator}`);
		}
		const profile = this.requireEnabledProfile(record.backendId);
		return new AcpAgent({
			id: record.externalSessionId,
			profile,
			cwd: cwdOverride ?? record.cwd,
			externalSessionId: record.externalSessionId,
			name: record.name,
			onIndexSync: (info) => {
				void this.index.upsert(info).catch((error) => this.onError?.(error));
			},
			onError: this.onError,
		});
	}

	/** 启动一次短生命探测子进程，验证目标 ACP CLI 能否完成 initialize 握手。 */
	async probeBackend(backendId: string): Promise<BackendAvailability> {
		return await this.registry.probe(backendId, async (profile) => {
			return await runAcpHandshakeProbe(profile);
		});
	}

	private requireEnabledProfile(backendId: string): AcpBackendProfile {
		const profile = this.registry.getProfile(backendId);
		if (profile === undefined) {
			throw new Error(`Unknown ACP backend: ${backendId}`);
		}
		if (!profile.enabled) {
			throw new Error(`ACP backend is disabled: ${profile.name}`);
		}
		return profile;
	}
}

async function runAcpHandshakeProbe(profile: AcpBackendProfile): Promise<{ ok: boolean; issue?: string }> {
	const child = spawn(profile.command, profile.args, {
		env: profile.env ? { ...process.env, ...profile.env } : process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stdin.on("error", () => undefined);
	const stderr: string[] = [];
	child.stderr.on("data", (chunk: Buffer | string) => {
		for (const line of String(chunk).split(/\r?\n/)) {
			const trimmed = line.trim();
			if (trimmed.length > 0) stderr.push(trimmed);
		}
	});
	const app = client({ name: "facet-probe" });
	const conn = app.connect(
		ndJsonStream(
			Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
			Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
		),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			conn.agent.request("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				clientInfo: { name: "facet-probe", version: "0.1.0" },
				clientCapabilities: {},
			}),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error("Timed out waiting for ACP initialize")), 5000);
			}),
		]);
		return { ok: true };
	} catch (error) {
		return { ok: false, issue: formatAcpInitFailure(error, stderr, profile) };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		try {
			conn.close();
		} catch {
			// ignore
		}
		if (child.exitCode === null && !child.killed) {
			child.kill("SIGTERM");
		}
	}
}
