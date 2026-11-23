/**
 * 对话面板虚拟化的纯计算：行高初估、`.column` 的占位几何、拖选钉行。
 *
 * 面板按「行」虚拟化：滚出视口的行不挂载，`.column.chat-grid` 里用前后留白与 spacer 撑出
 * 真实高度。这里的函数都不碰 React 与 DOM——滚动偏移、可见范围、挂载了哪些行由调用方喂进来，
 * 好让几何能在单测里逐像素对齐。
 *
 * 坐标口径只有一套：`@tanstack/react-virtual` 的 `start` / `end` 是**滚动容器坐标**
 * （含 `.scroll` 的 `padding-top`），而 `.column` 从 `--space-12` 之后才开始排内容，所以两者
 * 之间固定差一个 `VIRTUAL_SCROLL_MARGIN`。换算只在 `buildGridPlan` 里做一次。
 */
import { VISUAL_SCALE } from "../styles/visual-contract.ts";
import type { DisplayRow } from "./group.ts";

/** 行与行之间的距离，与 `.column { row-gap: var(--space-6) }` 同源。 */
export const VIRTUAL_ROW_GAP = VISUAL_SCALE.space.s6;

/** 列表起点相对滚动容器顶部的偏移，与 `.scroll { padding: var(--space-12) 0 … }` 同源。 */
export const VIRTUAL_SCROLL_MARGIN = VISUAL_SCALE.space.s12;

/**
 * 视口上下各多挂几行。
 *
 * 聊天行高方差大，默认的 1 行在快速滚轮下会露出空档；给到 6 行同时让工具结果里的图片
 * （`rootMargin: 300px` 的 IntersectionObserver）有足够提前量去解码。
 */
export const VIRTUAL_OVERSCAN = 6;

/**
 * 一次拖选最多钉住多少行。
 *
 * 拖到视口外时浏览器会自动滚动、选区跟着变长，钉住的行会**同时**挂载，而一行里可能有
 * Markdown、代码高亮与 Mermaid。60 行（约两屏不错的中等长度正文）在常见拖选里够用，
 * 再长只钉两端：选区中间照样会断，但不会因为一次长拖把上百行重内容一次挂上。
 */
export const MAX_SELECTION_PIN_SPAN = 60;

/**
 * 没有实测高度时的分型初估。
 *
 * 只影响第一次滚动条长度：行一挂载就会换成实测高度。差异化的初值比一刀切少抖一截。
 */
const ESTIMATED_HEIGHT = {
	/** 压缩、分叉、重试：一行字的高度 */
	line: 28,
	/** 收起的工具过程组 */
	collapsed: 44,
	/** 展开的工具过程组：标题加几段输出 */
	expanded: 220,
	/** 用户消息：一行气泡加行尾动作 */
	user: 80,
	/** 助手正文：普通一段 Markdown 答复 */
	assistant: 120,
} as const;

/** 估一行有多高，只需要种类与是否收起。 */
export function estimateRowHeight(row: Pick<DisplayRow, "kind">, isCollapsed: boolean): number {
	switch (row.kind) {
		case "user":
			return ESTIMATED_HEIGHT.user;
		case "assistant":
			return ESTIMATED_HEIGHT.assistant;
		case "meta":
			return isCollapsed ? ESTIMATED_HEIGHT.collapsed : ESTIMATED_HEIGHT.expanded;
		default:
			return ESTIMATED_HEIGHT.line;
	}
}

/** 一段可见区域的几何摘要，与虚拟项的 `start` / `end` 同口径。 */
export interface VirtualSpan {
	/** 这一项在整列里的下标 */
	readonly index: number;
	/** 顶边距滚动容器顶部（含 `padding-top`） */
	readonly start: number;
	/** 底边，等于 `start + size`，不含行距 */
	readonly end: number;
}

/** 渲染计划里的一段：要么是一行，要么是两个不相邻的块之间的占位。 */
export type GridSegment =
	| { readonly kind: "row"; readonly index: number }
	| { readonly kind: "spacer"; readonly key: string; readonly height: number };

/** `.column` 这一帧怎么排：前后留白与按需插入的占位块。 */
export interface GridPlan {
	/** 挂在 `.column` 上的内联 `padding-top` */
	readonly paddingTop: number;
	/** 挂在 `.column` 上的内联 `padding-bottom` */
	readonly paddingBottom: number;
	/** 按行下标升序，非连续的两块之间自动插入 spacer */
	readonly segments: readonly GridSegment[];
}

/** 空计划：没有可渲染的行时用。 */
const EMPTY_PLAN: GridPlan = { paddingTop: 0, paddingBottom: 0, segments: [] };

/**
 * 把这一帧挂载的虚拟项排成 `.column` 里的正常流。
 *
 * 为什么不用绝对定位：`.row` 必须继续当 `.chat-grid` 的直接子项，才吃得到三列轨道与
 * `row-gap`；绝对定位会同时丢掉列宽、间距，还给行内的浮层造出新的层叠上下文。
 *
 * 占位几何（`gap` 两端各算一次，因为 CSS Grid 在 spacer 上下各放一个 `row-gap`）：
 * - `paddingTop = 首项.start - scrollMargin`
 * - `paddingBottom = totalSize - 末项.end`
 * - 跳过若干行时 `spacer = (下一项.start - 上一项.end) - 2 × gap`
 *
 * `totalSize` 传虚拟化器的 `getTotalSize()`：它等于最后一项的 `end`（已含 `scrollMargin`），
 * 所以整列的高度凑出来正好是 `totalSize - scrollMargin`，再加 `.scroll` 自己的上下内边距
 * 就与真实内容高度逐像素对齐。
 */
