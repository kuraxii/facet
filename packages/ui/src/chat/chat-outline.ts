/**
 * 对话导航。
 *
 * 正文旁边的一条竖轨，每条用户消息对应一根短条：当前读到的轮次加长，指针附近的几根按
 * 距离放大，悬浮时在旁边给出那一条的开头。点一下跳到那一条。
 */
import type { TranscriptItem } from "@facet/client-core";

/** 导航条上的一项，对应一条用户消息。 */
export interface OutlinePrompt {
	/** 定位用的键，与正文行上的 data-outline-key 一致 */
	key: string;
	/** 悬浮预览里显示的文字 */
	preview: string;
}

/**
 * 导航要几个条目才值得画。
 *
 * 只有一轮对话时竖轨上没有可跳的东西；达到这个条数才渲染，与窗口宽度无关——宽度够不够
 * 由三列网格里的 `--outline-slot` 兜着，不再由脚本判断。
 */
export const OUTLINE_MIN_ITEMS = 2;

/** 这份对话有没有要画的导航。`ChatOutline` 与外壳的 `data-outline-active` 共用这一条判据。 */
export function outlineIsActive(prompts: readonly OutlinePrompt[]): boolean {
	return prompts.length >= OUTLINE_MIN_ITEMS;
}

/** 预览最多保留的字数。 */
const PREVIEW_MAX_CHARS = 120;

