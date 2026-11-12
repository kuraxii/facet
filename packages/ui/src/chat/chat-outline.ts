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
export function outlinePrompts(items: readonly TranscriptItem[]): OutlinePrompt[] {
	const prompts: OutlinePrompt[] = [];
	for (const item of items) {
		if (item.kind !== "message" || item.role !== "user") {
			continue;
		}
		const key = item.entryId ?? item.id;
		prompts.push({ key, preview: textOfItem(item) || `第 ${prompts.length + 1} 条消息` });
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
 * tops 是按顺序量到的每条用户消息相对视口上沿的偏移，取最后一个已经越过上沿的；
 * 都还没到（比如停在最顶部）时取第一条。
 */
export function activeOutlineIndex(tops: readonly number[], viewportTop: number): number | null {
	if (tops.length === 0) {
		return null;
	}
	let active = 0;
	for (let index = 0; index < tops.length; index += 1) {
		if ((tops[index] ?? Number.POSITIVE_INFINITY) <= viewportTop) {
			active = index;
		}
	}
	return active;
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
