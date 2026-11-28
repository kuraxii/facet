/**
 * Task Inbox 会话侧栏。
 *
 * 顶部为 `+ 新建会话` 入口；主区平铺跨主机的 3 行活跃任务卡（不按时间或项目树拆分）；
 * 底部收起 `Settled` 归档抽屉与页脚（Host 连接管理器 + 设置按钮）。
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, Settings } from "lucide-react";
import { type MouseEvent, memo, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../common/Button.tsx";
import { ScrollArea } from "../common/scroll-area.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { SHELL_DATA_ATTRS } from "../layout/layout-contract.ts";
import { PaneResizer } from "../panel/pane-resizer.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { InboxCard } from "./InboxCard.tsx";
import type { SidebarSettledItem, SidebarTaskCard } from "./inbox-model.ts";
import { SettledDrawer } from "./SettledDrawer.tsx";
import { type MenuPosition, menuPositionOf, SessionMenu } from "./SidebarMenus.tsx";
import { SidebarHeader } from "./sidebar-header.tsx";
import type { SidebarSession } from "./sidebar-model.ts";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./sidebar-state.ts";

/** 视口外预渲染的任务卡片数 */
const SIDEBAR_OVERSCAN = 12;

export interface SessionSidebarProps {
	/** 活跃任务卡片（来自全部已连主机与离线缓存） */
	activeCards: readonly SidebarTaskCard[];
	/** 已归档条目 */
	settledItems: readonly SidebarSettledItem[];
	/** 当前正在查看的任务联合键 `endpoint::file` */
	activeKey: string | undefined;
	/** 选中一条任务或已归档会话 */
	onSelectTarget: (endpoint: string, file: string, knownCwd?: string) => void;
	/** 手动 Settle 某条任务（无确认框） */
	onSettle: (card: SidebarTaskCard) => void;
	/** 从 Settled 恢复某条会话 */
	onReopen: (item: SidebarSettledItem) => void;
	/** 进入新建会话草稿引导页 */
	onStartNew: () => void;
	/** 是否可新建会话（本机就绪） */
	canCreate: boolean;
	/** 打开搜索浮窗 */
	onOpenSearch: () => void;
	/** 窄屏抽屉是否自带头部 */
	showHeader?: boolean;
	/** 侧栏宽（px）；缺省为窄屏抽屉 */
	width?: number;
	onWidthChange?: (width: number) => void;
	maxWidth?: number;
	onDraggingChange?: (isDragging: boolean) => void;
	onDragCollapse?: () => void;
	onCollapse?: () => void;
	/** 会话右键动作（按 endpoint 路由到对应主机） */
	onRenameSession?: (endpoint: string, path: string, name: string | undefined) => Promise<void>;
	onDeleteSession?: (endpoint: string, path: string) => Promise<void>;
	onRevealSessionFolder?: (endpoint: string, cwd: string) => Promise<void>;
	/** 打开设置页面 */
	onOpenSettings?: () => void;
	isSettingsOpen?: boolean;
	/** 左下角 Host 节点连接管理器 */
	hostSwitcher?: ReactNode;
	/** 窄屏抽屉打开状态 */
	isOpen?: boolean;
	/** 跳转或打开操作完成后的收起回调（窄屏抽屉用） */
	onNavigate?: () => void;
}

