/**
 * 工作区标签栏。
 *
 * 右栏里三类内容（文件、变更、终端）的切换器。它是一个纯展示组件：条目、当前项与选中
 * 回调都由调用方给，组件不知道每一条对应哪个业务，也不在这里发请求。
 *
 * 同一个组件用在三处：展开态顶带右格、抽屉顶头（都是 `horizontal`）与收起态右侧的悬浮
 * 竖轨（`vertical`）。三处的宽度差别很大，所以文字标签由容器查询决定折不折：容器窄于
 * `WORKSPACE_TAB_LABEL_BREAKPOINT_PX` 时只剩图标，说明改由悬浮提示承担。
 */

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

/** 工作区的三类内容。 */
export type WorkspaceTabId = "files" | "changes" | "terminal";

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
}

/** 标签栏参数。 */
export interface WorkspaceTabBarProps {
	/** 条目，顺序即显示顺序 */
	items: readonly WorkspaceTabItem[];
	/** 当前项；为空时第一条可用项占住焦点位，但不高亮 */
	activeId: WorkspaceTabId | null;
	/** 选中一条；禁用项不会触发 */
	onSelect: (id: WorkspaceTabId) => void;
	/** 排布方向：横向用于顶带与抽屉顶头，纵向用于收起态的悬浮竖轨 */
	orientation?: "horizontal" | "vertical";
	/**
	 * 文字的显示口径。
	 *
	 * `auto` 跟着容器宽度走（窄于断点时只留图标并挂悬浮提示）；`always` 始终给文字；
	 * `never` 始终只留图标，悬浮提示常开。
	 */
	labelMode?: "auto" | "always" | "never";
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
 * 与 `panel.css` 里 `@container (width < 440px)` 是同一个数：CSS 负责真的把文字藏起来，
 * 这里只用来决定要不要挂悬浮提示。两处改一处要改两处（容器查询里不能写变量）。
 */
export const WORKSPACE_TAB_LABEL_BREAKPOINT_PX = 440;

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
	orientation = "horizontal",
	labelMode = "auto",
	className,
	ariaLabel,
	controlsId,
}: WorkspaceTabBarProps): ReactNode {
	const { t } = useI18n();
	// 文字被折起来时，标签文案改由这份提示给出
	const tip = useHoverTip();
	const barRef = useRef<HTMLDivElement | null>(null);
	const buttonRefs = useRef(new Map<WorkspaceTabId, HTMLButtonElement>());
	const isNarrowContainer = useNarrowContainer(barRef);
	const showsLabel = labelMode === "always" || (labelMode === "auto" && !isNarrowContainer);
	const wantsTip = !showsLabel;

	const enabled = items.filter((item) => item.disabled !== true);
	const isActive = (id: WorkspaceTabId): boolean => activeId === id;
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
			const forward = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
			const backward = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
			if (event.key === forward) {
				event.preventDefault();
				move(id, 1);
				return;
			}
			if (event.key === backward) {
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
			}
		},
		[jump, move, orientation],
	);

	const classes = ["workspace-tabs", orientation === "vertical" ? "is-vertical" : "is-horizontal", className]
		.filter((name): name is string => name !== undefined && name.length > 0)
		.join(" ");

	return (
		<div
			ref={barRef}
			className={classes}
			data-label-mode={labelMode}
			role="tablist"
			aria-orientation={orientation}
			aria-label={ariaLabel ?? t("panel.tabs")}
		>
			{items.map((item) => {
				const selected = isActive(item.id);
				return (
					<button
						key={item.id}
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
				);
			})}
			{tip.render()}
		</div>
	);
}
