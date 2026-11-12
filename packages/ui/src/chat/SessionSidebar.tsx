/**
 * 会话侧栏。
 *
 * 自上而下四块：标题与全局操作、新建会话、项目过滤器、会话队列；底部是页脚。
 * 项目过滤器同时决定队列的范围与新建会话的目录，队列按时间分组，分组规则见 sidebar-model。
 */
import type { ProjectInfo, SessionSummary } from "@facet/protocol";
import { FolderPlus, PanelRight, Plus, Search, Settings } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { FolderIcon, MoonIcon, SunIcon } from "../transcript/icons.tsx";
import {
	baseName,
	buildSidebar,
	type SessionDot,
	type SidebarProject,
	type SidebarSession,
	samePath,
	shortTime,
} from "./sidebar-model.ts";

/** 界面主题。切换写入根节点的 data-theme，样式按此选择变量组。 */
export type ThemeName = "dark" | "light";

/** 侧栏参数。 */
export interface SessionSidebarProps {
	/** 当前主机的会话列表，已按时间倒序 */
	sessions: readonly SessionSummary[];
	/** 主机清单，第一项为当前主机 */
	/** 用户添加的项目 */
	projects: readonly ProjectInfo[];
	/** 当前会话的文件路径，没有打开会话时为空 */
	activeFile: string | undefined;
	/** 正在运行的会话文件路径 */
	runningFile: string | undefined;
	/** 这个会话此刻的状态点：运行中或压缩中 */
	runningDot?: SessionDot | undefined;
	/** 没有选中项目时新建会话落在的目录 */
	createCwd: string;
	/** 当前主题 */
	theme: ThemeName;
	/** 选择一条会话 */
	onSelect: (path: string) => void;
	/** 在指定目录新建会话 */
	onCreate: (cwd: string) => void;
	/** 新建是否可用，连接未就绪时不可用 */
	canCreate: boolean;
	/** 打开添加项目 */
	onAddProject: () => void;
	/** 项目列表上一次刷新失败，过滤器里给出重试入口 */
	isProjectsStale?: boolean;
	/** 重新拉取项目列表 */
	onRefreshProjects?: () => void;
	/** 重命名项目，名称为空时恢复目录名，失败时抛错 */
	onRenameProject?: (id: string, name: string | undefined) => Promise<void>;
	/** 移除项目，失败时抛错 */
	onRemoveProject?: (id: string) => Promise<void>;
	/** 在主机的文件管理器里打开项目目录，失败时抛错 */
	onRevealProject?: (id: string) => Promise<void>;
	/** 会话改名，失败时抛错 */
	onRenameSession?: (path: string, name: string | undefined) => Promise<void>;
	/** 删除会话，失败时抛错 */
	onDeleteSession?: (path: string) => Promise<void>;
	/** 切换深浅色 */
	onToggleTheme: () => void;
	/** 打开设置页 */
	onOpenSettings?: () => void;
	/** 当前是否停在设置页 */
	isSettingsOpen?: boolean;
	/** 切换右侧栏展开与收起 */
	onTogglePanel?: () => void;
	/** 右侧栏是否展开 */
	isPanelOpen?: boolean;
	/** 页脚的主机切换入口，由宿主给出 */
	hostSwitcher?: ReactNode;
	/** 当前主机名，显示在页脚右侧 */
	hostName?: string;
}

/** 会话行状态点的样式类。运行中与压缩中都走运行色，前者呼吸，后者常亮。 */
function dotClass(dot: SessionDot): string {
	if (dot === "running") {
		return "dot is-run pulse";
	}
	return dot === "compacting" ? "dot is-run" : "dot is-off";
}

/** 点击组件外部时关闭浮层，点击触发器本身不算外部。 */
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
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [ref, isOpen, close]);
}

