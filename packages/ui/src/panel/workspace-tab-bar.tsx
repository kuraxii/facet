/**
 * 工作区标签栏。
 *
 * 右栏里已打开的工具标签（文件、变更、终端）的切换器。它是纯展示组件：条目、当前项与回调
 * 都由调用方给，组件不知道每一条对应哪个业务，也不在这里发请求；`+` 菜单是独立的一枚
 * 按钮（`WorkspaceTabMenu`），不混进标签栏的键盘序列。
 *
 * 同一个组件用在两处：展开态顶带右格与抽屉顶头，两处都是横向一条，宽度差别很大。标签因此
 * 不压缩：文字永远在，放不下就横着滚；鼠标只有竖向滚轮，所以滚轮也接到横向上，并且带一段
 * 逐帧收窄的滑动（见 `useTabStripScroll`）。
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
import { Badge } from "../common/Badge.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
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
	/** 组件自己的类名 */
	className?: string;
	/** 标签栏的无障碍名称；不给时用界面里那句默认的 */
	ariaLabel?: string;
	/** 受控面板的 id，给到 `aria-controls`；不给时不写这个属性 */
	controlsId?: string;
}

/**
 * 每一帧收掉剩余距离的比例。
 *
 * 0.28 时一格滚轮（约 100px）在 12 帧左右（≈200ms）走完，起手快、到尾巴自然慢下来，
 * 与系统里那种"滑一下"的手感接近。一次给满（1）就是瞬移，给太小则显得拖沓。
 */
const TAB_SCROLL_EASING = 0.28;

/**
 * 要不要做这段滑动动画。
 *
 * 与样式里的 `--dur-*` 数是同一套判断：系统偏好与设置项任一成立就减动效，此时直接落位。
 */
function wantsSmoothScroll(): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	if (document.documentElement.dataset.motion === "reduced") {
		return false;
	}
	return !(
		typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * 标签栏的横向滚动。
 *
 * 两件事共用一份「目标位置」：滚轮/触控板横滚，以及当前项切过去时把它带回可视范围。
 * 自己维护目标值而不直接读 `scrollLeft`——动画途中 `scrollLeft` 是中间位置，快速连滚时
 * `scrollLeft += delta` 会把上一段动画吃掉，滚得越快反而越走不动。
 *
 * 滚轮部分：React 的 `onWheel` 挂在根节点上且是**被动**监听，里面 `preventDefault()` 不
 * 生效，所以挂原生监听并标 `passive: false`。标签栏本身没有可滚的纵向内容，吃掉这个事件
 * 不会影响别处；没溢出时直接放行，让外层照旧处理。触控板横向滑动给的是 `deltaX`，鼠标
 * 竖滚给的是 `deltaY`：取绝对值大的那个方向，两种设备都能滚。
 *
 * 带回可视范围：新开的标签排在末尾、容器窄时它就在滚动区外面，键盘切到看不见的那一条也
 * 一样。这里只改标签栏自己的 `scrollLeft`，不调 `scrollIntoView`——那会把外壳的横向滚动
 * 一起带走。
 */
function useTabStripScroll(
	barRef: RefObject<HTMLDivElement | null>,
	buttonsRef: RefObject<Map<WorkspaceTabId, HTMLButtonElement>>,
	activeId: WorkspaceTabId | null,
): void {
	/** 动画要走到哪儿；`null` 表示没有在走 */
	const targetRef = useRef<number | null>(null);
	/** 在跑的那一帧；0 表示没在跑 */
	const frameRef = useRef(0);

	/** 逐帧走向目标位置 */
	const glide = useCallback(
		function step(): void {
			const bar = barRef.current;
			const target = targetRef.current;
			if (bar === null || target === null) {
				frameRef.current = 0;
				return;
			}
			const remaining = target - bar.scrollLeft;
			if (Math.abs(remaining) < 1) {
				bar.scrollLeft = target;
				targetRef.current = null;
				frameRef.current = 0;
				return;
			}
			bar.scrollLeft += remaining * TAB_SCROLL_EASING;
			frameRef.current = requestAnimationFrame(step);
		},
		[barRef],
	);

	/** 走向某个位置（已夹在可滚范围内）；减动效时直接落位 */
	const scrollTo = useCallback(
		(next: number): void => {
			const bar = barRef.current;
			if (bar === null) {
				return;
			}
			const max = bar.scrollWidth - bar.clientWidth;
			targetRef.current = Math.min(max, Math.max(0, next));
			if (!wantsSmoothScroll()) {
				bar.scrollLeft = targetRef.current;
				targetRef.current = null;
				return;
			}
			if (frameRef.current === 0) {
				frameRef.current = requestAnimationFrame(glide);
			}
		},
		[barRef, glide],
	);

	useEffect(() => {
		const bar = barRef.current;
		if (bar === null) {
			return;
		}
		const onWheel = (event: WheelEvent): void => {
			if (bar.scrollWidth <= bar.clientWidth) {
				return;
			}
			const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			if (delta === 0) {
				return;
			}
			event.preventDefault();
			scrollTo((targetRef.current ?? bar.scrollLeft) + delta);
		};
		bar.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			bar.removeEventListener("wheel", onWheel);
			if (frameRef.current !== 0) {
				cancelAnimationFrame(frameRef.current);
			}
			frameRef.current = 0;
			targetRef.current = null;
		};
	}, [barRef, scrollTo]);

	// 依赖只有当前项：新开一条标签时它就是新那条，切换与追加都会走到这里
	useEffect(() => {
		const bar = barRef.current;
		const button = activeId === null ? undefined : buttonsRef.current.get(activeId);
		if (bar === null || button === undefined) {
			return;
		}
		const barRect = bar.getBoundingClientRect();
		const buttonRect = button.getBoundingClientRect();
		const from = targetRef.current ?? bar.scrollLeft;
		if (buttonRect.left < barRect.left) {
			scrollTo(from - (barRect.left - buttonRect.left));
		} else if (buttonRect.right > barRect.right) {
			scrollTo(from + (buttonRect.right - barRect.right));
		}
	}, [activeId, barRef, buttonsRef, scrollTo]);
}