/** 一条消息的纯文本。思考与工具调用不进预览。 */
function textOfItem(item: TranscriptItem): string {
	const text = item.parts
		.map((part) => (part.kind === "text" ? part.text : ""))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS)}…` : text;
}

/**
 * 从渲染单元里取出导航条目。
 *
 * 只收用户消息：导航是按轮跳的，助手答复与工具调用都在某一轮里面。没有条目 id 的实时
 * 消息用视图标识顶上，提升成历史消息后键会跟着变，界面按新键重新对齐。
 */
export function outlinePrompts(
	items: readonly TranscriptItem[],
	fallback: (index: number) => string = (index) => `第 ${index} 条消息`,
): OutlinePrompt[] {
	const prompts: OutlinePrompt[] = [];
	for (const item of items) {
		if (item.kind !== "message" || item.role !== "user") {
			continue;
		}
		const key = item.entryId ?? item.id;
		const index = prompts.length + 1;
		prompts.push({ key, preview: textOfItem(item) || fallback(index) });
	}
	return prompts;
}

/**
 * 指针附近放大的范围，单位是条。
 *
 * 超出这个距离的条保持原样，长会话里只会鼓起指针周围的一小段，不会整列一起动。
 */
export const OUTLINE_MAGNIFY_RADIUS = 3;

/**
 * 放大倍数，指针所在的那条为 1，边缘为 0。
 *
 * 用升余弦做衰减，两端都没有折角，指针扫过时看起来是一团鼓起跟着走，而不是一段一段地亮灭。
 */
export function outlineTickMagnification(distance: number): number {
	const gap = Math.abs(distance);
	if (!Number.isFinite(gap) || gap >= OUTLINE_MAGNIFY_RADIUS) {
		return 0;
	}
	return (1 + Math.cos((Math.PI * gap) / OUTLINE_MAGNIFY_RADIUS)) / 2;
}

/**
 * 视口上沿所在的轮次。
 *
 * `topOf` 按序号给出「这一条相对视口上沿的偏移」，量不到时为 `undefined`；顶边随序号单调递增
 * （用户消息在正文里按出现顺序排列）。
 *
 * 滚动里每帧都要算一次，长会话上百条，所以按单调性二分：**每探一次才调一次 `topOf`**，量到的
 * 次数是 log N 而不是 N——后者每帧要为每条消息各读一次布局。
 */
export function activeOutlineIndex(
	count: number,
	topOf: (index: number) => number | undefined,
	viewportTop: number,
): number | null {
	// 尾部量不到的先切掉（没有位置或位置不是有限值）：它们不可能是答案，也让二分区间两端都有位置
	let end = count - 1;
	while (end >= 0) {
		const top = topOf(end);
		if (top !== undefined && Number.isFinite(top)) {
			break;
		}
		end -= 1;
	}
	if (end < 0) {
		return null;
	}
	let low = 0;
	let high = end;
	let active = -1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const top = topOf(middle);
		if (top === undefined || !Number.isFinite(top)) {
			// 中间夹着还没量出来的条目时单调前提不成立，二分不再可靠：退回线性扫描，宁可慢一次也不猜
			return scanActiveOutlineIndex(end, topOf, viewportTop);
		}
		if (top <= viewportTop) {
			active = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	// 一条都还没越过上沿（比如停在最顶部）：当前轮次就是第一条
	return Math.max(0, active);
}

/**
 * `activeOutlineIndex` 的线性兜底。
 *
 * 只在位置中间有缺口时用：这时顶边不再单调，二分的前提没了。结果与逐条比较一致。
 */
function scanActiveOutlineIndex(
	end: number,
	topOf: (index: number) => number | undefined,
	viewportTop: number,
): number {
	let active = 0;
	let hasPosition = false;
	for (let index = 0; index <= end; index += 1) {
		const top = topOf(index);
		if (top === undefined || !Number.isFinite(top)) {
			continue;
		}
		hasPosition = true;
		if (top <= viewportTop) {
			active = index;
		}
	}
	return hasPosition ? active : 0;
}

/** 首次进入时要停留多久才展开预览，毫秒。 */
const HOVER_ACTIVATION_DELAY_MS = 150;

/** 横向跨过整条竖轨多少像素算「只是路过」。 */
const HORIZONTAL_TRANSIT_PX = 4;

export interface OutlineHoverIntent {
	enter(point: { x: number; y: number }): void;
	/** 指针停在某一根上 */
	pointAt(index: number): void;
	move(point: { x: number; y: number }): void;
	leave(): void;
	dispose(): void;
}

/**
 * 悬浮意图判定。
 *
 * 直接跟着指针走会让竖轨每经过一次就闪一串预览，所以第一次进入要停一小会儿才展开；
 * 已经展开之后改成即时跟随。指针横向快速掠过时只算路过，不展开。
 */
export function createOutlineHoverIntent(input: {
	activate: (index: number | null) => void;
	schedule: (callback: () => void, delayMs: number) => number;
	cancel: (timerId: number) => void;
}): OutlineHoverIntent {
	let timerId: number | null = null;
	let candidateIndex: number | null = null;
	let anchor: { x: number; y: number } | null = null;
	let active = false;

	function cancelTimer(): void {
		if (timerId === null) {
			return;
		}
		input.cancel(timerId);
		timerId = null;
	}

	function scheduleActivation(): void {
		if (candidateIndex === null) {
			return;
		}
		cancelTimer();
		timerId = input.schedule(() => {
			timerId = null;
			active = true;
			if (candidateIndex !== null) {
				input.activate(candidateIndex);
			}
		}, HOVER_ACTIVATION_DELAY_MS);
	}

	return {
		enter(point) {
			anchor = point;
		},
		pointAt(index) {
			candidateIndex = index;
			if (active) {
				input.activate(index);
				return;
			}
			if (timerId !== null) {
				return;
			}
			scheduleActivation();
		},
		move(point) {
			if (active || anchor === null) {
				return;
			}
			const deltaX = point.x - anchor.x;
			const deltaY = point.y - anchor.y;
			if (Math.abs(deltaY) >= Math.abs(deltaX)) {
				anchor = point;
				return;
			}
			if (Math.abs(deltaX) < HORIZONTAL_TRANSIT_PX) {
				return;
			}
			anchor = point;
			scheduleActivation();
		},
		leave() {
			cancelTimer();
			candidateIndex = null;
			anchor = null;
			active = false;
			input.activate(null);
		},
		dispose() {
			cancelTimer();
			candidateIndex = null;
			anchor = null;
			active = false;
		},
	};
}