export function SessionSidebar({
	sessions,
	projects: storedProjects,
	activeFile,
	runningFile,
	runningDot,
	createCwd,
	theme,
	onSelect,
	onCreate,
	canCreate,
	onAddProject,
	isProjectsStale = false,
	onRefreshProjects,
	onRenameProject,
	onRemoveProject,
	onRevealProject,
	onRenameSession,
	onDeleteSession,
	onToggleTheme,
	onOpenSettings,
	isSettingsOpen = false,
	onTogglePanel,
	isPanelOpen = false,
	hostSwitcher,
	hostName,
}: SessionSidebarProps) {
	const [keyword, setKeyword] = useState("");
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [projectKeyword, setProjectKeyword] = useState("");
	const [isFilterOpen, setIsFilterOpen] = useState(false);
	const [isFilterUp, setIsFilterUp] = useState(false);
	/** 用户在过滤器里选过的目录，未选过时跟随当前会话 */
	const [pickedCwd, setPickedCwd] = useState<string | undefined>(undefined);
	/** 过滤器是否切到全部项目 */
	const [showsAll, setShowsAll] = useState(false);
	/** 展开了操作面板的项目标识 */
	const [menuId, setMenuId] = useState<string | undefined>(undefined);
	/** 正在改名的项目与输入中的名字 */
	const [renaming, setRenaming] = useState<{ id: string; value: string } | undefined>(undefined);
	/** 正在确认移除的项目标识 */
	const [removingId, setRemovingId] = useState<string | undefined>(undefined);
	/** 项目操作进行中，期间不接受重复提交 */
	const [isProjectBusy, setIsProjectBusy] = useState(false);
	/** 项目操作失败的提示，显示在操作面板里 */
	const [projectError, setProjectError] = useState<string | undefined>(undefined);
	/** 展开了操作面板的会话文件 */
	const [sessionMenuPath, setSessionMenuPath] = useState<string | undefined>(undefined);
	/** 正在改名的会话与输入中的名字 */
	const [sessionRename, setSessionRename] = useState<{ path: string; value: string } | undefined>(undefined);
	/** 正在确认删除的会话文件 */
	const [sessionDeletePath, setSessionDeletePath] = useState<string | undefined>(undefined);
	/** 会话操作进行中 */
	const [isSessionBusy, setIsSessionBusy] = useState(false);
	/** 会话操作失败的提示 */
	const [sessionMenuError, setSessionMenuError] = useState<string | undefined>(undefined);

	const filterRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const projectSearchRef = useRef<HTMLInputElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	const activeCwd = sessions.find((session) => session.path === activeFile)?.cwd;
	const scopeCwd = showsAll ? undefined : (pickedCwd ?? activeCwd);

	const data = useMemo(
		() =>
			buildSidebar({
				sessions,
				projects: storedProjects,
				runningFile,
				runningDot,
				projectCwd: scopeCwd,
				keyword,
			}),
		[sessions, storedProjects, runningFile, runningDot, scopeCwd, keyword],
	);

	const currentProject: SidebarProject | undefined =
		scopeCwd === undefined ? undefined : data.projects.find((item) => samePath(item.cwd, scopeCwd));
	const filterLabel = currentProject?.name ?? (scopeCwd === undefined ? "全部项目" : baseName(scopeCwd));
	const filterCount = currentProject?.sessionCount ?? data.total;
	const newSessionCwd = scopeCwd ?? createCwd;

	const projectMatches = useMemo(() => {
		const query = projectKeyword.trim().toLowerCase();
		if (query.length === 0) {
			return data.projects;
		}
		return data.projects.filter(
			(project) => project.name.toLowerCase().includes(query) || project.cwd.toLowerCase().includes(query),
		);
	}, [data.projects, projectKeyword]);

	const closeFilter = useCallback((restoreFocus: boolean) => {
		setIsFilterOpen(false);
		setMenuId(undefined);
		setRenaming(undefined);
		setRemovingId(undefined);
		setProjectError(undefined);
		if (restoreFocus) {
			triggerRef.current?.focus();
		}
	}, []);

	const dismissFilter = useCallback(() => closeFilter(false), [closeFilter]);
	useDismiss(filterRef, isFilterOpen, dismissFilter);

	// ⌘K 聚焦会话搜索，与页脚提示的快捷键一致
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

	// 浮层打开时量一次可用空间：下方放不下且上方更宽裕就向上弹出，焦点移进搜索框
	useEffect(() => {
		if (!isFilterOpen) {
			return;
		}
		const trigger = triggerRef.current;
		const panel = panelRef.current;
		if (trigger !== null && panel !== null) {
			const rect = trigger.getBoundingClientRect();
			const below = window.innerHeight - rect.bottom;
			const above = rect.top;
			setIsFilterUp(below < Math.min(panel.scrollHeight + 12, 320) && above > below);
		}
		const frame = requestAnimationFrame(() => projectSearchRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [isFilterOpen]);

	/** 浮层内循环焦点，打开期间不把焦点交给对话框之外。 */
	const trapFocus = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				closeFilter(true);
				return;
			}
			if (event.key !== "Tab") {
				return;
			}
			const panel = panelRef.current;
			if (panel === null) {
				return;
			}
			const items = [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), input")].filter(
				(element) => element.offsetParent !== null,
			);
			const first = items[0];
			const last = items[items.length - 1];
			if (first === undefined || last === undefined) {
				return;
			}
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
				return;
			}
			if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		},
		[closeFilter],
	);

	const selectProject = (cwd: string | undefined): void => {
		setPickedCwd(cwd);
		setShowsAll(cwd === undefined);
		setIsFilterOpen(false);
		setMenuId(undefined);
		setProjectKeyword("");
		triggerRef.current?.focus();
	};

	/**
	 * 跑一次项目操作。
	 *
	 * 失败时把错误留在操作面板里，面板与列表都不动；成功后收起面板。
	 */
	const runProjectAction = async (work: () => Promise<void>): Promise<void> => {
		setIsProjectBusy(true);
		setProjectError(undefined);
		try {
			await work();
			setMenuId(undefined);
			setRenaming(undefined);
			setRemovingId(undefined);
		} catch (error) {
			setProjectError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsProjectBusy(false);
		}
	};

	/** 收起会话操作面板并清掉其中的临时状态。 */
	const closeSessionMenu = (): void => {
		setSessionMenuPath(undefined);
		setSessionRename(undefined);
		setSessionDeletePath(undefined);
		setSessionMenuError(undefined);
	};

	/** 跑一次会话操作，失败时把错误留在面板里。 */
	const runSessionMenuAction = async (work: () => Promise<void>): Promise<void> => {
		setIsSessionBusy(true);
		setSessionMenuError(undefined);
		try {
			await work();
			closeSessionMenu();
		} catch (error) {
			setSessionMenuError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsSessionBusy(false);
		}
	};

	const submitSessionRename = async (): Promise<void> => {
		const target = sessionRename;
		if (target === undefined) {
			return;
		}
		const trimmed = target.value.trim();
		await runSessionMenuAction(async () => {
			await onRenameSession?.(target.path, trimmed.length > 0 ? trimmed : undefined);
		});
	};

	const submitRename = async (cwd: string): Promise<void> => {
		const target = renaming;
		if (target === undefined) {
			return;
		}
		const trimmed = target.value.trim();
		await runProjectAction(async () => {
			await onRenameProject?.(target.id, trimmed.length > 0 ? trimmed : undefined);
		});
		// 改名后过滤器上的名字跟着变，当前范围保持在这个目录
		setPickedCwd(cwd);
	};

	const openSession = (session: SidebarSession): void => {
		if (session.isPlaceholder !== true) {
			onSelect(session.path);
		}
	};

	const isSearching = keyword.trim().length > 0;
	const emptyHint = isSearching
		? "没有匹配的会话"
		: scopeCwd === undefined
			? "还没有会话"
			: "这个项目还没有会话";

	return (
		<aside className="sb">
			<header className="sb-head">
				<span className="sb-title">Facet</span>
				<span className="sb-tools">
					<button
						type="button"
						className="sb-tool"
						aria-label="搜索会话"
						aria-pressed={isSearchOpen}
						onClick={() => {
							setIsSearchOpen((open) => {
								if (open) {
									setKeyword("");
								}
								return !open;
							});
						}}
					>
						<Search size={15} strokeWidth={1.5} />
					</button>
					<button type="button" className="sb-tool" aria-label="添加项目" onClick={onAddProject}>
						<FolderPlus size={15} strokeWidth={1.5} />
					</button>
					{onTogglePanel === undefined ? null : (
						<button
							type="button"
							className="sb-tool"
							aria-label={isPanelOpen ? "收起右侧栏" : "展开右侧栏"}
							aria-pressed={isPanelOpen}
							onClick={onTogglePanel}
						>
							<PanelRight size={15} strokeWidth={1.5} />
						</button>
					)}
				</span>
			</header>

			<button
				type="button"
				className="sb-new"
				onClick={() => onCreate(newSessionCwd)}
				disabled={!canCreate || newSessionCwd.length === 0}
				title={newSessionCwd.length === 0 ? "先添加项目" : `在 ${newSessionCwd} 新建`}
			>
				<Plus size={14} strokeWidth={1.5} />
				新建会话
			</button>

			<div className="sb-filter" ref={filterRef}>
				<button
					type="button"
					ref={triggerRef}
					className={isFilterOpen ? "sb-filter-btn is-open" : "sb-filter-btn"}
					aria-haspopup="dialog"
					aria-expanded={isFilterOpen}
					onClick={() => setIsFilterOpen((open) => !open)}
				>
					<FolderIcon size={14} />
					<span className="sb-filter-name ell">{filterLabel}</span>
					<span className="sb-filter-meta mono">{filterCount}</span>
					<ChevronIcon isOpen={isFilterOpen} />
				</button>

				{isFilterOpen ? (
					<div
						ref={panelRef}
						className={isFilterUp ? "sb-pop is-up" : "sb-pop"}
						role="dialog"
						aria-label="选择项目"
						onKeyDown={trapFocus}
					>
						<label className="sb-search">
							<Search size={13} strokeWidth={1.5} />
							<input
								ref={projectSearchRef}
								value={projectKeyword}
								onChange={(event) => setProjectKeyword(event.target.value)}
								placeholder="搜索项目"
								aria-label="搜索项目"
							/>
						</label>
						<div className="sb-opts">
							<button
								type="button"
								className={scopeCwd === undefined ? "sb-opt is-on" : "sb-opt"}
								aria-pressed={scopeCwd === undefined}
								onClick={() => selectProject(undefined)}
							>
								<span className="sb-opt-name ell">全部项目</span>
								<span className="sb-opt-meta mono">{data.total}</span>
							</button>
							{projectMatches.map((project) => {
								const isOn = !showsAll && scopeCwd !== undefined && samePath(project.cwd, scopeCwd);
								// 操作面板只对添加过的项目开放，会话目录里顺带出现的目录没有可改的记录
								const canManage = project.id !== undefined && project.host === undefined;
								const isMenuOpen = canManage && menuId === project.id;
								return (
									<div key={project.cwd} className="sb-opt-item">
										<div className="sb-opt-row">
											<button
												type="button"
												className={isOn ? "sb-opt is-on" : "sb-opt"}
												aria-pressed={isOn}
												title={project.cwd}
												onClick={() => selectProject(project.cwd)}
											>
												<FolderIcon size={13} />
												<span className="sb-opt-name ell">{project.name}</span>
												<span className="sb-opt-meta mono">{project.sessionCount}</span>
											</button>
											{canManage ? (
												<button
													type="button"
													className="sb-opt-more"
													aria-label="项目操作"
													aria-expanded={isMenuOpen}
													onClick={() => {
														setProjectError(undefined);
														setRenaming(undefined);
														setRemovingId(undefined);
														setMenuId(isMenuOpen ? undefined : project.id);
													}}
												>
													⋯
												</button>
											) : null}
										</div>

										{isMenuOpen ? (
											<div className="sb-opt-menu">
												{renaming === undefined ? null : (
													<label className="sb-rename">
														<input
															className="sb-rename-input"
															value={renaming.value}
															onChange={(event) =>
																setRenaming({ id: renaming.id, value: event.target.value })
															}
															onKeyDown={(event) => {
																if (event.key === "Enter") {
																	void submitRename(project.cwd);
																}
																if (event.key === "Escape") {
																	setRenaming(undefined);
																}
															}}
															placeholder="项目名称"
															aria-label="项目名称"
														/>
														<button
															type="button"
															className="sb-opt-action"
															disabled={isProjectBusy}
															onClick={() => void submitRename(project.cwd)}
														>
															保存
														</button>
													</label>
												)}

												{removingId === project.id ? (
													<div className="sb-confirm">
														<span className="sb-confirm-text">移除后会话文件保留,项目可以重新添加</span>
														<div className="sb-confirm-actions">
															<button
																type="button"
																className="sb-opt-action is-danger"
																disabled={isProjectBusy}
																onClick={() => {
																	const id = project.id;
																	if (id === undefined) {
																		return;
																	}
																	void runProjectAction(async () => {
																		await onRemoveProject?.(id);
																		// 移除的正好是当前范围时退回全部项目
																		if (scopeCwd !== undefined && samePath(project.cwd, scopeCwd)) {
																			setPickedCwd(undefined);
																			setShowsAll(true);
																		}
																	});
																}}
															>
																移除
															</button>
															<button
																type="button"
																className="sb-opt-action"
																onClick={() => setRemovingId(undefined)}
															>
																取消
															</button>
														</div>
													</div>
												) : (
													<div className="sb-menu-actions">
														<button
															type="button"
															className="sb-menu-item"
															onClick={() => setRenaming({ id: project.id ?? "", value: project.name })}
														>
															重命名
														</button>
														<button
															type="button"
															className="sb-menu-item"
															disabled={isProjectBusy}
															onClick={() =>
																void runProjectAction(async () => onRevealProject?.(project.id ?? ""))
															}
														>
															在文件管理器中打开
														</button>
														<button
															type="button"
															className="sb-menu-item is-danger"
															onClick={() => setRemovingId(project.id)}
														>
															移除
														</button>
													</div>
												)}

												{projectError === undefined ? null : <p className="sb-menu-error">{projectError}</p>}
											</div>
										) : null}
									</div>
								);
							})}
							{projectMatches.length === 0 ? <p className="sb-opt-empty">没有匹配的项目</p> : null}
							{isProjectsStale ? (
								<div className="sb-opt-stale">
									<span className="sb-opt-name ell">项目列表没刷新成功</span>
									<button type="button" className="sb-opt-action" onClick={() => onRefreshProjects?.()}>
										刷新
									</button>
								</div>
							) : null}
						</div>
						<button
							type="button"
							className="sb-opt is-add"
							onClick={() => {
								closeFilter(true);
								onAddProject();
							}}
						>
							<Plus size={13} strokeWidth={1.5} />
							<span className="sb-opt-name">添加项目</span>
						</button>
					</div>
				) : null}
			</div>

			{isSearchOpen ? (
				<label className="sb-search is-inline">
					<Search size={13} strokeWidth={1.5} />
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
						placeholder="搜索会话"
						aria-label="搜索会话"
					/>
					<span className="kbd mono">⌘K</span>
				</label>
			) : null}

			<div className="sb-queue">
				{data.groups.length === 0 ? <p className="sb-empty">{emptyHint}</p> : null}
				{data.groups.map((group) => (
					<section key={group.key} className="sb-group">
						<h2 className="sb-group-head">
							<span>{group.label}</span>
							<span className="mono">{group.sessions.length}</span>
						</h2>
						{group.sessions.map((session) => {
							const isMenuOpen = sessionMenuPath === session.path;
							const isRenaming = isMenuOpen && sessionRename !== undefined;
							return (
								<div key={session.path} className="sb-row-item">
									<div className="sb-row-wrap">
										<button
											type="button"
											className={session.path === activeFile ? "sb-row is-active" : "sb-row"}
											aria-current={session.path === activeFile}
											onClick={() => openSession(session)}
											disabled={session.isPlaceholder === true}
											title={session.title}
										>
											<i className={dotClass(session.dot)} />
											<span className="sb-row-title ell">{session.title}</span>
											{scopeCwd === undefined && session.host === undefined ? (
												<span className="sb-row-proj ell">{session.project}</span>
											) : null}
											<span className="sb-row-time mono">{shortTime(session.modified)}</span>
										</button>
										<button
											type="button"
											className="sb-row-more"
											aria-label="会话操作"
											aria-expanded={isMenuOpen}
											onClick={() => {
												setSessionMenuError(undefined);
												setSessionRename(undefined);
												setSessionDeletePath(undefined);
												setSessionMenuPath(isMenuOpen ? undefined : session.path);
											}}
										>
											⋯
										</button>
									</div>

									{isMenuOpen ? (
										<div className="sb-opt-menu">
											{isRenaming ? (
												<label className="sb-rename">
													<input
														className="sb-rename-input"
														value={sessionRename.value}
														onChange={(event) =>
															setSessionRename({ path: sessionRename.path, value: event.target.value })
														}
														onKeyDown={(event) => {
															if (event.key === "Enter") {
																void submitSessionRename();
															}
															if (event.key === "Escape") {
																setSessionRename(undefined);
															}
														}}
														placeholder="会话名称"
														aria-label="会话名称"
													/>
													<button
														type="button"
														className="sb-opt-action"
														disabled={isSessionBusy}
														onClick={() => void submitSessionRename()}
													>
														保存
													</button>
												</label>
											) : sessionDeletePath === session.path ? (
												<div className="sb-confirm">
													<span className="sb-confirm-text">删除后会话文件不可恢复</span>
													<div className="sb-confirm-actions">
														<button
															type="button"
															className="sb-opt-action is-danger"
															disabled={isSessionBusy}
															onClick={() =>
																void runSessionMenuAction(async () => {
																	await onDeleteSession?.(session.path);
																})
															}
														>
															删除
														</button>
														<button
															type="button"
															className="sb-opt-action"
															onClick={() => setSessionDeletePath(undefined)}
														>
															取消
														</button>
													</div>
												</div>
											) : (
												<div className="sb-menu-actions">
													<button
														type="button"
														className="sb-menu-item"
														onClick={() => setSessionRename({ path: session.path, value: session.title })}
													>
														重命名
													</button>
													<button
														type="button"
														className="sb-menu-item is-danger"
														onClick={() => setSessionDeletePath(session.path)}
													>
														删除
													</button>
												</div>
											)}

											{sessionMenuError === undefined ? null : (
												<p className="sb-menu-error">{sessionMenuError}</p>
											)}
										</div>
									) : null}
								</div>
							);
						})}
					</section>
				))}
			</div>

			<footer className="sb-foot">
				{hostSwitcher}
				<button
					type="button"
					className={isSettingsOpen ? "sb-foot-btn is-icon is-on" : "sb-foot-btn is-icon"}
					aria-label="设置"
					title="设置"
					aria-pressed={isSettingsOpen}
					onClick={() => onOpenSettings?.()}
				>
					<Settings size={14} strokeWidth={1.5} />
				</button>
				<button
					type="button"
					className="sb-foot-btn is-icon"
					aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
					title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
					onClick={onToggleTheme}
				>
					{theme === "dark" ? <SunIcon size={14} /> : <MoonIcon size={14} />}
				</button>
				<span className="sb-foot-hint">{hostName ?? "本机"}</span>
			</footer>
		</aside>
	);
}