export function buildGridPlan(input: {
	readonly items: readonly VirtualSpan[];
	readonly totalSize: number;
	readonly gap: number;
	readonly scrollMargin: number;
}): GridPlan {
	const { items, totalSize, gap, scrollMargin } = input;
	const first = items[0];
	const last = items[items.length - 1];
	if (first === undefined || last === undefined) {
		return EMPTY_PLAN;
	}
	const segments: GridSegment[] = [];
	let previous: VirtualSpan | undefined;
	for (const item of items) {
		if (previous !== undefined && item.index > previous.index + 1) {
			segments.push({
				kind: "spacer",
				key: `spacer:${previous.index}:${item.index}`,
				// 相邻两项的距离由 CSS 的一个 row-gap 负责；跨过若干行时多出来的一段要自己补
				height: Math.max(0, item.start - previous.end - 2 * gap),
			});
		}
		segments.push({ kind: "row", index: item.index });
		previous = item;
	}
	return {
		paddingTop: Math.max(0, first.start - scrollMargin),
		paddingBottom: Math.max(0, totalSize - last.end),
		segments,
	};
}

/** 可见范围与钉行判据的输入，与 `rangeExtractor` 拿到的参数同形。 */
export interface RangeExtractInput {
	/** 视口里的首尾行下标 */
	readonly range: {
		readonly startIndex: number;
		readonly endIndex: number;
		readonly overscan: number;
		readonly count: number;
	};
	/**
	 * 拖选中跨过的两行（可能反序）。两端都在场才谈得上钉行：只有一端在面板里，
	 * 说明选区伸到了面板外面，钉了也没用。
	 */
	readonly selection: readonly [string, string] | null;
	/** 行标识到行下标 */
	readonly rowIndexOf: (rowId: string) => number | undefined;
	/** 最多钉多少行，缺省 `MAX_SELECTION_PIN_SPAN` */
	readonly maxSpan?: number | undefined;
}

/**
 * 决定这一帧挂载哪些行：可见窗口、上下 overscan，再加拖选跨过的那一段。
 *
 * 拖选必须钉住：行的 DOM 一被卸载，浏览器的原生选区就断在那里，「右键引用」拿到的是半截
 * 文字甚至空串。悬浮提示与图片预览不用钉——它们要么随行走（浮层本来就属于那一行），要么
 * 是模态的，滚动期间不会发生。
 */
export function extractPinnedRange(input: RangeExtractInput): number[] {
	const { range, selection, rowIndexOf } = input;
	const maxSpan = input.maxSpan ?? MAX_SELECTION_PIN_SPAN;
	const last = range.count - 1;
	if (last < 0) {
		return [];
	}
	const indexes = new Set<number>();
	const from = Math.max(0, range.startIndex - range.overscan);
	const to = Math.min(last, range.endIndex + range.overscan);
	for (let index = from; index <= to; index += 1) {
		indexes.add(index);
	}
	const startId = selection?.[0];
	const endId = selection?.[1];
	if (startId !== undefined && endId !== undefined) {
		const start = rowIndexOf(startId);
		const end = rowIndexOf(endId);
		if (start !== undefined && end !== undefined) {
			const low = Math.min(start, end);
			const high = Math.max(start, end);
			if (high - low <= maxSpan) {
				for (let index = low; index <= high; index += 1) {
					indexes.add(index);
				}
			} else {
				// 跨得太多：只钉两端，中间照样会断，但不会因为一次全选把整段历史挂上去
				indexes.add(low);
				indexes.add(high);
			}
		}
	}
	return [...indexes].sort((left, right) => left - right);
}

/** 标识迁移最多跟几跳：实时消息提升为历史消息只换一次，留几跳余量防脏数据成环。 */
const MAX_RENAME_HOPS = 4;

/**
 * 把记下的行标识换成当前的模样。
 *
 * 滚动记忆按行标识存，而实时消息在「一轮结束、提升为历史消息」时会换标识（`client-core` 的
 * `renames` 就是不断累加的旧→新映射）。人离开标签页的时候一轮可能正好结束，回来时记下的还是
 * 那个旧标识；恢复前先按映射走一趟，位置才不会因为换过标识而丢掉。
 */
export function resolveAnchorRowId(rowId: string, renames: Readonly<Record<string, string>>): string {
	let current = rowId;
	for (let hop = 0; hop < MAX_RENAME_HOPS; hop += 1) {
		const next = renames[current];
		if (next === undefined || next === current) {
			return current;
		}
		current = next;
	}
	return current;
}

/** 切会话时要恢复到哪儿：按行标识记，不按像素记。 */
export interface TranscriptAnchor {
	/** 视口顶部那一行的标识 */
	readonly rowId: string;
	/** 那一行顶边到视口顶部的距离，可为负 */
	readonly offsetInRow: number;
}
