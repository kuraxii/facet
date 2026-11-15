import {
	FileDiff,
	FileText,
	GitCommitHorizontal,
	MessageSquare,
	Plus,
	SquareTerminal,
	X,
} from "lucide-react";
import {
	type DragEvent as ReactDragEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import {
	type MainTab,
	type MainTabDropTarget,
	normalizeMainTabDropTarget,
	reorderMainTabIds,
} from "./main-tab.ts";

/** 标签栏上的一条标签；文字与图标由调用方给出。 */
export interface MainTabItem {
	/** 标签标识 */
	id: string;
	/** 标签类型，决定图标 */
	kind: MainTab["kind"];
	/** 标签上显示的名字 */
	label: string;
	/** 悬停时显示的完整名字或路径 */
	title?: string;
	/** 是否显示关闭按钮 */
	closable?: boolean;
	/** 文件标签可复制的绝对路径与相对路径 */
	copyPath?: {
		/** 绝对路径 */
		absolute: string;
		/** 相对项目根的路径 */
		relative: string;
	};
}

/** 标签栏需要的数据与动作。 */
export interface MainTabsProps {
	/** 已打开的标签 */
	tabs: readonly MainTabItem[];
	/** 当前标签标识 */
	activeId: string | undefined;
	/** 切换标签 */
	onSelect: (id: string) => void;
	/** 关闭标签 */
	onClose: (id: string) => void;
	/** 一次关闭多个标签 */
	onCloseTabs: (ids: readonly string[]) => void;
	/** 复制文本 */
	onCopyText?: (text: string) => void;
	/** 拖动后给出新的标签顺序 */
	onReorder: (ids: readonly string[]) => void;
	/** 新建终端；不可用时仍显示菜单项，只是禁用 */
	onCreateTerminal: () => void;
	/** 主机是否提供终端能力 */
	canCreateTerminal: boolean;
	/** 终端不可用时的说明 */
	terminalDisabledReason?: string;
}

const ICONS: Record<MainTab["kind"], typeof MessageSquare> = {
	session: MessageSquare,
	file: FileText,
	diff: FileDiff,
	changes: FileDiff,
	commit: GitCommitHorizontal,
	terminal: SquareTerminal,
};

/**
 * 从拖动事件里取出落点标签。
 *
 * 指针落在标签间隙时取最近的一条，因此拖到最后一个标签后面也能落到末尾。
 */
function resolveDropTarget(event: ReactDragEvent<HTMLDivElement>): MainTabDropTarget | undefined {
	const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-tab-id]"));
	if (nodes.length === 0) {
		return undefined;
	}
	const direct = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tab-id]") : null;
	if (direct !== null) {
		const id = direct.dataset.tabId;
		if (id !== undefined) {
			const rect = direct.getBoundingClientRect();
			return { id, after: event.clientX >= rect.left + rect.width / 2 };
		}
	}
	let nearest: HTMLElement | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const node of nodes) {
		const rect = node.getBoundingClientRect();
		const distance = Math.abs(event.clientX - (rect.left + rect.width / 2));
		if (distance < nearestDistance) {
			nearest = node;
			nearestDistance = distance;
		}
	}
	if (nearest === undefined) {
		return undefined;
	}
	const id = nearest.dataset.tabId;
	if (id === undefined) {
		return undefined;
	}
	const rect = nearest.getBoundingClientRect();
	return { id, after: event.clientX >= rect.left + rect.width / 2 };
}

