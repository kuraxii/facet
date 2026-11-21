/**
 * 候选列表。
 *
 * `/` 命令面板与 `@` 文件候选共用同一份列表：`.cmd-pop` 的外壳、`.cmd-row` 的行、
 * `role="listbox"` / `role="option"` 的语义，以及一条共同的规矩——**键盘换高亮时把那一行
 * 带进可视范围**。列表比容器高的时候（命令多、文件多），光标走到最后几条上就看不见了，
 * 这是两个列表都会踩的坑，所以滚动放在这里，不放在各自的调用方。
 *
 * 行里放什么由调用方给：命令面板有命令名、参数提示、说明与来源标签，文件候选只有文件名
 * 与目录。
 */
import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";

/**
 * 让高亮那一行落进可视范围，返回容器应有的 `scrollTop`。
 *
 * 只算容器自己的滚动，不调 `scrollIntoView`：那会把页面一起滚，而输入区贴在窗口底部，
 * 页面一动对话正文就跟着走。`row` 的上下沿相对的是容器可视区的原点（当前滚动之后的位置），
 * 所以换算成新的 `scrollTop` 时加上当前值即可。
 */
export function scrollTopToReveal(
	row: { readonly top: number; readonly bottom: number },
	viewport: { readonly height: number; readonly scrollTop: number },
): number {
	if (row.top < 0) {
		return Math.max(0, viewport.scrollTop + row.top);
	}
	if (row.bottom > viewport.height) {
		return Math.max(0, viewport.scrollTop + row.bottom - viewport.height);
	}
	return viewport.scrollTop;
}

/** 把高亮那一行带进可视范围；没有高亮、下标越界或没有布局时什么都不做。 */
function scrollActiveIntoView(box: HTMLElement | null, activeIndex: number | null): void {
	if (box === null || activeIndex === null) {
		return;
	}
	const row = box.children[activeIndex];
	if (!(row instanceof HTMLElement)) {
		return;
	}
	const boxRect = box.getBoundingClientRect();
	const rowRect = row.getBoundingClientRect();
	// 换算到容器可视区的原点：边框之外才是滚动的起点
	const top = rowRect.top - boxRect.top - box.clientTop;
	const next = scrollTopToReveal(
		{ top, bottom: top + rowRect.height },
		{ height: box.clientHeight, scrollTop: box.scrollTop },
	);
	if (next !== box.scrollTop) {
		box.scrollTop = next;
	}
}

/** 一行在列表里的位置，交给调用方渲染内容。 */
export interface OptionRowState {
	/** 行下标 */
	index: number;
	/** 是不是键盘高亮的那一条 */
	isActive: boolean;
}

/**
 * 行上额外挂的属性。
 *
 * 先铺这些、再铺列表自己的 `onMouseEnter` / `onClick`，所以列表的指针与点击处理说了算：
 * 调用方只能加东西（悬浮提示、id、节点引用、按下时的处理），盖不掉高亮与选中。
 */
export type OptionRowExtra = Pick<
	ComponentProps<"button">,
	"id" | "ref" | "onMouseDown" | "onPointerEnter" | "onPointerLeave"
>;

/** 候选列表的参数。 */
export interface OptionListProps<T> {
	/** 候选，按显示顺序 */
	items: readonly T[];
	/** 每条的稳定键，React 用它复用行元素 */
	keyOf: (item: T) => string;
	/** 键盘高亮的下标；没有高亮时为空 */
	activeIndex: number | null;
	/** 读屏用的名字 */
	label: string;
	/** 容器额外的类名：文件候选只多一个高度上限 */
	className?: string;
	/** 行内容的渲染函数 */
	renderRow: (item: T, state: OptionRowState) => ReactNode;
	/** 选中一条 */
	onPick: (item: T, index: number) => void;
	/** 指针移到某条上：列表只上报，高亮由调用方维护 */
	onHighlight?: (index: number) => void;
	/** 行上额外的属性，例如文件候选要的节点引用 */
	rowProps?: (item: T, state: OptionRowState) => OptionRowExtra | undefined;
}

/** 候选列表：浮层外壳、行、键盘高亮与「跟随高亮滚动」。 */
export function OptionList<T>({
	items,
	keyOf,
	activeIndex,
	label,
	className,
	renderRow,
	onPick,
	onHighlight,
	rowProps,
}: OptionListProps<T>): ReactNode {
	const listRef = useRef<HTMLDivElement>(null);

	// 高亮变了、候选换了都要重量一次：候选条数一变，行高与总高对不上，滚不到位
	useEffect(() => {
		if (items.length === 0 || activeIndex === null || activeIndex >= items.length) {
			return;
		}
		scrollActiveIntoView(listRef.current, activeIndex);
	}, [activeIndex, items]);

	return (
		<div
			ref={listRef}
			className={className === undefined ? "cmd-pop scroll-y" : `cmd-pop scroll-y ${className}`}
			role="listbox"
			aria-label={label}
		>
			{items.map((item, index) => {
				const isActive = index === activeIndex;
				return (
					<button
						{...(rowProps?.(item, { index, isActive }) ?? {})}
						key={keyOf(item)}
						type="button"
						role="option"
						aria-selected={isActive}
						className={isActive ? "cmd-row is-on" : "cmd-row"}
						onMouseEnter={() => onHighlight?.(index)}
						onClick={() => onPick(item, index)}
					>
						{renderRow(item, { index, isActive })}
					</button>
				);
			})}
		</div>
	);
}
