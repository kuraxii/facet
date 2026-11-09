import { SessionClient, toTranscript } from "@facet/client-core";
import type { SessionSummary } from "@facet/protocol";
import { WsTransport } from "@facet/transport/ws";
import { ChatTranscript } from "@facet/ui";
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

function formatTime(value: number): string {
	return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
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

	useEffect(() => {
		if (started.current) {
			return;
		}
		started.current = true;
		void (async () => {
			const handshake = await transport.connect();
			client.attach(handshake);
			const scoped = await client.listSessions(bridge.projectDir);
			const pool = scoped.length > 0 ? scoped : await client.listSessions();
			setSessions(pool);
			const newest = pool[0];
			if (newest) {
				await client.openSession(newest.path);
				setActiveFile(newest.path);
			}
			console.log(`已打开 ${newest?.path ?? "无会话"},装载 ${client.chatView()?.messages.length ?? 0} 条`);
			setPhase("ready");
		})().catch((error: unknown) => {
			setFailure(error instanceof Error ? error.message : String(error));
			setPhase("failed");
		});
	}, []);

	const session = client.sessionView();
	const chat = client.chatView();
	const messages = chat?.messages ?? [];
	const pending = session?.inputNeeded ?? [];

	const openSession = useCallback(async (summary: SessionSummary) => {
		await client.release();
		await client.openSession(summary.path);
		setActiveFile(summary.path);
	}, []);

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

	const forkFrom = useCallback((messageId: string) => {
		void client.fork(messageId).then((forked) => setActiveFile(forked.file));
	}, []);

	const transcript = useMemo(() => (chat ? toTranscript(chat) : []), [chat]);

	void version;

	if (phase === "failed") {
		return (
			<main className="boot">
				<h1>连不上设备</h1>
				<p>{failure}</p>
				<p className="boot-hint">端点 {bridge.endpoint}</p>
			</main>
		);
	}

	if (phase === "connecting") {
		return (
			<main className="boot">
				<h1>正在连接设备</h1>
				<p className="boot-hint">端点 {bridge.endpoint}</p>
			</main>
		);
	}

	return (
		<div className="shell">
			<aside className="sidebar">
				<div className="sidebar-head">
					<span className="sidebar-title">会话</span>
					<span className="sidebar-count">{sessions.length}</span>
				</div>
				<ul className="session-list">
					{sessions.map((summary) => (
						<li key={summary.path}>
							<button
								type="button"
								className={summary.path === activeFile ? "session is-active" : "session"}
								onClick={() => void openSession(summary)}
							>
								<span className="session-name">
									{summary.name ?? summary.firstMessage.slice(0, 24) ?? "未命名"}
								</span>
								<span className="session-meta">
									{summary.messageCount} 条 · {formatTime(summary.modified)}
								</span>
							</button>
						</li>
					))}
				</ul>
				<div className="sidebar-foot">{bridge.projectDir}</div>
			</aside>

			<main className="chat">
				<header className="chat-head">
					<div className="chat-title">
						{session?.title ?? "未命名会话"}
						{session?.status === "running" ? <span className="chip is-live">运行中</span> : null}
					</div>
					<div className="chat-meta">
						<span>{session?.model?.id ?? "无模型"}</span>
						<span>{session?.thinkingLevel ?? "—"}</span>
						<span>{messages.length} 条已装载</span>
					</div>
				</header>

				<section className="stream">
					{client.hasMore ? (
						<button type="button" className="load-older" onClick={loadOlder}>
							加载更早的历史
						</button>
					) : null}

					<ChatTranscript
						items={transcript}
						canFork={chat?.isRunning !== true}
						onFork={forkFrom}
						emptyHint="还没有消息"
					/>
				</section>

				{pending.length > 0 ? (
					<div className="approvals">
						{pending.map((request) => (
							<div key={request.id} className="approval">
								<span>
									需要确认:{request.toolName} {request.id}
								</span>
								<button type="button" onClick={() => client.respondTool(request.id, { action: "allow" })}>
									允许
								</button>
								<button type="button" onClick={() => client.respondTool(request.id, { action: "deny" })}>
									拒绝
								</button>
							</div>
						))}
					</div>
				) : null}

				<footer className="composer">
					<textarea
						value={draft}
						placeholder="输入消息,回车发送"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								send();
							}
						}}
					/>
					<div className="composer-actions">
						{chat?.isRunning === true ? (
							<button type="button" onClick={() => client.cancel()}>
								停止
							</button>
						) : null}
						<button type="button" className="primary" onClick={send} disabled={draft.trim().length === 0}>
							发送
						</button>
					</div>
				</footer>

				{chat && chat.notices.length > 0 ? (
					<div className="notices">
						{chat.notices.map((notice) => (
							<span key={`${notice.level}:${notice.message}`} className={`notice level-${notice.level}`}>
								{notice.message}
							</span>
						))}
					</div>
				) : null}
			</main>
		</div>
	);
}
