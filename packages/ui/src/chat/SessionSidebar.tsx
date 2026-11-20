/**
 * 会话侧栏。
 *
 * 自上而下四块：标题与全局操作、新建会话、项目过滤器、会话队列；底部是页脚。
 * 项目过滤器同时决定队列的范围与新建会话的目录，队列按时间分组，分组规则见 sidebar-model。
 */
import type { ProjectInfo, SessionStatus, SessionSummary } from "@facet/protocol";
import { Plus, Search, Settings } from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea, ScrollRow } from "../common/scroll-area.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { PaneResizer } from "../panel/pane-resizer.tsx";
import { useHoverTip } from "../tip.tsx";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { FolderIcon } from "../transcript/icons.tsx";
import { SessionStatusMark } from "./session-status-mark.tsx";
import { SidebarHeader } from "./sidebar-header.tsx";
import {
	baseName,
	buildSidebar,
	type SidebarProject,
	type SidebarSession,
	samePath,
} from "./sidebar-model.ts";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./sidebar-state.ts";

/** 侧栏参数。 */
export interface SessionSidebarProps {
	/** 当前主机的会话列表，已按时间倒序 */
	sessions: readonly SessionSummary[];
	/** 主机清单，第一项为当前主机 */
	/** 用户添加的项目 */
	projects: readonly ProjectInfo[];
	/** 当前会话的文件路径，没有打开会话时为空 */
	activeFile: string | undefined;
	/** 各会话此刻的活动状态，按会话文件路径索引 */
	statuses: ReadonlyMap<string, SessionStatus>;
	/** 没有选中项目时新建会话落在的目录 */
	createCwd: string;
	/** 选择一条会话 */
	onSelect: (path: string) => void;
	/** 在指定目录新建会话 */
	onCreate: (cwd: string) => void;
	/** 新建是否可用，连接未就绪时不可用 */
	canCreate: boolean;
	/** 打开添加项目 */
	onAddProject: () => void;
	/** 头部是否画在自己身上；窄屏抽屉里要自己带一份，宽屏时头部在外壳顶带里 */
	showHeader?: boolean;
	/** 会话搜索浮窗是否展开，头部按它标 aria-expanded */
	isSearchOpen?: boolean;
	/** 打开会话搜索浮窗；窄屏抽屉里点搜索会顺手收起抽屉 */
	onOpenSearch?: (() => void) | undefined;
	/** 宽度，单位 px；给了才带右缘那条可拖动的分隔条 */
	width?: number | undefined;
	/** 拖动分隔条后提交新宽度 */
	onWidthChange?: ((width: number) => void) | undefined;
	/** 分隔条此刻能拖到的最大宽度；不给用 `SIDEBAR_MAX_WIDTH`。中档按空间预算给出 */
	maxWidth?: number | undefined;
	/** 拖动开始与结束的提示，外壳用它在拖动期间锁住折叠 */
	onDraggingChange?: ((dragging: boolean) => void) | undefined;
	/** 收起侧栏；给了头部才显示收起按钮 */
	onCollapse?: (() => void) | undefined;
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
	/** 在系统里打开会话所在的工作目录 */
	onRevealSessionFolder?: (cwd: string) => Promise<void>;
	/** 会话改名，失败时抛错 */
	onRenameSession?: (path: string, name: string | undefined) => Promise<void>;
	/** 删除会话，失败时抛错 */
	onDeleteSession?: (path: string) => Promise<void>;
	/** 打开设置页 */
	onOpenSettings?: () => void;
	/** 当前是否停在设置页 */
	isSettingsOpen?: boolean;
	/** 切换右侧栏展开与收起 */
	/** 右侧栏是否展开 */
	/** 页脚的主机切换入口，由宿主给出 */
	hostSwitcher?: ReactNode;
	/** 连接状态提示，例如「重连中」或「只读」 */
	hostStatus?: string;
	/** 窄屏时侧栏是抽屉，展开状态由这个开关控制 */
	isOpen?: boolean;
	/** 窄屏抽屉里选完会话后收起 */
	onNavigate?: () => void;
}

