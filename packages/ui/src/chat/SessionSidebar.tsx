/**
 * 会话侧栏。
 *
 * 三段内容：最近会话、本机项目、远程主机。会话按项目目录分组，项目与主机都能折叠。
 * 主机清单、项目位置选择只提供界面，远端读写接入前以占位数据呈现。
 */
import type { SessionSummary } from "@facet/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderIcon, MonitorIcon, PlusIcon, SearchIcon } from "../transcript/icons.tsx";
import {
	baseName,
	buildSidebar,
	filterProjects,
	type SidebarHost,
	type SidebarProject,
	type SidebarSession,
	shortenHome,
	shortTime,
} from "./sidebar-model.ts";

/** 侧栏参数。 */
export interface SessionSidebarProps {
	/** 当前设备的会话列表，已按时间倒序 */
	sessions: readonly SessionSummary[];
	/** 可连接的主机，第一项为当前设备 */
	hosts: readonly SidebarHost[];
	/** 当前会话的文件路径，没有打开会话时为空 */
	activeFile: string | undefined;
	/** 正在运行的会话文件路径 */
	runningFile: string | undefined;
	/** 新建会话落在的目录 */
	createCwd: string;
	/** 工作目录，显示在底部 */
	projectDir: string;
	/** 选择一条会话 */
	onSelect: (path: string) => void;
	/** 在指定目录新建会话 */
	onCreate: (cwd: string) => void;
	/** 新建是否可用，连接未就绪时不可用 */
	canCreate: boolean;
}

/** 最近会话最多显示的条数，点「全部」后放开。 */
const RECENT_LIMIT = 4;

/** 点击组件外部或按 Esc 时关闭浮层。 */
function useDismiss(ref: React.RefObject<HTMLElement | null>, isOpen: boolean, close: () => void): void {
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const node = ref.current;
			if (node !== null && event.target instanceof Node && node.contains(event.target)) {
				return;
			}
			close();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				close();
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [ref, isOpen, close]);
}

/** 会话标签：本机只写项目名，远端写成「主机:项目」。 */
function tagOf(session: SidebarSession): string {
	return session.host === undefined ? session.project : `${session.host}:${session.project}`;
}

/** 状态点：运行中带呼吸，连接中转为等待色，空闲与离线为空心。 */
type DotState = "running" | "idle" | "connecting" | "offline";

/** 状态点的样式类。 */
function dotClass(state: DotState): string {
	if (state === "running") {
		return "dot pulse";
	}
	if (state === "connecting") {
		return "dot is-warn pulse";
	}
	return "dot is-off";
}

/** 主机状态对应的点。 */
function hostDot(host: SidebarHost): DotState {
	if (host.state === "connected") {
		return "running";
	}
	return host.state === "connecting" ? "connecting" : "offline";
}

/** 主机行的状态说明。 */
function hostStatus(host: SidebarHost): string {
	if (host.state === "connected") {
		return host.latencyMs === undefined ? "已连接" : `已连接 · ${host.latencyMs}ms`;
	}
	return host.state === "connecting" ? "连接中…" : "离线";
}