/** 主区域标签栏。加号菜单目前只提供终端。 */
export function MainTabs({
	tabs,
	activeId,
	onSelect,
	onClose,
	onCloseTabs,
	onCopyText,
	onReorder,
	onCreateTerminal,
	canCreateTerminal,
	terminalDisabledReason,
}: MainTabsProps): ReactNode {
	const { t } = useI18n();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	/** 正在拖动的标签标识 */
	const [draggedId, setDraggedId] = useState<string | undefined>(undefined);
	/** 拖动开始时就写进 ref，dragover 与 drop 不依赖尚未提交的 state */
	const draggedRef = useRef<string | undefined>(undefined);
	/** 拖动落点：目标标签与放在它前面还是后面 */
	const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | undefined>(undefined);
	/** 标签右键菜单：标签标识与视口位置 */
	const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | undefined>(undefined);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const activeRef = useRef<HTMLDivElement | null>(null);

	// 标签多到需要横向滚动时，切过去的标签保持在可见范围内
	useEffect(() => {
		if (activeId === undefined) {
			return;
		}
		activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeId]);

	const closeMenu = useCallback(() => setIsMenuOpen(false), []);
	const closeContextMenu = useCallback(() => setContextMenu(undefined), []);

	const openContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, id: string): void => {
		event.preventDefault();
		setIsMenuOpen(false);
		setContextMenu({
			id,
			x: Math.max(4, Math.min(event.clientX, window.innerWidth - 200)),
			y: Math.max(4, Math.min(event.clientY, window.innerHeight - 200)),
		});
	}, []);

	/** 拖动开始：记下源标签，并把加号菜单收起来。 */
	const startDrag = useCallback((event: ReactDragEvent<HTMLButtonElement>, id: string): void => {
		setIsMenuOpen(false);
		draggedRef.current = id;
		setDraggedId(id);
		setDropTarget(undefined);
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", id);
	}, []);

	/** 拖过标签栏：按落点标签的左半或右半决定插到它前面还是后面。 */
	const dragOver = useCallback(
		(event: ReactDragEvent<HTMLDivElement>): void => {
			const dragged = draggedRef.current;
			if (dragged === undefined) {
				return;
			}
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			const target = resolveDropTarget(event);
			if (target === undefined) {
				setDropTarget(undefined);
				return;
			}
			const normalized = normalizeMainTabDropTarget(tabs, target);
			if (normalized.id === dragged) {
				setDropTarget(undefined);
				return;
			}
			setDropTarget((current) =>
				current?.id === normalized.id && current.after === normalized.after ? current : normalized,
			);
		},
		[tabs],
	);

	/** 落下：按最终落点重排，然后清掉拖动状态。 */
	const drop = useCallback(
		(event: ReactDragEvent<HTMLDivElement>): void => {
			event.preventDefault();
			const dragged = draggedRef.current;
			const raw = resolveDropTarget(event);
			const target = raw === undefined ? undefined : normalizeMainTabDropTarget(tabs, raw);
			if (dragged !== undefined && target !== undefined && target.id !== dragged) {
				onReorder(reorderMainTabIds(tabs, dragged, target.id, target.after));
			}
			draggedRef.current = undefined;
			setDraggedId(undefined);
			setDropTarget(undefined);
		},
		[onReorder, tabs],
	);

	/** 拖动结束或取消时清掉高亮。 */
	const endDrag = useCallback((): void => {
		draggedRef.current = undefined;
		setDraggedId(undefined);
		setDropTarget(undefined);
	}, []);

	useEffect(() => {
		if (!isMenuOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			const node = menuRef.current;
			if (node !== null && event.target instanceof Node && node.contains(event.target)) {
				return;
			}
			closeMenu();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				closeMenu();
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [closeMenu, isMenuOpen]);

	useEffect(() => {
		if (contextMenu === undefined) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			const node = contextMenuRef.current;
			if (node !== null && event.target instanceof Node && node.contains(event.target)) {
				return;
			}
			closeContextMenu();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				closeContextMenu();
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [closeContextMenu, contextMenu]);

	const contextItem = contextMenu === undefined ? undefined : tabs.find((tab) => tab.id === contextMenu.id);
	const closeOtherIds =
		contextItem === undefined
			? []
			: tabs.filter((tab) => tab.id !== contextItem.id && tab.closable === true).map((tab) => tab.id);
	const closeAllIds =
		contextItem === undefined ? [] : tabs.filter((tab) => tab.closable === true).map((tab) => tab.id);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 整条标签栏都是拖动落点，包含标签之间的间隙与末尾空白
		<div className="main-tabs" onDragOver={dragOver} onDrop={drop}>
			<div className="main-tab-strip" role="tablist" aria-label={t("mainTabs.label")}>
				{tabs.map((item) => {
					const Icon = ICONS[item.kind];
					const isActive = item.id === activeId;
					const isDragging = item.id === draggedId;
					const dropSide =
						dropTarget?.id === item.id ? (dropTarget.after ? "is-drop-after" : "is-drop-before") : undefined;
					const className = [
						"main-tab",
						isActive ? "is-on" : undefined,
						isDragging ? "is-dragging" : undefined,
						dropSide,
					]
						.filter((name): name is string => name !== undefined)
						.join(" ");
					return (
						<div
							key={item.id}
							className={className}
							data-tab-id={item.id}
							ref={isActive ? activeRef : undefined}
						>
							<button
								type="button"
								role="tab"
								className="main-tab-main"
								aria-selected={isActive}
								aria-controls="main-tab-content"
								title={item.title ?? item.label}
								draggable
								onDragStart={(event) => startDrag(event, item.id)}
								onDragEnd={endDrag}
								onClick={() => onSelect(item.id)}
								onContextMenu={(event) => openContextMenu(event, item.id)}
							>
								<Icon size={13} strokeWidth={1.5} />
								<span className="main-tab-name">{item.label}</span>
							</button>
							{item.closable === true ? (
								<button
									type="button"
									className="main-tab-close"
									aria-label={t("mainTabs.closeTab", { name: item.label })}
									title={t("mainTabs.closeTab", { name: item.label })}
									onClick={() => onClose(item.id)}
								>
									<X size={11} strokeWidth={1.6} />
								</button>
							) : null}
						</div>
					);
				})}
			</div>
			<div className="main-tab-add-wrap" ref={menuRef}>
				<button
					type="button"
					className="main-tab-add"
					aria-label={t("mainTabs.add")}
					title={t("mainTabs.add")}
					aria-expanded={isMenuOpen}
					aria-haspopup="menu"
					onClick={() => setIsMenuOpen((open) => !open)}
				>
					<Plus size={14} strokeWidth={1.6} />
				</button>
				{isMenuOpen ? (
					<div className="main-tab-menu" role="menu">
						<button
							type="button"
							role="menuitem"
							className="main-tab-menu-item"
							disabled={!canCreateTerminal}
							title={terminalDisabledReason ?? t("terminal.newTerminal")}
							onClick={() => {
								closeMenu();
								onCreateTerminal();
							}}
						>
							<SquareTerminal size={13} strokeWidth={1.5} />
							<span>{t("terminal.newTerminal")}</span>
						</button>
					</div>
				) : null}
			</div>
			{contextItem === undefined ? null : (
				<div
					ref={contextMenuRef}
					className="main-tab-menu main-tab-context-menu"
					role="menu"
					aria-label={t("mainTabs.tabMenu")}
					style={{ left: contextMenu?.x, top: contextMenu?.y }}
					onContextMenu={(event) => event.preventDefault()}
				>
					<button
						type="button"
						role="menuitem"
						className="main-tab-menu-item"
						disabled={contextItem.closable !== true}
						onClick={() => {
							onClose(contextItem.id);
							closeContextMenu();
						}}
					>
						{t("mainTabs.close")}
					</button>
					<button
						type="button"
						role="menuitem"
						className="main-tab-menu-item"
						disabled={closeOtherIds.length === 0}
						onClick={() => {
							onCloseTabs(closeOtherIds);
							closeContextMenu();
						}}
					>
						{t("mainTabs.closeOther")}
					</button>
					<button
						type="button"
						role="menuitem"
						className="main-tab-menu-item"
						disabled={closeAllIds.length === 0}
						onClick={() => {
							onCloseTabs(closeAllIds);
							closeContextMenu();
						}}
					>
						{t("mainTabs.closeAll")}
					</button>
					<div className="main-tab-menu-sep" />
					<button
						type="button"
						role="menuitem"
						className="main-tab-menu-item"
						disabled={contextItem.copyPath === undefined || onCopyText === undefined}
						onClick={() => {
							onCopyText?.(contextItem.copyPath?.absolute ?? "");
							closeContextMenu();
						}}
					>
						{t("mainTabs.copyPath")}
					</button>
					<button
						type="button"
						role="menuitem"
						className="main-tab-menu-item"
						disabled={contextItem.copyPath === undefined || onCopyText === undefined}
						onClick={() => {
							onCopyText?.(contextItem.copyPath?.relative ?? "");
							closeContextMenu();
						}}
					>
						{t("mainTabs.copyRelativePath")}
					</button>
				</div>
			)}
		</div>
	);
}
