import { SessionClient, toTranscript } from "@facet/client-core";
import type { InputRequest, SessionSummary } from "@facet/protocol";
import { WsTransport } from "@facet/transport/ws";
import { ChatTranscript, Composer, SessionSidebar, toolTarget } from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/** 预加载脚本注入的启动参数 */
interface FacetBridge {
	endpoint: string;
	projectDir: string;
	platform: string;
}

declare global {
	interface Window {
		facet: FacetBridge;
	}
}

const bridge = window.facet;

const transport = new WsTransport({ url: bridge.endpoint });
const client = new SessionClient({ transport, initialPages: 2, pageSize: 40 });

type Phase = "connecting" | "ready" | "failed";

/** 审批条上的一句话说明:工具名加参数摘要。 */
function approvalLabel(request: InputRequest | undefined): string {
	if (!request) {
		return "";
	}
	const target = toolTarget(request.input);
	return target.length > 0 ? `${request.toolName} ${target}` : request.toolName;
}

export function App() {
	const version = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => client.store.getVersion(),
	);
	const [phase, setPhase] = useState<Phase>("connecting");
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
	const [activeFile, setActiveFile] = useState<string | undefined>(undefined);
	const [draft, setDraft] = useState("");
	const started = useRef(false);

	const refreshSessions = useCallback(async () => {
		const scoped = await client.listSessions(bridge.projectDir);
		const pool = scoped.length > 0 ? scoped : await client.listSessions();
		setSessions(pool);
		return pool;
	}, []);

	useEffect(() => {
		if (started.current) {
			return;
		}
		started.current = true;
		void (async () => {
			const handshake = await transport.connect();
			client.attach(handshake);
			const pool = await refreshSessions();
			const newest = pool[0];
			if (newest) {
				await client.openSession(newest.path);
				setActiveFile(newest.path);
			}
			setPhase("ready");
		})().catch((error: unknown) => {
			setFailure(error instanceof Error ? error.message : String(error));
			setPhase("failed");
		});
	}, [refreshSessions]);

	void version;

	const session = client.sessionView();
	const chat = client.chatView();
	const pending = session?.inputNeeded ?? [];

	const openSession = useCallback(async (summary: SessionSummary) => {
		await client.release();
		await client.openSession(summary.path);
		setActiveFile(summary.path);
	}, []);

	const createSession = useCallback(async () => {
		await client.release();
		const opened = await client.createSession({
			...(bridge.projectDir.length > 0 ? { cwd: bridge.projectDir } : {}),
		});
		setActiveFile(opened.file);
		await refreshSessions();
	}, [refreshSessions]);

	const send = useCallback(() => {
		const text = draft.trim();
		if (text.length === 0) {
			return;
		}
		setDraft("");
		client.send(text);
	}, [draft]);

	const loadOlder = useCallback(() => {
		void client.loadOlder();
	}, []);

	const forkFrom = useCallback(
		(messageId: string) => {
			void client.fork(messageId).then(async (forked) => {
				setActiveFile(forked.file);
				await refreshSessions();
			});
		},
		[refreshSessions],
	);

	const transcript = useMemo(() => (chat ? toTranscript(chat) : []), [chat]);

	if (phase === "failed") {
		return (
			<main className="boot">
				<h1>连不上设备</h1>
				<p>{failure}</p>
				<p>{bridge.endpoint}</p>
			</main>
		);
	}

	if (phase === "connecting") {
		return (
			<main className="boot">
				<h1>正在连接设备</h1>
				<p>{bridge.endpoint}</p>
			</main>
		);
	}

	return (
		<div className="shell">
			<SessionSidebar
				sessions={sessions}
				activeFile={activeFile}
				runningFile={chat?.isRunning === true ? activeFile : undefined}
				projectDir={bridge.projectDir}
				onSelect={(summary) => void openSession(summary)}
				onCreate={() => void createSession()}
				canCreate={phase === "ready"}
			/>

			<main className="main">
				<section className="scroll">
					<div className="column">
						{client.hasMore ? (
							<button type="button" className="load-older" onClick={loadOlder}>
								加载更早的历史
							</button>
						) : null}
						<ChatTranscript
							items={transcript}
							canFork={chat?.isRunning !== true}
							onFork={forkFrom}
							retry={chat?.retry}
							emptyHint="还没有消息,输入内容开始"
						/>
					</div>
				</section>

				<div className="footer">
					<div className="footer-column">
						{pending.length > 0 ? (
							<div className="approval">
								<b>需要确认</b>
								<span className="cmd">{approvalLabel(pending[0])}</span>
								{pending.length > 1 ? <span className="stat">共 {pending.length} 项</span> : null}
								<span className="actions">
									<button
										type="button"
										className="btn"
										onClick={() => {
											for (const request of pending) {
												client.respondTool(request.id, { action: "deny" });
											}
										}}
									>
										拒绝
									</button>
									<button
										type="button"
										className="btn pri"
										onClick={() => {
											for (const request of pending) {
												client.respondTool(request.id, { action: "allow" });
											}
										}}
									>
										允许
									</button>
								</span>
							</div>
						) : null}

						<Composer
							value={draft}
							onChange={setDraft}
							onSend={send}
							onStop={() => client.cancel()}
							isRunning={chat?.isRunning === true}
							model={session?.model}
							thinkingLevel={session?.thinkingLevel}
						/>

						{chat && chat.notices.length > 0 ? (
							<div className="notices">
								{chat.notices.map((notice) => (
									<span key={`${notice.level}:${notice.message}`} className="chip">
										{notice.message}
									</span>
								))}
							</div>
						) : null}
					</div>
				</div>
			</main>
		</div>
	);
}
