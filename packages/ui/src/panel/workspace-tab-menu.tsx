/**
 * 工作区右上角的 `+` 菜单。
 *
 * 右栏的标签是动态的：这里列出全部工具（文件、变更、终端），没开的追加并激活，已开的只切
 * 过去。菜单是一层浮层，挂在 `document.body` 上——顶带自成一层次（`--z-chrome`），留在里面
 * 就压不过抽屉与遮罩。
 *
 * Esc 的处置与其它浮层同一套：这一层先吃下这次按键（`preventDefault()`），外层（抽屉）看到
 * `defaultPrevented` 就不再跟着关，一次 Esc 只关最内层。
 */

import { Plus } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Badge } from "../common/Badge.tsx";
import { ListRow } from "../common/ListRow.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE, VISUAL_PX } from "../styles/visual-contract.ts";
import type { WorkspaceTabId, WorkspaceTabItem } from "./workspace-tab-bar.tsx";

/** `+` 菜单的参数。 */
export interface WorkspaceTabMenuProps {
	/** 全部工具，顺序即菜单顺序 */
	items: readonly WorkspaceTabItem[];
	/** 已经打开的标签，用来提示「点了只会切过去」 */
	openTabs: readonly WorkspaceTabId[];
	/** 当前激活项；打开菜单时焦点先落在它身上 */
	activeId: WorkspaceTabId | null;
	/** 选了一项 */
	onPick: (id: WorkspaceTabId) => void;
	/** 组件自己的类名 */
	className?: string;
}

/** 菜单与窗口边缘的距离（CSS px）：与 `base.css` 的 `--workspace-menu-edge` 是同一个数。 */
const MENU_EDGE = VISUAL_PX.popover.menuEdge;

/** 菜单与 `+` 按钮之间的空隙（CSS px），与 `--workspace-menu-offset` 是同一个数。 */
const MENU_OFFSET = VISUAL_PX.popover.menuOffset;

export function WorkspaceTabMenu({
	items,
	openTabs,
	activeId,
	onPick,
	className,
}: WorkspaceTabMenuProps): ReactNode {
	const { t } = useI18n();
	const [isOpen, setIsOpen] = useState(false);
	/** 量好尺寸之后的落点；还没量到时按锚点左下角先画一帧不可见的位置 */
	const [placed, setPlaced] = useState<{ left: number; top: number } | undefined>(undefined);
	const anchorRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	const close = useCallback((restoreFocus: boolean): void => {
		setIsOpen(false);
		setPlaced(undefined);
		if (restoreFocus) {
			anchorRef.current?.focus();
		}
	}, []);

	// 浮层：点外面、按 Esc、改窗口大小都收起；打开后焦点落到当前项（没有就落到第一项）
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (target instanceof Element && target.closest(".workspace-menu") !== null) {
				return;
			}
			// 点 `+` 自己交给它自己的 onClick：这里先收掉，避免同一件事做两遍
			if (target instanceof Element && target.closest(".workspace-menu-anchor") !== null) {
				return;
			}
			close(false);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") {
				return;
			}
			// 吃掉这次按键：外层（抽屉）看 `defaultPrevented`，一次 Esc 只关最内层
			event.preventDefault();
			close(true);
		};
		const onResize = (): void => close(false);
		const frame = requestAnimationFrame(() => {
			const menu = menuRef.current;
			if (menu === null) {
				return;
			}
			const preferred =
				activeId === null ? undefined : menu.querySelector<HTMLElement>(`[data-tab="${activeId}"]`);
			(preferred ?? menu.querySelector<HTMLElement>("button"))?.focus();
		});
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("resize", onResize);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("resize", onResize);
		};
	}, [activeId, close, isOpen]);

	// 量出真实尺寸再收进窗口：菜单贴在右上角，右端超出时要往回收
	useLayoutEffect(() => {
		if (!isOpen) {
			setPlaced(undefined);
			return;
		}
		const anchor = anchorRef.current;
		const menu = menuRef.current;
		if (anchor === null || menu === null) {
			return;
		}
		const anchorRect = anchor.getBoundingClientRect();
		const rect = menu.getBoundingClientRect();
		setPlaced({
			left: Math.max(MENU_EDGE, Math.min(anchorRect.left, window.innerWidth - rect.width - MENU_EDGE)),
			top: Math.max(
				MENU_EDGE,
				Math.min(anchorRect.bottom + MENU_OFFSET, window.innerHeight - rect.height - MENU_EDGE),
			),
		});
	}, [isOpen]);

	/** 上下键在同一份菜单项里循环；Home / End 到两头。 */
	const onMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
			return;
		}
		const menu = menuRef.current;
		if (menu === null) {
			return;
		}
		const options = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
		if (options.length === 0) {
			return;
		}
		event.preventDefault();
		const active = document.activeElement;
		const index = active instanceof HTMLElement ? options.indexOf(active) : -1;
		const next =
			event.key === "Home"
				? options[0]
				: event.key === "End"
					? options[options.length - 1]
					: options[
							(Math.max(index, 0) + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
						];
		next?.focus();
	}, []);

	const classes = ["chrome-toggle", "workspace-menu-anchor", className]
		.filter((name): name is string => name !== undefined && name.length > 0)
		.join(" ");
	const style =
		placed === undefined
			? undefined
			: ({ left: `${placed.left}px`, top: `${placed.top}px` } as CSSProperties);

	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				className={classes}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				aria-label={t("panel.openTool")}
				onClick={() => {
					if (isOpen) {
						close(true);
						return;
					}
					setPlaced(undefined);
					setIsOpen(true);
				}}
			>
				<Plus size={ICON_SIZE.lg} />
			</button>
			{!isOpen
				? null
				: createPortal(
						<div
							ref={menuRef}
							className="workspace-menu"
							role="menu"
							aria-label={t("panel.tools")}
							style={{ ...style, visibility: placed === undefined ? "hidden" : undefined }}
							onKeyDown={onMenuKeyDown}
						>
							{items.map((item) => (
								<ListRow
									as="button"
									key={item.id}
									variant="menu"
									role="menuitem"
									className="workspace-menu-item"
									data-tab={item.id}
									data-open={openTabs.includes(item.id) ? "true" : undefined}
									disabled={item.disabled === true}
									onClick={() => {
										onPick(item.id);
										close(true);
									}}
								>
									<span className="workspace-menu-icon">{item.icon}</span>
									<span className="workspace-menu-label">{item.label}</span>
									{item.badge === undefined || item.badge === 0 || item.badge === "" ? null : (
										<Badge>{item.badge}</Badge>
									)}
									{item.shortcut === undefined ? null : (
										<span className="workspace-menu-key">{item.shortcut}</span>
									)}
								</ListRow>
							))}
						</div>,
						document.body,
					)}
		</>
	);
}