/** 点击组件外部时关闭浮层，点击触发器本身不算外部。 */
function useDismiss(
	ref: React.RefObject<HTMLElement | null>,
	isOpen: boolean,
	close: () => void,
	ignoreSelector?: string,
): void {
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const node = ref.current;
			const target = event.target;
			if (node !== null && target instanceof Node && node.contains(target)) {
				return;
			}
			if (
				ignoreSelector !== undefined &&
				target instanceof Element &&
				target.closest(ignoreSelector) !== null
			) {
				return;
			}
			close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [ref, isOpen, close, ignoreSelector]);
}

export const SessionSidebar = memo(function SessionSidebar({
	sessions,
	projects: storedProjects,
	activeFile,
	statuses,
	createCwd,
	onSelect,
	onCreate,
	canCreate,
	onAddProject,
	showHeader = false,
	isSearchOpen = false,
	onOpenSearch,
	width,
	onWidthChange,
	maxWidth,
	onDraggingChange,
	onCollapse,
	isProjectsStale = false,
	onRefreshProjects,
	onRenameProject,
	onRemoveProject,
	onRevealProject,
	onRevealSessionFolder,
	onRenameSession,
	onDeleteSession,
	onOpenSettings,
	isSettingsOpen = false,
	hostSwitcher,
	hostStatus,
	isOpen = true,
	onNavigate,
}: SessionSidebarProps) {
	const { t, i18n } = useI18n();
	// 侧栏里能悬停出说明的地方共用一份提示
	const tip = useHoverTip();
	const [projectKeyword, setProjectKeyword] = useState("");
	const [isFilterOpen, setIsFilterOpen] = useState(false);
	const [isFilterUp, setIsFilterUp] = useState(false);
	/** 用户在过滤器里选过的目录，未选过时跟随当前会话 */
	const [pickedCwd, setPickedCwd] = useState<string | undefined>(undefined);
	/** 过滤器是否切到全部项目 */
	const [showsAll, setShowsAll] = useState(false);
	/** 右键打开操作面板的项目标识 */
	const [menuId, setMenuId] = useState<string | undefined>(undefined);
	/** 项目操作面板的视口位置 */
	const [projectMenuPosition, setProjectMenuPosition] = useState<{ x: number; y: number } | undefined>(
		undefined,
	);
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
	const [sessionMenuPosition, setSessionMenuPosition] = useState<{ x: number; y: number } | undefined>(
		undefined,
	);
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

	// 行尾的相对时间按分钟变，自己走一个分钟时钟；流式期间不必跟着每一帧重算
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);

	const activeCwd = sessions.find((session) => session.path === activeFile)?.cwd;
	const scopeCwd = showsAll ? undefined : (pickedCwd ?? activeCwd);

	/** 上一帧「进行中」组的顺序，几条会话同时在跑时不互相挤 */
	const runningOrder = useRef<readonly string[]>([]);

	const data = useMemo(() => {
		const built = buildSidebar({
			sessions,
			projects: storedProjects,
			statuses,
			projectCwd: scopeCwd,
			untitled: t("sidebar.untitled"),
			now,
			locale: i18n.language as "en" | "zh-CN",
			runningOrder: runningOrder.current,
		});
		// 记下这一帧的顺序给下一帧：同样的输入再算一遍结果相同，重复渲染不会错位
		runningOrder.current =
			built.groups.find((group) => group.key === "running")?.sessions.map((session) => session.path) ?? [];
		return built;
	}, [sessions, storedProjects, statuses, scopeCwd, t, now, i18n.language]);

	const currentProject: SidebarProject | undefined =
		scopeCwd === undefined ? undefined : data.projects.find((item) => samePath(item.cwd, scopeCwd));
	const filterLabel =
		currentProject?.name ?? (scopeCwd === undefined ? t("sidebar.allProjects") : baseName(scopeCwd));
	const menuSession =
		sessionMenuPath === undefined
			? undefined
			: data.groups.flatMap((group) => group.sessions).find((session) => session.path === sessionMenuPath);
	const menuProject =
		menuId === undefined ? undefined : data.projects.find((project) => project.id === menuId);
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
		setProjectMenuPosition(undefined);
		setRenaming(undefined);
		setRemovingId(undefined);
		setProjectError(undefined);
		if (restoreFocus) {
			triggerRef.current?.focus();
		}
	}, []);

	const dismissFilter = useCallback(() => closeFilter(false), [closeFilter]);
	useDismiss(filterRef, isFilterOpen, dismissFilter, ".sb-project-menu, .sb-session-menu");

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
		setProjectMenuPosition(undefined);
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
			setProjectMenuPosition(undefined);
			setRenaming(undefined);
			setRemovingId(undefined);
		} catch (error) {
			setProjectError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsProjectBusy(false);
		}
	};

	/** 收起项目操作面板并清掉其中的临时状态。 */
	const closeProjectMenu = useCallback((): void => {
		setMenuId(undefined);
		setProjectMenuPosition(undefined);
		setRenaming(undefined);
		setRemovingId(undefined);
		setProjectError(undefined);
	}, []);

	// 项目操作面板同样靠点外面、Esc 或滚动收起。
	useEffect(() => {
		if (menuId === undefined) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest(".sb-project-menu") !== null) return;
			closeProjectMenu();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeProjectMenu();
		};
		const onScroll = () => closeProjectMenu();
		const frame = requestAnimationFrame(() => {
			document.querySelector<HTMLButtonElement>(".sb-project-menu .sb-menu-item")?.focus();
		});
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [closeProjectMenu, menuId]);

	/** 收起会话操作面板并清掉其中的临时状态。 */
	const closeSessionMenu = useCallback((): void => {
		setSessionMenuPath(undefined);
		setSessionMenuPosition(undefined);
		setSessionRename(undefined);
		setSessionDeletePath(undefined);
		setSessionMenuError(undefined);
	}, []);

	// 会话菜单是浮层：点外面或按 Esc 收起，打开后把焦点放到第一个菜单项。
	useEffect(() => {
		if (sessionMenuPath === undefined) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest(".sb-session-menu") !== null) return;
			closeSessionMenu();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeSessionMenu();
		};
		const onScroll = () => closeSessionMenu();
		const frame = requestAnimationFrame(() => {
			document.querySelector<HTMLButtonElement>(".sb-session-menu .sb-menu-item")?.focus();
		});
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [closeSessionMenu, sessionMenuPath]);

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
			onNavigate?.();
		}
	};

	const emptyHint = scopeCwd === undefined ? t("sidebar.emptyAll") : t("sidebar.emptyProject");

	return (
		<aside className={isOpen ? "sb is-open" : "sb"}>
			{width === undefined || onWidthChange === undefined ? null : (
				<PaneResizer
					className="sb-resizer"
					label={t("sidebar.adjustSidebar")}
					width={width}
					min={SIDEBAR_MIN_WIDTH}
					max={maxWidth ?? SIDEBAR_MAX_WIDTH}
					cssVar="--sidebar-width"
					side="end"
					onWidthChange={onWidthChange}
					onDraggingChange={onDraggingChange}
				/>
			)}
			{showHeader ? (
				<SidebarHeader
					isSearchOpen={isSearchOpen}
					onToggleSearch={onOpenSearch ?? (() => undefined)}
					onAddProject={onAddProject}
					{...(onCollapse === undefined ? {} : { onCollapse })}
				/>
			) : null}
			<button
				type="button"
				className="sb-new"
				onClick={() => {
					// 没有可用的项目目录时不给「新建会话」：这台主机上还没有目录可选，
					// 直接把添加项目摆出来，免得把空路径交给主机
					if (newSessionCwd.length === 0) {
						onAddProject();
						onNavigate?.();
						return;
					}
					onCreate(newSessionCwd);
					onNavigate?.();
				}}
				disabled={!canCreate}
				{...tip.handlers(
					newSessionCwd.length === 0 ? t("common.addProject") : t("sidebar.newIn", { cwd: newSessionCwd }),
				)}
			>
				<Plus size={14} strokeWidth={1.5} />
				{t("common.newSession")}
			</button>

			<div className="sb-filter" ref={filterRef}>
				<button
					type="button"
					ref={triggerRef}
					className={isFilterOpen ? "sb-filter-btn is-open" : "sb-filter-btn"}
					aria-haspopup="dialog"
					aria-expanded={isFilterOpen}
					onClick={() => {
						setIsFilterOpen((open) => !open);
						onRefreshProjects?.();
					}}
				>
					<FolderIcon size={14} />
					<span className="sb-filter-name ell">{filterLabel}</span>
					<ChevronIcon isOpen={isFilterOpen} />
				</button>

				{isFilterOpen ? (
					// biome-ignore lint/a11y/useSemanticElements: 这是挂在过滤器按钮下的浮层，用不到 fieldset 的表单语义
					<div
						ref={panelRef}
						className={isFilterUp ? "sb-pop is-up" : "sb-pop"}
						role="group"
						aria-label={t("sidebar.chooseProject")}
						onKeyDown={trapFocus}
					>
						<label className="sb-search">
							<Search size={13} strokeWidth={1.5} />
							<input
								ref={projectSearchRef}
								value={projectKeyword}
								onChange={(event) => setProjectKeyword(event.target.value)}
								placeholder={t("sidebar.searchProjects")}
								aria-label={t("sidebar.searchProjects")}
							/>
						</label>
						<div className="sb-opts">
							<button
								type="button"
								className={scopeCwd === undefined ? "sb-opt is-on" : "sb-opt"}
								aria-pressed={scopeCwd === undefined}
								onClick={() => selectProject(undefined)}
							>
								<span className="sb-opt-name ell">{t("sidebar.allProjects")}</span>
							</button>
							{projectMatches.map((project) => {
								const isOn = !showsAll && scopeCwd !== undefined && samePath(project.cwd, scopeCwd);
								return (
									<div key={project.cwd} className="sb-opt-item">
										<button
											type="button"
											className={isOn ? "sb-opt is-on" : "sb-opt"}
											aria-pressed={isOn}
											{...tip.handlers(project.cwd)}
											onClick={() => selectProject(project.cwd)}
											onContextMenu={(event) => {
												if (project.id === undefined) return;
												event.preventDefault();
												setProjectError(undefined);
												setRenaming(undefined);
												setRemovingId(undefined);
												setMenuId(project.id);
												setProjectMenuPosition({
													x: Math.min(event.clientX, window.innerWidth - 240),
													y: Math.min(event.clientY, window.innerHeight - 180),
												});
											}}
										>
											<FolderIcon size={13} />
											<span className="sb-opt-name ell">{project.name}</span>
										</button>
									</div>
								);
							})}
							{projectMatches.length === 0 ? (
								<p className="sb-opt-empty">{t("sidebar.noMatchingProjects")}</p>
							) : null}
							{isProjectsStale ? (
								<div className="sb-opt-stale">
									<span className="sb-opt-name ell">{t("sidebar.projectsStale")}</span>
									<button type="button" className="sb-opt-action" onClick={() => onRefreshProjects?.()}>
										{t("sidebar.refresh")}
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
							<span className="sb-opt-name">{t("common.addProject")}</span>
						</button>
					</div>
				) : null}
			</div>

			<ScrollArea className="sb-queue" inset="var(--sidebar-edge)">
				{data.groups.length === 0 ? <p className="sb-empty">{emptyHint}</p> : null}
				{data.groups.map((group) => (
					<section key={group.key} className="sb-group">
						<h2 className="sb-group-head">
							<span>
								{group.key === "running"
									? t("sidebar.group.running")
									: group.key === "today"
										? t("sidebar.group.today")
										: group.key === "yesterday"
											? t("sidebar.group.yesterday")
											: t("sidebar.group.earlier")}
							</span>
						</h2>
						{group.sessions.map((session) => {
							const twoLine = scopeCwd === undefined;
							return (
								<ScrollRow key={session.path} className="sb-row-item">
									<div className="sb-row-wrap">
										<button
											type="button"
											className={`sb-row${session.path === activeFile ? " is-active" : ""}${twoLine ? " is-two-line" : ""}`}
											aria-current={session.path === activeFile}
											onClick={() => openSession(session)}
											onContextMenu={(event) => {
												if (session.isPlaceholder === true) return;
												event.preventDefault();
												setSessionMenuError(undefined);
												setSessionRename(undefined);
												setSessionDeletePath(undefined);
												setSessionMenuPath(session.path);
												setSessionMenuPosition({
													x: Math.min(event.clientX, window.innerWidth - 240),
													y: Math.min(event.clientY, window.innerHeight - 180),
												});
											}}
											disabled={session.isPlaceholder === true}
											{...tip.handlers(session.title)}
										>
											<SessionStatusMark bucket={session.bucket} />
											{twoLine ? (
												<span className="sb-row-body">
													<span className="sb-row-title ell">{session.title}</span>
													<span className="sb-row-meta">
														<span className="sb-row-proj ell">{session.host ?? session.project}</span>
														<span className="sb-row-time mono">{session.timeText}</span>
													</span>
												</span>
											) : (
												<>
													<span className="sb-row-title ell">{session.title}</span>
													<span className="sb-row-time mono">{session.timeText}</span>
												</>
											)}
										</button>
									</div>
								</ScrollRow>
							);
						})}
					</section>
				))}
			</ScrollArea>

			{menuProject === undefined ? null : (
				<div
					role="menu"
					aria-label={t("sidebar.projectMenu")}
					className="sb-pop sb-session-menu sb-context-menu sb-project-menu"
					style={{ left: projectMenuPosition?.x, top: projectMenuPosition?.y }}
					onContextMenu={(event) => event.preventDefault()}
				>
					{renaming === undefined ? null : (
						<label className="sb-rename">
							<input
								className="sb-rename-input"
								value={renaming.value}
								onChange={(event) => setRenaming({ id: renaming.id, value: event.target.value })}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !isComposingKey(event)) {
										void submitRename(menuProject.cwd);
									}
									if (event.key === "Escape") {
										setRenaming(undefined);
									}
								}}
								placeholder={t("sidebar.projectName")}
								aria-label={t("sidebar.projectName")}
							/>
							<button
								type="button"
								className="sb-opt-action"
								disabled={isProjectBusy}
								onClick={() => void submitRename(menuProject.cwd)}
							>
								{t("common.save")}
							</button>
						</label>
					)}

					{removingId === menuProject.id ? (
						<div className="sb-confirm">
							<span className="sb-confirm-text">{t("sidebar.removeProjectHint")}</span>
							<div className="sb-confirm-actions">
								<button
									type="button"
									className="sb-opt-action is-danger"
									disabled={isProjectBusy}
									onClick={() => {
										const id = menuProject.id;
										if (id === undefined) {
											return;
										}
										void runProjectAction(async () => {
											await onRemoveProject?.(id);
											if (scopeCwd !== undefined && samePath(menuProject.cwd, scopeCwd)) {
												setPickedCwd(undefined);
												setShowsAll(true);
											}
										});
									}}
								>
									{t("common.remove")}
								</button>
								<button type="button" className="sb-opt-action" onClick={() => setRemovingId(undefined)}>
									{t("common.cancel")}
								</button>
							</div>
						</div>
					) : (
						<div className="sb-menu-actions">
							<button
								type="button"
								className="sb-menu-item"
								onClick={() => setRenaming({ id: menuProject.id ?? "", value: menuProject.name })}
							>
								{t("common.rename")}
							</button>
							<button
								type="button"
								className="sb-menu-item"
								disabled={isProjectBusy}
								onClick={() => void runProjectAction(async () => onRevealProject?.(menuProject.id ?? ""))}
							>
								{t("sidebar.revealProject")}
							</button>
							<button
								type="button"
								className="sb-menu-item is-danger"
								onClick={() => setRemovingId(menuProject.id)}
							>
								{t("common.remove")}
							</button>
						</div>
					)}

					{projectError === undefined ? null : <p className="sb-menu-error">{projectError}</p>}
				</div>
			)}

			{menuSession === undefined ? null : (
				<div
					role="menu"
					aria-label={t("sidebar.sessionMenu")}
					className="sb-pop sb-session-menu sb-context-menu"
					style={{ left: sessionMenuPosition?.x, top: sessionMenuPosition?.y }}
					onContextMenu={(event) => event.preventDefault()}
				>
					{sessionRename?.path === menuSession.path ? (
						<label className="sb-rename">
							<input
								className="sb-rename-input"
								value={sessionRename.value}
								onChange={(event) =>
									setSessionRename({ path: sessionRename.path, value: event.target.value })
								}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !isComposingKey(event)) {
										void submitSessionRename();
									}
									if (event.key === "Escape") {
										setSessionRename(undefined);
									}
								}}
								placeholder={t("sidebar.sessionName")}
								aria-label={t("sidebar.sessionName")}
							/>
							<button
								type="button"
								className="sb-opt-action"
								disabled={isSessionBusy}
								onClick={() => void submitSessionRename()}
							>
								{t("common.save")}
							</button>
						</label>
					) : sessionDeletePath === menuSession.path ? (
						<div className="sb-confirm">
							<span className="sb-confirm-text">{t("sidebar.deleteSessionHint")}</span>
							<div className="sb-confirm-actions">
								<button
									type="button"
									className="sb-opt-action is-danger"
									disabled={isSessionBusy}
									onClick={() =>
										void runSessionMenuAction(async () => {
											await onDeleteSession?.(menuSession.path);
										})
									}
								>
									{t("common.delete")}
								</button>
								<button
									type="button"
									className="sb-opt-action"
									onClick={() => setSessionDeletePath(undefined)}
								>
									{t("common.cancel")}
								</button>
							</div>
						</div>
					) : (
						<div className="sb-menu-actions">
							<button
								type="button"
								className="sb-menu-item"
								onClick={() => setSessionRename({ path: menuSession.path, value: menuSession.title })}
							>
								{t("common.rename")}
							</button>
							<button
								type="button"
								className="sb-menu-item"
								disabled={isSessionBusy}
								onClick={() =>
									void runSessionMenuAction(async () => onRevealSessionFolder?.(menuSession.cwd))
								}
							>
								{t("sidebar.revealSessionFolder")}
							</button>
							<button
								type="button"
								className="sb-menu-item is-danger"
								onClick={() => setSessionDeletePath(menuSession.path)}
							>
								{t("common.delete")}
							</button>
						</div>
					)}

					{sessionMenuError === undefined ? null : <p className="sb-menu-error">{sessionMenuError}</p>}
				</div>
			)}

			<footer className="sb-foot">
				{hostSwitcher}
				{hostStatus === undefined ? null : <span className="sb-foot-status">{hostStatus}</span>}
				<button
					type="button"
					className={isSettingsOpen ? "sb-foot-btn is-icon is-on" : "sb-foot-btn is-icon"}
					aria-label={t("sidebar.settings")}
					aria-pressed={isSettingsOpen}
					onClick={() => onOpenSettings?.()}
				>
					<Settings size={14} strokeWidth={1.5} />
				</button>
			</footer>
			{tip.render()}
		</aside>
	);
});
