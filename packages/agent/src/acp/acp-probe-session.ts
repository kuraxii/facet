/**
 * ACP 占位空会话管理与实时草稿配置拉取。
 *
 * 为每个 ACP Agent 只维护一个可复用的占位 `probeSessionId`（保存在 `<acpDir>/acp-draft-session.json`，
 * 不写入 `acp-sessions.json`）：需要获取模型、思考强度与模式时优先通过 `session/load` /
 * `session/resume` 挂回该空会话直接读取，仅在尚无占位会话或原占位已失效时才调一次 `session/new`。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AcpAgentProfile, AcpConfigOption, AcpModeState } from "@facet/protocol";
import { writeFileAtomic } from "../atomic-write.ts";
import { formatAcpInitFailure } from "./acp-agent.ts";
import { type AcpAgentAdapter, normalizeAcpSessionState } from "./acp-events.ts";
import { resolveCommandPath } from "./acp-registry.ts";
import { spawnAcpProcess, terminateAcpProcess } from "./acp-spawn.ts";

const PROBE_STORE_FILENAME = "acp-draft-session.json";
const PROBE_TIMEOUT_MS = 10_000;

interface StoredProbeSessions {
	version: number;
	sessions: Record<string, string>;
}

/** 占位空会话索引存储（`agentId -> externalSessionId`）。 */
export class AcpProbeSessionStore {
	readonly filePath: string;
	private sessions = new Map<string, string>();
	private loaded = false;

	constructor(agentDir: string) {
		this.filePath = join(agentDir, PROBE_STORE_FILENAME);
	}

	/** 读取某个 ACP Agent 当前记录的占位空会话 id。 */
	get(agentId: string): string | undefined {
		this.ensureLoaded();
		return this.sessions.get(agentId);
	}

	/** 保存某个 ACP Agent 的占位空会话 id 并原子写盘。 */
	async set(agentId: string, externalSessionId: string): Promise<void> {
		this.ensureLoaded();
		this.sessions.set(agentId, externalSessionId);
		await this.persist();
	}

	/** 清除失效的占位空会话 id。 */
	async clear(agentId: string): Promise<void> {
		this.ensureLoaded();
		if (!this.sessions.delete(agentId)) {
			return;
		}
		await this.persist();
	}

	private ensureLoaded(): void {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
		if (!existsSync(this.filePath)) {
			return;
		}
		try {
			const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoredProbeSessions>;
			if (parsed.sessions === undefined || typeof parsed.sessions !== "object" || parsed.sessions === null) {
				return;
			}
			for (const [agentId, sessionId] of Object.entries(parsed.sessions)) {
				if (typeof sessionId === "string" && sessionId.length > 0) {
					this.sessions.set(agentId, sessionId);
				}
			}
		} catch {
			// 索引损坏时退回空映射，后续探测会自动重建占位会话
		}
	}

	private async persist(): Promise<void> {
		const payload: StoredProbeSessions = {
			version: 1,
			sessions: Object.fromEntries(this.sessions.entries()),
		};
		await writeFileAtomic(this.filePath, `${JSON.stringify(payload, null, "\t")}\n`);
	}
}

export interface ProbeDraftConfigInput {
	profile: AcpAgentProfile;
	cwd: string;
	adapter: AcpAgentAdapter | undefined;
	probeStore: AcpProbeSessionStore;
	configId?: string;
	configValue?: string;
}

export interface ProbeDraftConfigResult {
	mode?: AcpModeState;
	configOptions: AcpConfigOption[];
}

function withTimeout<T>(promise: Promise<T>, label: string, ms = PROBE_TIMEOUT_MS): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** 通过复用的占位空会话实时拉取 ACP 的 `modes` 与 `configOptions`（不做目录缓存）。 */
export async function probeAcpDraftConfig(input: ProbeDraftConfigInput): Promise<ProbeDraftConfigResult> {
	const { profile, cwd, adapter, probeStore, configId, configValue } = input;
	const stderr: string[] = [];
	let failFast: ((error: Error) => void) | undefined;
	const earlyFailure = new Promise<never>((_resolve, reject) => {
		failFast = reject;
	});
	const child = spawnAcpProcess({
		command: profile.command,
		args: profile.args,
		profileEnv: profile.env,
		resolveCommand: (cmd) => resolveCommandPath(cmd),
		onStderrLine: (line) => stderr.push(line),
		onSpawnError: (error) => failFast?.(error),
	});
	child.on("exit", (code, signal) => {
		failFast?.(
			new Error(`ACP process exited during draft probe (code=${code ?? "null"}, signal=${signal ?? "none"})`),
		);
	});

	const app = client({ name: "facet" });
	const conn = app.connect(
		ndJsonStream(
			Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
			Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
		),
	);

	try {
		const init = await Promise.race([
			withTimeout(
				conn.agent.request("initialize", {
					protocolVersion: PROTOCOL_VERSION,
					clientInfo: { name: "facet", version: "0.1.0" },
					clientCapabilities: {},
				}),
				"ACP initialize",
			),
			earlyFailure,
		]);

		const caps = init.agentCapabilities;
		const supportsLoad = Boolean(caps?.loadSession);
		const supportsResume = Boolean(caps?.sessionCapabilities?.resume);
		let sessionId = probeStore.get(profile.id);
		let rawModes: Parameters<typeof normalizeAcpSessionState>[0];
		let rawConfigs: Parameters<typeof normalizeAcpSessionState>[1];
		let attached = false;

		if (sessionId !== undefined && (supportsLoad || supportsResume)) {
			try {
				if (supportsLoad) {
					const loaded = await Promise.race([
						withTimeout(
							conn.agent.request("session/load", { sessionId, cwd, mcpServers: [] }),
							"ACP session/load",
						),
						earlyFailure,
					]);
					rawModes = loaded?.modes;
					rawConfigs = loaded?.configOptions;
					attached = true;
				} else {
					const resumed = await Promise.race([
						withTimeout(conn.agent.request("session/resume", { sessionId, cwd }), "ACP session/resume"),
						earlyFailure,
					]);
					rawModes = resumed.modes;
					rawConfigs = resumed.configOptions;
					attached = true;
				}
			} catch {
				// 原占位会话已被外部删除或不可恢复时清掉记录，下面新建唯一占位会话
				await probeStore.clear(profile.id);
				sessionId = undefined;
			}
		}

		if (!attached || sessionId === undefined) {
			const created = await Promise.race([
				withTimeout(conn.agent.request("session/new", { cwd, mcpServers: [] }), "ACP session/new"),
				earlyFailure,
			]);
			sessionId = created.sessionId;
			rawModes = created.modes;
			rawConfigs = created.configOptions;
			await probeStore.set(profile.id, sessionId);
		}

		let normalized = normalizeAcpSessionState(rawModes, rawConfigs, adapter?.toCanonicalModeId);
		if (configId !== undefined && configValue !== undefined) {
			const updated = await Promise.race([
				withTimeout(
					conn.agent.request("session/set_config_option", {
						sessionId,
						configId,
						value: configValue,
					}),
					"ACP session/set_config_option",
				),
				earlyFailure,
			]);
			normalized = normalizeAcpSessionState(rawModes, updated.configOptions, adapter?.toCanonicalModeId);
		}

		return {
			...(normalized.mode === undefined ? {} : { mode: normalized.mode }),
			configOptions: normalized.configOptions,
		};
	} catch (error) {
		throw new Error(formatAcpInitFailure(error, stderr, profile));
	} finally {
		try {
			conn.close();
		} catch {
			// ignore
		}
		terminateAcpProcess(child, 1500);
	}
}
