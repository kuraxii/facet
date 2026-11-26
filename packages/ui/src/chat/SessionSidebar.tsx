/**
 * 会话侧栏。
 *
 * 自上而下四块：标题与全局操作、新建会话、项目过滤器、会话队列；底部是页脚。
 * 项目过滤器同时决定队列的范围与新建会话的目录，队列按时间分组（分组规则见
 * `sidebar-model.ts`）。
 *
 * 这个文件只做状态编排与组装：纯推导在 `session-list-model.ts`，单行在 `SessionRow.tsx`，
 * 过滤器在 `ProjectFilter.tsx`，两个右键菜单在 `SidebarMenus.tsx`。队列本身是摊平的一条
 * 列表（组标题也是一项），按固定估值虚拟化——滚出去的组与行不必留在 DOM 里。
 */
import type { ProjectInfo, SessionStatus, SessionSummary } from "@facet/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, Settings } from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../common/Button.tsx";
import { ScrollArea } from "../common/scroll-area.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { SHELL_DATA_ATTRS } from "../layout/layout-contract.ts";
import { PaneResizer } from "../panel/pane-resizer.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { ProjectFilter } from "./ProjectFilter.tsx";
import { SessionRow } from "./SessionRow.tsx";
import { type MenuPosition, menuPositionOf, ProjectMenu, SessionMenu } from "./SidebarMenus.tsx";
import { findSession, projectById, resolveScopeCwd, runningOrderOf } from "./session-list-model.ts";
import { SidebarHeader } from "./sidebar-header.tsx";
import { buildSidebar, type SidebarSession, samePath } from "./sidebar-model.ts";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./sidebar-state.ts";

/** 视口外预渲染的队列项数 */
const SIDEBAR_OVERSCAN = 12;

