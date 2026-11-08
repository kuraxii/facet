import { type Part, SessionClient, type TranscriptItem, toTranscript } from "@facet/client-core";
import type { SessionSummary } from "@facet/protocol";
import { WsTransport } from "@facet/transport/ws";
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

/** 一段内容。工具调用与思考可以折叠。 */
function PartBlock({ part }: { part: Part }) {
	if (part.kind === "text") {
		return <pre className="part-text">{part.text}</pre>;
	}
	if (part.kind === "thinking") {
		return (
			<details className="part-thinking">
				<summary>思考</summary>
				<pre>{part.text}</pre>
			</details>
		);
	}
	const summary = part.input === undefined ? "" : JSON.stringify(part.input).slice(0, 200);
	return (
		<details className={`part-tool status-${part.status}`} open={part.status === "running"}>
			<summary>
				<span className="tool-name">{part.name}</span>
				<span className="tool-status">
					{part.status === "running" ? "执行中" : part.status === "failed" ? "失败" : "完成"}
				</span>
				{part.durationMs === undefined ? null : <span className="tool-time">{part.durationMs}ms</span>}
			</summary>
			{summary.length > 0 ? <pre className="tool-input">{summary}</pre> : null}
			{part.output === undefined ? null : <pre className="tool-output">{part.output}</pre>}
		</details>
	);
}

/** 一项渲染单元。分界项用一行文字,消息项按内容段排布。 */
function TranscriptRow({
	item,
	canFork,
	onFork,
}: {
	item: TranscriptItem;
	canFork: boolean;
	onFork: (messageId: string) => void;
}) {
	if (item.kind === "compaction" || item.kind === "branch") {
		const text = item.parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
		return (
			<div className="divider">
				{item.kind === "compaction" ? "上下文已压缩" : "分支摘要"}：{text.slice(0, 80)}
			</div>
		);
	}
	return (
		<article className={`message role-${item.role ?? "tool"} kind-${item.kind}`}>
			<div className="message-head">
				<span className="message-role">{item.kind === "error" ? "error" : (item.role ?? "tool")}</span>
				<span className="message-id">{item.id}</span>
				{item.isStreaming ? <span className="chip is-live">流式</span> : null}
				{item.entryId !== undefined || canFork ? (
					<button type="button" className="fork" onClick={() => onFork(item.id)}>
						从这里分叉
					</button>
				) : null}
			</div>
			{item.parts.length === 0 ? (
				<pre className="part-text">(无内容)</pre>
			) : (
				item.parts.map((part) => <PartBlock key={`${item.id}-${part.partId}`} part={part} />)
			)}
		</article>
	);
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

					{transcript.map((item) => (
						<TranscriptRow key={item.id} item={item} canFork={chat?.isRunning !== true} onFork={forkFrom} />
					))}
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
