import { chatActivity, type DeviceHandshake, SessionClient, toTranscript } from "@facet/client-core";
import type { Maintenance, ProjectInfo, SessionSummary } from "@facet/protocol";
import { WsTransport } from "@facet/transport/ws";
import {
	ArrowDownIcon,
	ChatTranscript,
	Composer,
	CreateProjectDialog,
	SessionSidebar,
	type SidebarHost,
	samePath,
	type ThemeName,
	useStickToBottom,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PLACEHOLDER_HOSTS } from "./placeholder-hosts";

/** 预加载脚本注入的启动参数 */
interface FacetBridge {
	endpoint: string;
	projectDir: string;
	platform: string;
	/** 打开系统的目录选择窗口,取消时返回空 */
	pickDirectory: () => Promise<string | undefined>;
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

/** 主题在本地保存键 */
const THEME_KEY = "facet.theme";

/** 等重试期间给对话面板的提示,其余维护动作不显示。 */
function retryOf(maintenance: Maintenance | undefined): { attempt: number; maxAttempts: number } | undefined {
	return maintenance?.kind === "retry"
		? { attempt: maintenance.attempt, maxAttempts: maintenance.maxAttempts }
		: undefined;
}

/** 读取上次选择的主题，缺省深色 */
function readTheme(): ThemeName {
	return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

/** 启动时打开的会话：启动目录里最近更新的一条，没有则取全部会话里最近的一条。 */
function pickStartupSession(
	sessions: readonly SessionSummary[],
	projectDir: string,
): SessionSummary | undefined {
	let scoped: SessionSummary | undefined;
	let newest: SessionSummary | undefined;
	for (const session of sessions) {
		if (newest === undefined || session.modified > newest.modified) {
			newest = session;
		}
		if (!samePath(session.cwd, projectDir)) {
			continue;
		}
		if (scoped === undefined || session.modified > scoped.modified) {
			scoped = session;
		}
	}
	return scoped ?? newest;
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
	const [device, setDevice] = useState<DeviceHandshake | undefined>(undefined);
	const [projects, setProjects] = useState<readonly ProjectInfo[]>([]);
	const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
	const [createCwd, setCreateCwd] = useState(bridge.projectDir);
	const [draft, setDraft] = useState("");
	const [theme, setTheme] = useState<ThemeName>(readTheme);
	const started = useRef(false);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		localStorage.setItem(THEME_KEY, theme);
	}, [theme]);

	const listSeq = useRef(0);

	/** 拉一次全部会话。并发调用时只采用最后一次的结果,避免旧结果覆盖新结果。 */
	const refreshSessions = useCallback(async (): Promise<readonly SessionSummary[] | undefined> => {
		listSeq.current += 1;
		const seq = listSeq.current;
		try {
			const pool = await client.listSessions();
			if (seq === listSeq.current) {
				setSessions(pool);
			}
			return pool;
		} catch {
			// 列表刷新失败时保留已显示的会话,其他项目的历史不因此消失
			return undefined;
		}
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
			setProjects(await client.listProjects());
			const pool = (await refreshSessions()) ?? [];
			const newest = pickStartupSession(pool, bridge.projectDir);
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
		// 草稿留到设备把这条消息放进对话再收,发送被拒时不用重打
		client.send(text);
	}, [draft]);

	useEffect(() => {
		return client.onSent((text) => {
			// 只收掉刚发出的那段,等待期间新输入的内容保留
			setDraft((current) => (current.trim() === text ? "" : current));
		});
	}, []);

	/**
	 * 回退到某条用户消息之前:从那一轮末尾分出新会话并切过去,把这条消息的文本放回输入框。
	 *
	 * pi 的会话文件只追加,回退靠分叉实现,原会话保持不动。
	 */
	const revertTo = useCallback(
		(entryId: string, text: string) => {
			void client.fork(entryId).then(async (forked) => {
				setActiveFile(forked.file);
				setDraft(text);
				await refreshSessions();
			});
		},
		[refreshSessions],
	);

	const createProject = useCallback(
		async (input: { cwd: string; name: string | undefined }) => {
			const created = await client.addProject({
				cwd: input.cwd,
				...(input.name === undefined ? {} : { name: input.name }),
			});
			setProjects(await client.listProjects());
			setCreateCwd(created.cwd);
			await refreshSessions();
		},
		[refreshSessions],
	);

	const forkTurn = useCallback(
		(beforeEntryId: string | undefined) => {
			void client.fork(beforeEntryId).then(async (forked) => {
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

	// 对话此刻的状态由会话状态与中止请求合并得出,界面不自己拼布尔量
	const activity = chatActivity(session);
	const canFork = activity === "idle" && session?.state.maintenance === undefined;

	return (
		<div className="shell">
			<SessionSidebar
				sessions={sessions}
				hosts={hosts}
				projects={projects}
				activeFile={activeFile}
				runningFile={activity === "idle" ? undefined : activeFile}
				createCwd={createCwd}
				theme={theme}
				onSelect={(path) => void openSession(path)}
				onCreate={(cwd) => {
					setCreateCwd(cwd);
					void createSession(cwd);
				}}
				canCreate={phase === "ready"}
				onAddProject={() => setIsProjectDialogOpen(true)}
				onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
			/>

			<main className="main">
				<section className="scroll" ref={scrollRef}>
					<div className="column">
						<ChatTranscript
							items={transcript}
							canFork={canFork}
							onFork={forkTurn}
							canRevert={canFork}
							onRevert={revertTo}
							retry={retryOf(session?.state.maintenance)}
							renames={chat?.renames}
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
							activity={activity}
							model={session?.state.model}
							thinkingLevel={session?.state.thinkingLevel}
						/>

						{chat && chat.notices.length > 0 ? (
							<div className="notices">
								{chat.notices.map((notice) => (
									<span
										key={`${notice.level}:${notice.message}`}
										className={notice.level === "error" ? "chip is-error" : "chip"}
									>
										{notice.message}
									</span>
								))}
							</div>
						) : null}
					</div>
				</div>
			</main>

			<CreateProjectDialog
				isOpen={isProjectDialogOpen}
				onPickFolder={() => window.facet.pickDirectory()}
				onCreate={createProject}
				onClose={() => setIsProjectDialogOpen(false)}
			/>
		</div>
	);
}