/** 标签溢出状态：只有真的被左右边界裁住时才亮起对应一侧的渐隐遮罩。 */
interface TabStripFade {
	left: boolean;
	right: boolean;
}

/** 跟踪横向标签栏两端是否存在溢出裁切，避免在全部放得下时误加边缘渐隐。 */
function useTabStripFade(
	barRef: RefObject<HTMLDivElement | null>,
	itemCount: number,
	activeId: WorkspaceTabId | null,
): TabStripFade {
	const [fade, setFade] = useState<TabStripFade>({ left: false, right: false });

	const sync = useCallback((): void => {
		const bar = barRef.current;
		if (bar === null) {
			return;
		}
		// 留 1px 容差吸收亚像素滚动取整误差
		const left = bar.scrollLeft > 1;
		const right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
		setFade((current) => (current.left === left && current.right === right ? current : { left, right }));
	}, [barRef]);

	useEffect(() => {
		// itemCount / activeId 变更后重算一次渐隐状态（依赖显式参与判定而非多余分支）
		void itemCount;
		void activeId;
		sync();
	}, [activeId, itemCount, sync]);

	useEffect(() => {
		const bar = barRef.current;
		if (bar === null) {
			return;
		}
		bar.addEventListener("scroll", sync, { passive: true });
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sync);
		observer?.observe(bar);
		return () => {
			bar.removeEventListener("scroll", sync);
			observer?.disconnect();
		};
	}, [barRef, sync]);

	return fade;
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
	const barRef = useRef<HTMLDivElement | null>(null);
	const buttonRefs = useRef(new Map<WorkspaceTabId, HTMLButtonElement>());

	useTabStripScroll(barRef, buttonRefs, activeId);
	const fade = useTabStripFade(barRef, items.length, activeId);

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
						className={onClose === undefined ? "workspace-tab-shell" : "workspace-tab-shell is-closable"}
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
							disabled={item.disabled === true}
							tabIndex={item.id === rovingId ? 0 : -1}
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