export function SessionSidebar({
	sessions,
	hosts,
	activeFile,
	runningFile,
	createCwd,
	projectDir,
	onSelect,
	onCreate,
	canCreate,
}: SessionSidebarProps) {
	const data = useMemo(
		() => buildSidebar({ sessions, hosts, activeFile, activeCwd: createCwd, runningFile }),
		[sessions, hosts, activeFile, createCwd, runningFile],
	);

	const [keyword, setKeyword] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [showsAllRecents, setShowsAllRecents] = useState(false);
	const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
	const [isHostsOpen, setIsHostsOpen] = useState(false);
	const [isHostMenuOpen, setIsHostMenuOpen] = useState(false);
	const [isLocationOpen, setIsLocationOpen] = useState(false);
	const [locationKeyword, setLocationKeyword] = useState("");
	const [activeHostId, setActiveHostId] = useState<string | undefined>(data.remotes[0]?.id);

	const searchRef = useRef<HTMLInputElement>(null);
	const hostMenuRef = useRef<HTMLDivElement>(null);
	const locationRef = useRef<HTMLDivElement>(null);

	const closeHostMenu = useCallback(() => setIsHostMenuOpen(false), []);
	const closeLocation = useCallback(() => setIsLocationOpen(false), []);
	useDismiss(hostMenuRef, isHostMenuOpen, closeHostMenu);
	useDismiss(locationRef, isLocationOpen, closeLocation);

	// ⌘K 聚焦搜索，与提示的快捷键一致
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setIsSearchOpen(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		if (!isSearchOpen) {
			return;
		}
		const frame = requestAnimationFrame(() => searchRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [isSearchOpen]);

	const isSearching = keyword.trim().length > 0;
	const projects = isSearching ? filterProjects(data.projects, keyword) : data.projects;
	const recentPool = showsAllRecents ? data.recents : data.recents.slice(0, RECENT_LIMIT);
	const recents = isSearching
		? recentPool.filter((session) => session.title.toLowerCase().includes(keyword.trim().toLowerCase()))
		: recentPool;
	const activeHost = data.remotes.find((host) => host.id === activeHostId) ?? data.remotes[0];
	const targetName = baseName(createCwd);

	const isProjectOpen = (project: SidebarProject): boolean =>
		isSearching || (openProjects[project.cwd] ?? project.cwd === createCwd);

	const toggleProject = (project: SidebarProject): void => {
		setOpenProjects((current) => ({ ...current, [project.cwd]: !isProjectOpen(project) }));
	};

	const openSession = (session: SidebarSession): void => {
		if (session.isPlaceholder !== true) {
			onSelect(session.path);
		}
	};

	const sessionRow = (session: SidebarSession) => (
		<button
			type="button"
			key={session.path}
			className={session.path === activeFile ? "ps is-active" : "ps"}
			onClick={() => openSession(session)}
			disabled={session.isPlaceholder === true}
		>
			{session.isRunning ? <i className={dotClass("running")} /> : <span className="dot-space" />}
			<span className="ell">{session.title}</span>
			<span className="when">{shortTime(session.modified)}</span>
		</button>
	);

	const projectRow = (project: SidebarProject) => {
		const isOpen = isProjectOpen(project);

		return (
			<div key={project.cwd}>
				<button
					type="button"
					className={isOpen ? "pj is-open" : "pj t2"}
					onClick={() => toggleProject(project)}
					aria-expanded={isOpen}
				>
					<i className={isOpen ? "chev is-open" : "chev"} />
					<FolderIcon size={15} />
					<span className="ell">{project.name}</span>
					<span className="cnt">{project.sessions.length}</span>
				</button>
				{isOpen ? <div className="tree">{project.sessions.map(sessionRow)}</div> : null}
			</div>
		);
	};

	return (
		<aside className="sidebar">
			<div className="sb-head">
				<span className="sb-title">Facet</span>
				<span className="sb-head-right">
					<button
						type="button"
						className="sb-icon"
						aria-label="搜索会话与消息"
						onClick={() => setIsSearchOpen((open) => !open)}
					>
						<SearchIcon size={15} />
					</button>
					<span className="sb-hint">⌘B</span>
				</span>
			</div>

			<div className="nav-wrap" ref={locationRef}>
				<div className="nav is-primary">
					<button
						type="button"
						className="nav-main"
						onClick={() => onCreate(createCwd)}
						disabled={!canCreate}
					>
						<PlusIcon size={15} />
						新建会话
					</button>
					<button
						type="button"
						className="nav-pick"
						aria-label="选择新建位置"
						aria-haspopup="dialog"
						onClick={() => {
							setLocationKeyword("");
							setIsLocationOpen((open) => !open);
						}}
					>
						<span className="mono">{targetName}</span>
						<i className="chev is-open" />
					</button>
				</div>

				{isLocationOpen ? (
					<div className="card pop is-location" role="dialog" aria-label="选择新建位置">
						<label className="nav is-field pop-search">
							<SearchIcon size={14} />
							<input
								value={locationKeyword}
								onChange={(event) => setLocationKeyword(event.target.value)}
								placeholder="搜索项目…"
								aria-label="搜索项目"
							/>
						</label>
						<p className="sec is-tight">
							<span className="sec-row">
								<i className={dotClass("running")} />
								本机
							</span>
						</p>
						{filterProjects(data.projects, locationKeyword).map((project) => (
							<button
								type="button"
								key={project.cwd}
								className={project.cwd === createCwd ? "ps is-current" : "ps"}
								onClick={() => {
									onCreate(project.cwd);
									setIsLocationOpen(false);
								}}
							>
								<span className="ell">{project.name}</span>
								{project.cwd === createCwd ? <span>当前</span> : <span />}
							</button>
						))}
						{data.remotes.map((host) => (
							<div key={host.id}>
								<p className="sec is-tight">
									<span className="sec-row">
										<i className={dotClass(hostDot(host))} />
										{host.name}
									</span>
								</p>
								{host.state === "connected" ? (
									filterProjects(host.projects, locationKeyword).length === 0 ? (
										<div className="ps t3">
											<span className="ell">没有项目</span>
										</div>
									) : (
										filterProjects(host.projects, locationKeyword).map((project) => (
											<button
												type="button"
												key={project.cwd}
												className="ps t2"
												onClick={() => {
													onCreate(project.cwd);
													setIsLocationOpen(false);
												}}
												disabled={project.isPlaceholder === true}
											>
												<span className="ell">{project.name}</span>
												<span />
											</button>
										))
									)
								) : (
									<div className="ps t3">
										<span className="ell">
											{host.state === "connecting" ? "连接中，暂不可选" : "离线，无法新建"}
										</span>
									</div>
								)}
							</div>
						))}
					</div>
				) : null}
			</div>

			{isSearchOpen ? (
				<label className="nav is-field">
					<SearchIcon size={14} />
					<input
						ref={searchRef}
						value={keyword}
						onChange={(event) => setKeyword(event.target.value)}
						onBlur={() => {
							if (keyword.trim().length === 0) {
								setIsSearchOpen(false);
							}
						}}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								setKeyword("");
								setIsSearchOpen(false);
							}
						}}
						placeholder="搜索会话与消息"
						aria-label="搜索会话与消息"
					/>
					<span className="kbd mono">⌘K</span>
				</label>
			) : null}

			<div className="sb-body">
				<div className="sec">
					<span>最近</span>
					<button type="button" className="sec-act" onClick={() => setShowsAllRecents((show) => !show)}>
						{showsAllRecents ? "收起" : "全部"}
					</button>
				</div>

				<div className="recents">
					{recents.length === 0 ? <p className="ps t3">还没有会话</p> : null}
					{recents.map((session) => (
						<button
							type="button"
							key={`recent:${session.path}`}
							className={session.path === activeFile ? "rc is-active" : "rc"}
							onClick={() => openSession(session)}
							disabled={session.isPlaceholder === true}
						>
							<i className={`${dotClass(session.isRunning ? "running" : "idle")} rc-dot`} />
							<div className="rc-main">
								<b>{session.title}</b>
								<small>
									<span className="tag">
										{session.host === undefined ? null : <MonitorIcon size={10} />}
										{tagOf(session)}
									</span>
									<span>
										{session.isRunning ? "运行中 · " : ""}
										{shortTime(session.modified)}
									</span>
								</small>
							</div>
						</button>
					))}
				</div>

				<div className="sec">
					<span>项目</span>
					<button
						type="button"
						className="sec-icon"
						aria-label="添加项目"
						onClick={() => setIsLocationOpen(true)}
						disabled
					>
						<PlusIcon size={14} />
					</button>
				</div>

				<div className="projects">
					{projects.length === 0 ? <p className="ps t3">没有匹配的项目</p> : null}
					{projects.map(projectRow)}
				</div>

				{data.remotes.length > 0 ? (
					<div className="hosts">
						<div className="sec is-hosts">
							<button
								type="button"
								className="sec-toggle"
								onClick={() => setIsHostsOpen((open) => !open)}
								aria-expanded={isHostsOpen}
							>
								<i className={isHostsOpen ? "chev is-open" : "chev"} />
								远程主机
							</button>
							{isHostsOpen && activeHost ? (
								<div className="pop-wrap" ref={hostMenuRef}>
									<button
										type="button"
										className="hsel"
										aria-haspopup="listbox"
										aria-label="选择远程主机"
										onClick={() => setIsHostMenuOpen((open) => !open)}
									>
										<i className={dotClass(hostDot(activeHost))} />
										{activeHost.name}
										<i className="chev is-open t3" />
									</button>
									{isHostMenuOpen ? (
										<div className="card pop is-hosts" role="listbox" aria-label="远程主机">
											{data.remotes.map((host) => (
												<button
													type="button"
													key={host.id}
													className={host.id === activeHost.id ? "hr is-active" : "hr"}
													role="option"
													aria-selected={host.id === activeHost.id}
													onClick={() => {
														if (host.state === "offline") {
															return;
														}
														setActiveHostId(host.id);
														setIsHostMenuOpen(false);
													}}
													disabled={host.state === "offline"}
												>
													<i className={dotClass(hostDot(host))} />
													<div className="hr-main">
														<b className="ell">{host.name}</b>
														<span className={host.state === "offline" ? "t3" : "mono t3"}>
															{host.state === "offline"
																? `上次连接 ${host.lastSeen ?? "一段时间前"}`
																: host.detail}
														</span>
													</div>
													{host.state === "offline" ? (
														<span className="mini">重连</span>
													) : (
														<span className={`hr-state ${host.state}`}>{hostStatus(host)}</span>
													)}
												</button>
											))}
											<button type="button" className="nav is-new-host" disabled>
												<PlusIcon size={14} />
												连接新主机
											</button>
										</div>
									) : null}
								</div>
							) : (
								<span className="host-dots">
									{data.remotes.map((host) => (
										<i key={host.id} className={dotClass(hostDot(host))} />
									))}
								</span>
							)}
						</div>

						{isHostsOpen && activeHost ? (
							activeHost.state === "connected" ? (
								<div className="projects">
									{filterProjects(activeHost.projects, keyword).length === 0 ? (
										<p className="ps t3">这台主机还没有项目</p>
									) : (
										filterProjects(activeHost.projects, keyword).map(projectRow)
									)}
								</div>
							) : (
								<p className="ps t3">
									{activeHost.state === "connecting"
										? "正在连接…"
										: `离线 · ${activeHost.lastSeen ?? "一段时间前"}`}
								</p>
							)
						) : null}
					</div>
				) : null}
			</div>

			<div className="sidebar-foot">
				<span className="mono ell" title={projectDir}>
					{shortenHome(projectDir)}
				</span>
				<button type="button" className="foot-act" disabled title="尚未实现">
					设置
				</button>
			</div>
		</aside>
	);
}
