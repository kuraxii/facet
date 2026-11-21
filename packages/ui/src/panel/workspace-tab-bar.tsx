/**
 * 工作区标签栏。
 *
 * 右栏里已打开的工具标签（文件、变更、终端）的切换器。它是纯展示组件：条目、当前项与回调
 * 都由调用方给，组件不知道每一条对应哪个业务，也不在这里发请求；`+` 菜单是独立的一枚
 * 按钮（`WorkspaceTabMenu`），不混进标签栏的键盘序列。
 *
 * 同一个组件用在两处：展开态顶带右格与抽屉顶头，两处都是横向一条。宽度差别很大，所以文字
 * 标签由容器查询决定折不折：容器窄于 `WORKSPACE_TAB_LABEL_BREAKPOINT_PX` 时只剩图标，说明
 * 改由悬浮提示承担。
 */

import { X } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useHoverTip } from "../tip.tsx";
import type { RightPanelTab } from "./panel-state.ts";

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
	/** 文字标签；容器窄时折起，由悬浮提示补上 */
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
	/** 组件自己的类名 */
	className?: string;
	/** 标签栏的无障碍名称；不给时用界面里那句默认的 */
	ariaLabel?: string;
	/** 受控面板的 id，给到 `aria-controls`；不给时不写这个属性 */
	controlsId?: string;
}

/**
 * 文字标签折起的容器宽度（CSS px）。
 *
 * 与 `panel.css` 里 `@container (width < 660px)` 是同一个数：CSS 负责真的把文字藏起来，
 * 这里只用来决定要不要挂悬浮提示。两处改一处要改两处（容器查询里不能写变量）。
 *
 * 640 是按「四个图文标签 + `+` + 两枚动作 + 132px 窗口按钮簇」实测量出来的：四枚标签
 * 中文 343、英文 403，加上固定项后分别是 579 与 639 的容器宽；取英文那一侧再留一点余量，
 * 进撞车之前就已经退化成纯图标。缺省 420 的右栏因此只显示图标，`⤢` 展开之后才出文字。
 */
export const WORKSPACE_TAB_LABEL_BREAKPOINT_PX = 640;

/**
 * 最近的查询容器。
 *
 * 容器查询按最近的、`container-type` 不是 `normal` 的祖先解析，这里走同一条规则去找到
 * 它：顶带右格与抽屉顶头是容器，中间的 `.chrome-slot-row` / `.panel-head-row` 只是让位的
 * 一行，不算。找不到时退回父元素，够用。
 */
function findQueryContainer(node: HTMLElement): HTMLElement | null {
	let current = node.parentElement;
	while (current !== null) {
		if (getComputedStyle(current).containerType !== "normal") {
			return current;
		}
		current = current.parentElement;
	}
	return node.parentElement;
}

/**
 * 容器够不够窄。
 *
 * 观察的是容器的宽度而不是标签栏自己：标签栏在容器里只占内容所需的宽度，折的却是容器的
 * 宽度。`clientWidth` 是容器的内容盒宽度，容器因此不能有横向内边距——让出窗口按钮簇的那
 * 段内边距放在容器里面的一行上（见 `panel.css`）。
 */
function useNarrowContainer(ref: RefObject<HTMLDivElement | null>): boolean {
	const [isNarrow, setIsNarrow] = useState(false);
	useEffect(() => {
		const bar = ref.current;
		const container = bar === null ? null : findQueryContainer(bar);
		if (container === null) {
			return;
		}
		const read = (): void => setIsNarrow(container.clientWidth < WORKSPACE_TAB_LABEL_BREAKPOINT_PX);
		read();
		const observer = new ResizeObserver(read);
		observer.observe(container);
		return () => observer.disconnect();
	}, [ref]);
	return isNarrow;
}

export function WorkspaceTabBar({
	items,
	activeId,
	onSelect,
	onClose,
	className,
	ariaLabel,
	controlsId,
}: WorkspaceTabBarProps): ReactNode {
	const { t } = useI18n();
	// 文字被折起来时，标签文案改由这份提示给出
	const tip = useHoverTip();
	const barRef = useRef<HTMLDivElement | null>(null);
	const buttonRefs = useRef(new Map<WorkspaceTabId, HTMLButtonElement>());
	const showsLabel = !useNarrowContainer(barRef);
	const wantsTip = !showsLabel;

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
		>
			{items.map((item) => {
				const selected = activeId === item.id;
				const closeLabel = t("panel.closeTab", { name: item.label });
				return (
					/*
					 * 关闭按钮不能套在 tab 按钮里面（按钮不能嵌套），所以一条标签是「外壳 + 两个
					 * 兄弟按钮」。外壳标 presentation，让 tab 仍然是 tablist 的语义子节点。
					 */
					<div
						key={item.id}
						className="workspace-tab-shell"
						role="presentation"
						data-selected={selected ? "true" : undefined}
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
							aria-label={showsLabel ? undefined : item.label}
							disabled={item.disabled === true}
							tabIndex={item.id === rovingId ? 0 : -1}
							{...(wantsTip ? tip.handlers(item.label) : {})}
							ref={(node) => {
								if (node === null) {
									buttonRefs.current.delete(item.id);
								} else {
									buttonRefs.current.set(item.id, node);
								}
							}}
							onKeyDown={(event) => onKeyDown(event, item.id)}
							onClick={() => {
								if (item.disabled !== true) {
									onSelect(item.id);
								}
							}}
						>
							<span className="workspace-tab-icon">{item.icon}</span>
							<span className="workspace-tab-label">{item.label}</span>
							{item.badge === undefined || item.badge === 0 || item.badge === "" ? null : (
								<span className="workspace-tab-badge">{item.badge}</span>
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
								<X size={11} strokeWidth={2} />
							</button>
						)}
					</div>
				);
			})}
			{tip.render()}
		</div>
	);
}
