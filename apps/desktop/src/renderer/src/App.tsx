import { type DeviceHandshake, SessionClient, toTranscript } from "@facet/client-core";
import type { SessionSummary } from "@facet/protocol";
import { WsTransport } from "@facet/transport/ws";
import {
	ArrowDownIcon,
	ChatTranscript,
	Composer,
	SessionSidebar,
	type SidebarHost,
	useStickToBottom,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PLACEHOLDER_HOSTS } from "./placeholder-hosts";

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
const client = new SessionClient({ transport, pageSize: 200 });

type Phase = "connecting" | "ready" | "failed";

export function App() {
	const version = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => client.store.getVersion(),
	);
	const [phase, setPhase] = useState<Phase>("connecting");
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
	const [activeFile, setActiveFile] = useState<string | undefined>(undefined);
	const [device, setDevice] = useState<DeviceHandshake | undefined>(undefined);
	const [createCwd, setCreateCwd] = useState(bridge.projectDir);
	const [draft, setDraft] = useState("");
	const started = useRef(false);

	const listSeq = useRef(0);

	/** 拉一次会话列表。并发调用时只采用最后一次的结果,避免旧结果覆盖新结果。 */
	const refreshSessions = useCallback(async () => {
		listSeq.current += 1;
		const seq = listSeq.current;
		const scoped = await client.listSessions(bridge.projectDir);
		const pool = scoped.length > 0 ? scoped : await client.listSessions();
		if (seq === listSeq.current) {
			setSessions(pool);
		}
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
			setDevice(handshake);
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

	const openSession = useCallback(async (path: string) => {
		await client.release();
		await client.openSession(path);
		setActiveFile(path);
	}, []);

	const createSession = useCallback(
		async (cwd: string) => {
			await client.release();
			const opened = await client.createSession({ ...(cwd.length > 0 ? { cwd } : {}) });
			setActiveFile(opened.file);
			await refreshSessions();
		},
		[refreshSessions],
	);

	const send = useCallback(() => {
		const text = draft.trim();
		if (text.length === 0) {
			return;
		}
		setDraft("");
		client.send(text);
	}, [draft]);

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
	const { scrollRef, isPinned, scrollToBottom } = useStickToBottom(transcript, activeFile);

	const hosts = useMemo<readonly SidebarHost[]>(() => {
		const local: SidebarHost = {
			id: device?.hostId ?? "local",
			name: device?.hostName ?? "本机",
			detail: bridge.endpoint,
			state: "connected",
			isLocal: true,
			projects: [],
		};
		return [local, ...PLACEHOLDER_HOSTS];
	}, [device]);

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
				hosts={hosts}
				activeFile={activeFile}
				runningFile={chat?.isRunning === true ? activeFile : undefined}
				createCwd={createCwd}
				onSelect={(path) => void openSession(path)}
				onCreate={(cwd) => {
					setCreateCwd(cwd);
					void createSession(cwd);
				}}
				canCreate={phase === "ready"}
			/>

			<main className="main">
				<section className="scroll" ref={scrollRef}>
					<div className="column">
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
					{isPinned ? null : (
						<button
							type="button"
							className="to-bottom"
							aria-label="回到底部"
							onClick={() => scrollToBottom("smooth")}
						>
							<ArrowDownIcon size={16} />
						</button>
					)}
					<div className="footer-column">
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
