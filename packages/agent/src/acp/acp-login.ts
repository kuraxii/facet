/**
 * 外部 ACP 后端交互式登录会话管理器（对齐 t3code 的 `agy acp --login` 流程）。
 *
 * 负责拉起 `<command> acp --login` 子进程、提取 Google OAuth 授权链接、
 * 接收用户回填的授权码并等待进程落盘凭据。
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AcpBackendProfile } from "@facet/protocol";
import { resolveCommandPath } from "./acp-registry.ts";
import { spawnAcpProcess, terminateAcpProcess } from "./acp-spawn.ts";
import { extractAntigravityAuthUrl, prepareAntigravityAuthEnv } from "./antigravity-auth.ts";

const LOGIN_START_TIMEOUT_MS = 20_000;
const LOGIN_SUBMIT_TIMEOUT_MS = 30_000;

interface ActiveLoginSession {
	readonly id: string;
	readonly backendId: string;
	readonly child: ChildProcessWithoutNullStreams;
	readonly stderr: string[];
	readonly exitPromise: Promise<number | null>;
}

/** 管理设置页发起的 ACP 登录会话。 */
export class AcpLoginManager {
	private readonly sessions = new Map<string, ActiveLoginSession>();

	/** 启动登录子进程并等待授权链接输出。 */
	async start(profile: AcpBackendProfile): Promise<{ loginId: string; authUrl?: string }> {
		const loginId = randomUUID();
		const stderr: string[] = [];
		const child = spawnAcpProcess({
			command: profile.command,
			args: [...profile.args, "--login"],
			profileEnv: profile.env,
			prepareEnv: prepareAntigravityAuthEnv,
			resolveCommand: (cmd) => resolveCommandPath(cmd),
			onStderrLine: (line) => stderr.push(line),
		});

		const exitPromise = new Promise<number | null>((resolve, reject) => {
			child.on("error", reject);
			child.on("exit", (code) => resolve(code));
		});

		const session: ActiveLoginSession = {
			id: loginId,
			backendId: profile.id,
			child,
			stderr,
			exitPromise,
		};
		this.sessions.set(loginId, session);

		try {
			const authUrl = await new Promise<string | undefined>((resolve, reject) => {
				let settled = false;
				const timer = setTimeout(() => {
					if (settled) return;
					settled = true;
					reject(new Error("Timed out waiting for sign-in link"));
				}, LOGIN_START_TIMEOUT_MS);

				const handleLine = (raw: string): void => {
					if (settled) return;
					const url = extractAntigravityAuthUrl(raw);
					if (url !== undefined) {
						settled = true;
						clearTimeout(timer);
						resolve(url);
					}
				};

				let stdoutBuf = "";
				child.stdout.on("data", (chunk: Buffer | string) => {
					stdoutBuf += String(chunk);
					const lines = stdoutBuf.split(/\r?\n/);
					stdoutBuf = lines.pop() ?? "";
					for (const line of lines) handleLine(line);
					if (stdoutBuf.startsWith("https://accounts.google.com/")) {
						handleLine(stdoutBuf);
					}
				});

				child.stderr.on("data", (chunk: Buffer | string) => {
					for (const line of String(chunk).split(/\r?\n/)) {
						handleLine(line);
					}
				});

				void exitPromise.then(
					(code) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						if (code === 0) {
							resolve(undefined);
						} else {
							const detail = stderr.slice(-4).join("\n").trim();
							reject(new Error(detail.length > 0 ? detail : `Sign-in exited with code ${code ?? "null"}`));
						}
					},
					(err) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						reject(err);
					},
				);
			});
			return authUrl === undefined ? { loginId } : { loginId, authUrl };
		} catch (error) {
			this.cancel(loginId);
			throw error;
		}
	}

	/** 提交授权码并等待进程落盘凭据后退出。 */
	async submit(loginId: string, code: string): Promise<string> {
		const session = this.sessions.get(loginId);
		if (session === undefined) {
			throw new Error(`Unknown ACP login session: ${loginId}`);
		}
		this.sessions.delete(loginId);
		const trimmed = code.trim();
		if (trimmed.length === 0) {
			terminateAcpProcess(session.child, 1500);
			throw new Error("Authorization code is empty");
		}
		try {
			session.child.stdin.write(`${trimmed}\n`);
		} catch (error) {
			terminateAcpProcess(session.child, 1500);
			throw error;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const exitCode = await Promise.race([
				session.exitPromise,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() => reject(new Error("Timed out completing sign-in")),
						LOGIN_SUBMIT_TIMEOUT_MS,
					);
				}),
			]);
			if (exitCode !== 0) {
				const detail = session.stderr.slice(-4).join("\n").trim();
				throw new Error(detail.length > 0 ? detail : `Sign-in failed (exit=${exitCode ?? "null"})`);
			}
			return session.backendId;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			terminateAcpProcess(session.child, 1500);
		}
	}

	/** 取消并清理正在进行的登录会话。 */
	cancel(loginId: string): void {
		const session = this.sessions.get(loginId);
		if (session === undefined) {
			return;
		}
		this.sessions.delete(loginId);
		terminateAcpProcess(session.child, 1500);
	}
}