/** 会话队列里的一项：组标题或一条会话。 */
type QueueEntry =
	| { readonly kind: "head"; readonly key: string; readonly label: string }
	| {
			readonly kind: "row";
			readonly key: string;
			readonly session: SidebarSession;
			/** 这一组的最后一行：组尾比组内多留一点间距 */
			readonly groupEnd: boolean;
	  };

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
	/** 缩到最小宽一半以内松手：收起侧栏。与点收起按钮同一条路 */
	onDragCollapse?: (() => void) | undefined;
	/** 此刻是不是拖到「松手就关」的位置 */
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
	onDragCollapse,
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
	const [isFilterOpen, setIsFilterOpen] = useState(false);
	/** 用户在过滤器里选过的目录，未选过时跟随当前会话 */
	const [pickedCwd, setPickedCwd] = useState<string | undefined>(undefined);
	/** 过滤器是否切到全部项目 */
	const [showsAll, setShowsAll] = useState(false);
	/** 右键打开的项目菜单：指向哪一条、浮层落在哪 */
	const [projectMenu, setProjectMenu] = useState<{ projectId: string; position: MenuPosition } | undefined>(
		undefined,
	);
	/** 右键打开的会话菜单 */
	const [sessionMenu, setSessionMenu] = useState<{ path: string; position: MenuPosition } | undefined>(
		undefined,
	);
	const panelRef = useRef<HTMLDivElement>(null);
	/** 会话队列的滚动容器：虚拟化看它算可见窗口 */
	const queueRef = useRef<HTMLDivElement | null>(null);

	// 行尾的相对时间按分钟变，自己走一个分钟时钟；流式期间不必跟着每一帧重算
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);

	const activeCwd = sessions.find((session) => session.path === activeFile)?.cwd;
	const scopeCwd = resolveScopeCwd({ showsAll, pickedCwd, activeCwd });

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
		runningOrder.current = runningOrderOf(built.groups);
		return built;
	}, [sessions, storedProjects, statuses, scopeCwd, t, now, i18n.language]);

	/** 组标题文案：进行中 / 今天 / 昨天 / 更早 */
	const groupLabel = useCallback(
		(key: string): string =>
			key === "running"
				? t("sidebar.group.running")
				: key === "today"
					? t("sidebar.group.today")
					: key === "yesterday"
						? t("sidebar.group.yesterday")
						: t("sidebar.group.earlier"),
		[t],
	);

	/*
	 * 会话队列摊平成一条列表（组标题也算一项），再按固定估值虚拟化：队列会随会话数线性长
	 * 下去，滚出去的组与行不必留在 DOM 里。组间距折进每一项的下内边距（组内 2px、组尾 6px），
	 * `measureElement` 量到的就是含间距的那一段，位置与改前一致。
	 */
	const list = useMemo(() => {
		const flat: QueueEntry[] = [];
		for (const group of data.groups) {
			flat.push({ kind: "head", key: `head:${group.key}`, label: groupLabel(group.key) });
			group.sessions.forEach((session, index) => {
				flat.push({
					kind: "row",
					key: session.path,
					session,
					groupEnd: index === group.sessions.length - 1,
				});
			});
		}
		return flat;
	}, [data.groups, groupLabel]);

	const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: list.length,
		getScrollElement: () => queueRef.current,
		overscan: SIDEBAR_OVERSCAN,
		// 首帧还没量到容器高度时给一个够高的窗口，量到之后以实测为准
		initialRect: { width: 0, height: 800 },
		estimateSize: (index) => (list[index]?.kind === "head" ? 32 : 30),
		measureElement: (element) => element.getBoundingClientRect().height,
	});
	const items = virtualizer.getVirtualItems();
	const totalSize = virtualizer.getTotalSize();

	const menuProject = projectById(data.projects, projectMenu?.projectId);
	const menuSession = findSession(data.groups, sessionMenu?.path);
	const newSessionCwd = scopeCwd ?? createCwd;

	/** 选目录：范围跟着定，浮层与菜单一起收起。 */
	const selectProject = (cwd: string | undefined): void => {
		setPickedCwd(cwd);
		setShowsAll(cwd === undefined);
		setIsFilterOpen(false);
	};

	const closeFilter = useCallback(() => setIsFilterOpen(false), []);

	const openSession = (session: SidebarSession): void => {
		if (session.isPlaceholder !== true) {
			onSelect(session.path);
			onNavigate?.();
		}
	};

	/** 右键一条会话：只认非占位的那几条。 */
	const openSessionMenu = (session: SidebarSession, event: React.MouseEvent<HTMLButtonElement>): void => {
		if (session.isPlaceholder === true) {
			return;
		}
		event.preventDefault();
		setSessionMenu({ path: session.path, position: menuPositionOf(event) });
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
					// 缩到最小宽一半以内松手就收起这一栏，落盘里仍留着原来的偏好宽
					collapseThreshold={SIDEBAR_MIN_WIDTH / 2}
					{...(onDragCollapse === undefined ? {} : { onCollapse: onDragCollapse })}
					collapsePreviewAttr={SHELL_DATA_ATTRS.sidebarDragCollapsed}
					activeAttr={SHELL_DATA_ATTRS.sidebarResizerActive}
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
			<Button
				variant="secondary"
				size="md"
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
				<Plus size={ICON_SIZE.md} />
				{t("common.newSession")}
			</Button>

			<ProjectFilter
				projects={data.projects}
				scopeCwd={scopeCwd}
				isOpen={isFilterOpen}
				panelRef={panelRef}
				isStale={isProjectsStale}
				tip={tip}
				onToggle={() => setIsFilterOpen((open) => !open)}
				onSelect={selectProject}
				onOpenMenu={(project, position) => {
					const id = project.id;
					if (id === undefined) {
						return;
					}
					setProjectMenu({ projectId: id, position });
				}}
				onAddProject={onAddProject}
				onRefresh={() => onRefreshProjects?.()}
				onClose={closeFilter}
			/>

			<ScrollArea className="sb-queue" inset="var(--sidebar-edge)" ref={queueRef}>
				{data.groups.length === 0 ? <p className="sb-empty">{emptyHint}</p> : null}
				<div className="sb-canvas" style={{ height: totalSize }}>
					{items.map((item) => {
						const entry = list[item.index];
						if (entry === undefined) {
							return null;
						}
						return (
							<div
								key={entry.key}
								className={entry.kind === "row" && entry.groupEnd ? "sb-item is-group-end" : "sb-item"}
								data-index={item.index}
								ref={virtualizer.measureElement}
								style={{ transform: `translateY(${item.start}px)` }}
							>
								{entry.kind === "head" ? (
									<h2 className="sb-group-head">
										<span>{entry.label}</span>
									</h2>
								) : (
									<SessionRow
										session={entry.session}
										isActive={entry.session.path === activeFile}
										// 不过滤到单个项目时行上来两行：项目名与时间
										twoLine={scopeCwd === undefined}
										onOpen={openSession}
										onContextMenu={openSessionMenu}
									/>
								)}
							</div>
						);
					})}
				</div>
			</ScrollArea>

			{menuProject === undefined ? null : (
				<ProjectMenu
					project={menuProject}
					position={projectMenu?.position}
					onClose={() => setProjectMenu(undefined)}
					onRename={async (id, name) => {
						await onRenameProject?.(id, name);
						// 改名后过滤器上的名字跟着变，当前范围保持在这个目录
						setPickedCwd(menuProject.cwd);
					}}
					onRemove={async (id) => {
						await onRemoveProject?.(id);
						// 删掉的正好是当前范围时退回「全部项目」，否则范围不动
						if (scopeCwd !== undefined && samePath(menuProject.cwd, scopeCwd)) {
							setPickedCwd(undefined);
							setShowsAll(true);
						}
					}}
					onReveal={async (id) => await (onRevealProject?.(id) ?? Promise.resolve())}
				/>
			)}

			{menuSession === undefined ? null : (
				<SessionMenu
					session={menuSession}
					position={sessionMenu?.position}
					onClose={() => setSessionMenu(undefined)}
					onRename={async (path, name) => await (onRenameSession?.(path, name) ?? Promise.resolve())}
					onDelete={async (path) => await (onDeleteSession?.(path) ?? Promise.resolve())}
					onReveal={async (cwd) => await (onRevealSessionFolder?.(cwd) ?? Promise.resolve())}
				/>
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
					<Settings size={ICON_SIZE.md} />
				</button>
			</footer>
			{tip.render()}
		</aside>
	);
});
