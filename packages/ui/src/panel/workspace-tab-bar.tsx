/**
 * 工作区标签栏。
 *
 * 右栏里已打开的工具标签（文件、变更、提交图谱、终端）的切换器。它是纯展示组件：条目、
 * 当前项与回调都由调用方给，组件不知道每一条对应哪个业务，也不在这里发请求；`+` 菜单是
 * 独立的一枚按钮（`WorkspaceTabMenu`），不混进标签栏的键盘序列。
 *
 * 同一个组件用在展开态顶带右格，标签不压缩：文字永远在，放不下就横着滚；鼠标竖向滚轮也
 * 接到横向上（见 `useTabStripScroll`）。传入 `onReorder` 后支持指针拖拽调整标签顺序
 * （见 `useTabStripDrag`）。
 */

import { X } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useRef,
} from "react";
import { Badge } from "../common/Badge.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import type { RightPanelTab } from "./panel-state.ts";
import { useTabStripDrag } from "./use-tab-drag.ts";
import { useTabStripFade, useTabStripScroll } from "./use-tab-strip.ts";

/**
 * 工作区的工具标识。
 *
 * 就是右栏状态里的那一份：标签栏、`+` 菜单与启动清单都认它，不各自再写一遍枚举。
 */
export type WorkspaceTabId = RightPanelTab;

/** 标签栏上的一条标签。 */
export interface WorkspaceTabItem {
	/** 标签标识 */
	id: WorkspaceTabId;
	/** 文字标签 */
	label: string;
	/** 图标，尺寸由调用方给；标签栏只管位置 */
	icon: ReactNode;
	/** 右上角的计数；不给时不显示 */
	badge?: number | string;
	/** 不可用：点击无效，方向键也跳过它 */
	disabled?: boolean;
	/** 快捷键提示（已按平台写好）；启动清单与 `+` 菜单用它，标签栏本身不显示 */
	shortcut?: string;
}

/** 标签栏参数。 */
export interface WorkspaceTabBarProps {
	/** 已打开的标签，顺序即显示顺序；为空时不渲染这一层 */
	items: readonly WorkspaceTabItem[];
	/** 当前项；不在条目里时第一条可用项占住焦点位，但不高亮 */
	activeId: WorkspaceTabId | null;
	/** 选中一条；禁用项不会触发 */
	onSelect: (id: WorkspaceTabId) => void;
	/** 关掉一条；不给时不显示关闭按钮 */
	onClose?: ((id: WorkspaceTabId) => void) | undefined;
	/** 拖拽重排完成后的新顺序；不给时不启用拖拽 */
	onReorder?: ((orderedIds: readonly WorkspaceTabId[]) => void) | undefined;
	/** 组件自己的类名 */
	className?: string;
	/** 标签栏的无障碍名称；不给时用界面里那句默认的 */
	ariaLabel?: string;
	/** 受控面板的 id，给到 `aria-controls`；不给时不写这个属性 */
	controlsId?: string;
}