export const SessionSidebar = memo(function SessionSidebar({
	activeCards,
	settledItems,
	activeKey,
	onSelectTarget,
	onSettle,
	onReopen,
	onStartNew,
	canCreate,
	onOpenSearch,
	showHeader = false,
	width,
	onWidthChange,
	maxWidth,
	onDraggingChange,
	onDragCollapse,
	onCollapse,
	onRenameSession,
	onDeleteSession,
	onRevealSessionFolder,
	onOpenSettings,
	isSettingsOpen = false,
	hostSwitcher,
	isOpen = true,
	onNavigate,
}: SessionSidebarProps) {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [sessionMenu, setSessionMenu] = useState<
		{ card: SidebarTaskCard; position: MenuPosition } | undefined
	>(undefined);
	const queueRef = useRef<HTMLDivElement>(null);

	const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: activeCards.length,
		getScrollElement: () => queueRef.current,
		overscan: SIDEBAR_OVERSCAN,
		initialRect: { width: 0, height: 800 },
		estimateSize: () => 84,
		measureElement: (element) => element.getBoundingClientRect().height,
	});
	const virtualItems = virtualizer.getVirtualItems();
	const totalSize = virtualizer.getTotalSize();

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				onOpenSearch();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpenSearch]);

	const openCard = useCallback(
		(card: SidebarTaskCard) => {
			onSelectTarget(card.endpoint, card.file, card.cwd);
			onNavigate?.();
		},
		[onNavigate, onSelectTarget],
	);

	const openSettled = useCallback(
		(item: SidebarSettledItem) => {
			onSelectTarget(item.endpoint, item.file, item.cwd);
			onNavigate?.();
		},
		[onNavigate, onSelectTarget],
	);

	const openContextMenu = useCallback((card: SidebarTaskCard, event: MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		setSessionMenu({ card, position: menuPositionOf(event) });
	}, []);

	const menuSession: SidebarSession | undefined =
		sessionMenu === undefined
			? undefined
			: {
					path: sessionMenu.card.file,
					title: sessionMenu.card.title,
					modified: sessionMenu.card.updatedAt,
					timeText: sessionMenu.card.timeText,
					isRunning: sessionMenu.card.attention === "running",
					bucket: "done",
					project: sessionMenu.card.projectName,
					cwd: sessionMenu.card.cwd,
					host: sessionMenu.card.hostLabel,
				};

	return (
		<aside className={isOpen ? "sb is-open" : "sb"}>
			{onWidthChange === undefined ? null : (
				<PaneResizer
					className="sb-resizer"
					label={t("panel.resizeSidebar")}
					width={width ?? SIDEBAR_MIN_WIDTH}
					min={SIDEBAR_MIN_WIDTH}
					max={maxWidth ?? SIDEBAR_MAX_WIDTH}
					cssVar="--sidebar-width"
					side="end"
					onWidthChange={onWidthChange}
					onDraggingChange={onDraggingChange}
					collapseThreshold={SIDEBAR_MIN_WIDTH / 2}
					{...(onDragCollapse === undefined ? {} : { onCollapse: onDragCollapse })}
					collapsePreviewAttr={SHELL_DATA_ATTRS.sidebarDragCollapsed}
					activeAttr={SHELL_DATA_ATTRS.sidebarResizerActive}
				/>
			)}
			{showHeader ? (
				<SidebarHeader
					isSearchOpen={false}
					onToggleSearch={() => {
						onOpenSearch();
						onNavigate?.();
					}}
					onAddProject={() => {
						onStartNew();
						onNavigate?.();
					}}
					onCollapse={onCollapse}
				/>
			) : null}

			<div className="sb-actions">
				<Button
					variant="secondary"
					size="md"
					className="sb-new"
					onClick={() => {
						onStartNew();
						onNavigate?.();
					}}
					disabled={!canCreate}
				>
					<Plus size={ICON_SIZE.md} />
					{t("common.newSession")}
				</Button>
			</div>

			<ScrollArea className="sb-queue" inset="var(--sidebar-edge)" ref={queueRef}>
				{activeCards.length === 0 ? <p className="sb-empty">{t("inbox.empty")}</p> : null}
				<div className="sb-canvas inbox-canvas" style={{ height: totalSize }}>
					{virtualItems.map((item) => {
						const card = activeCards[item.index];
						if (card === undefined) {
							return null;
						}
						return (
							<div
								key={card.key}
								className="sb-item is-inbox scroll-row"
								data-index={item.index}
								ref={virtualizer.measureElement}
								style={{ transform: `translateY(${item.start}px)` }}
							>
								<InboxCard
									card={card}
									isActive={card.key === activeKey}
									onSelect={openCard}
									onSettle={onSettle}
									onContextMenu={openContextMenu}
								/>
							</div>
						);
					})}
				</div>
			</ScrollArea>

			<SettledDrawer items={settledItems} activeKey={activeKey} onSelect={openSettled} onReopen={onReopen} />

			{menuSession === undefined || sessionMenu === undefined ? null : (
				<SessionMenu
					session={menuSession}
					position={sessionMenu.position}
					onClose={() => setSessionMenu(undefined)}
					onRename={async (path, name) =>
						await (onRenameSession?.(sessionMenu.card.endpoint, path, name) ?? Promise.resolve())
					}
					onDelete={async (path) =>
						await (onDeleteSession?.(sessionMenu.card.endpoint, path) ?? Promise.resolve())
					}
					onReveal={async () => {
						if (sessionMenu.card.cwd !== undefined) {
							await onRevealSessionFolder?.(sessionMenu.card.endpoint, sessionMenu.card.cwd);
						}
					}}
				/>
			)}

			<footer className="sb-foot">
				{hostSwitcher}
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