export function WorkspaceTabBar({
	items,
	activeId,
	onSelect,
	onClose,
	onReorder,
	className,
	ariaLabel,
	controlsId,
}: WorkspaceTabBarProps): ReactNode {
	const { t } = useI18n();
	const barRef = useRef<HTMLDivElement | null>(null);
	const shellRefs = useRef(new Map<WorkspaceTabId, HTMLDivElement>());
	const buttonRefs = useRef(new Map<WorkspaceTabId, HTMLButtonElement>());
	const itemIds = items.map((item) => item.id);

	useTabStripScroll(barRef, buttonRefs, activeId);
	const fade = useTabStripFade(barRef, items.length, activeId);
	const { dragPreview, onTabPointerDown, consumeSuppressedClick } = useTabStripDrag(
		barRef,
		shellRefs,
		itemIds,
		onReorder,
	);

	const enabled = items.filter((item) => item.disabled !== true);
	/** 焦点位：当前项可用就落在它身上，否则落在第一条可用项上 */
	const rovingId = enabled.some((item) => item.id === activeId) ? activeId : enabled[0]?.id;

	/** 方向键在同一条可用项序列里循环移动，并就地切换。 */
	const move = useCallback(
		(from: WorkspaceTabId, step: number): void => {
			const index = enabled.findIndex((item) => item.id === from);
			if (index < 0 || enabled.length < 2) {
				return;
			}
			const next = enabled[(index + step + enabled.length) % enabled.length];
			if (next === undefined) {
				return;
			}
			onSelect(next.id);
			buttonRefs.current.get(next.id)?.focus();
		},
		[enabled, onSelect],
	);

	/** 跳到第一条或最后一条可用项。 */
	const jump = useCallback(
		(to: "first" | "last"): void => {
			const target = to === "first" ? enabled[0] : enabled[enabled.length - 1];
			if (target === undefined) {
				return;
			}
			onSelect(target.id);
			buttonRefs.current.get(target.id)?.focus();
		},
		[enabled, onSelect],
	);

	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>, id: WorkspaceTabId): void => {
			if (event.key === "ArrowRight") {
				event.preventDefault();
				move(id, 1);
				return;
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				move(id, -1);
				return;
			}
			if (event.key === "Home") {
				event.preventDefault();
				jump("first");
				return;
			}
			if (event.key === "End") {
				event.preventDefault();
				jump("last");
				return;
			}
			// Delete / Backspace 关标签：与编辑器一致，且不用把焦点移到关闭按钮上
			if ((event.key === "Delete" || event.key === "Backspace") && onClose !== undefined) {
				event.preventDefault();
				onClose(id);
			}
		},
		[jump, move, onClose],
	);

	if (items.length === 0) {
		return null;
	}

	const classes = ["workspace-tabs", className]
		.filter((name): name is string => name !== undefined && name.length > 0)
		.join(" ");

	return (
		<div
			ref={barRef}
			className={classes}
			role="tablist"
			aria-orientation="horizontal"
			aria-label={ariaLabel ?? t("panel.tabs")}
			data-fade-left={fade.left ? "true" : undefined}
			data-fade-right={fade.right ? "true" : undefined}
			data-reordering={dragPreview === null ? undefined : "true"}
		>
			{items.map((item) => {
				const selected = activeId === item.id;
				const isDragging = dragPreview?.draggedId === item.id;
				const shift = dragPreview === null ? 0 : (dragPreview.shifts[item.id] ?? 0);
				const shellStyle: CSSProperties | undefined = isDragging
					? ({ "--tab-drag-x": `${dragPreview.dx}px` } as CSSProperties)
					: shift !== 0
						? ({ "--tab-shift": `${shift}px` } as CSSProperties)
						: undefined;
				const closeLabel = t("panel.closeTab", { name: item.label });
				return (
					/*
					 * 关闭按钮不能套在 tab 按钮里面（按钮不能嵌套），所以一条标签是「外壳 + 两个
					 * 兄弟按钮」。外壳标 presentation，让 tab 仍然是 tablist 的语义子节点。
					 */
					<div
						key={item.id}
						ref={(node) => {
							if (node === null) {
								shellRefs.current.delete(item.id);
							} else {
								shellRefs.current.set(item.id, node);
							}
						}}
						className={onClose === undefined ? "workspace-tab-shell" : "workspace-tab-shell is-closable"}
						role="presentation"
						data-selected={selected ? "true" : undefined}
						data-dragging={isDragging ? "true" : undefined}
						style={shellStyle}
						onAuxClick={(event) => {
							// 中键关闭：与浏览器标签一致
							if (event.button === 1 && onClose !== undefined) {
								event.preventDefault();
								onClose(item.id);
							}
						}}
					>
						<button
							type="button"
							role="tab"
							className="workspace-tab"
							aria-selected={selected}
							aria-controls={controlsId}
							disabled={item.disabled === true}
							tabIndex={item.id === rovingId ? 0 : -1}
							ref={(node) => {
								if (node === null) {
									buttonRefs.current.delete(item.id);
								} else {
									buttonRefs.current.set(item.id, node);
								}
							}}
							onPointerDown={(event) => onTabPointerDown(event, item.id)}
							onKeyDown={(event) => onKeyDown(event, item.id)}
							onClick={() => {
								if (consumeSuppressedClick(item.id)) {
									return;
								}
								if (item.disabled !== true) {
									onSelect(item.id);
								}
							}}
						>
							<span className="workspace-tab-icon">{item.icon}</span>
							{item.label}
							{item.badge === undefined || item.badge === 0 || item.badge === "" ? null : (
								<Badge>{item.badge}</Badge>
							)}
						</button>
						{onClose === undefined ? null : (
							<button
								type="button"
								className="workspace-tab-close"
								aria-label={closeLabel}
								tabIndex={-1}
								onClick={() => onClose(item.id)}
							>
								<X size={ICON_SIZE.sm} />
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}
