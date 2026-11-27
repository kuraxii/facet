/**
 * 更早历史的静默裁剪。
 *
 * 会话翻到几百行之后，`view.items` 里压着全部已装载的历史，DOM 与布局对象都跟着涨。回收的
 * 做法是把"最新两页之前的条目"从视图里裁掉，把游标回退到保留区的首条，用户再往上翻时按这个
 * 游标重新取回同一段——条目 id 稳定且只追加（见 `packages/agent/src/pi-agent.ts` 的
 * `entryPage`），因此 `olderCursor` 不需要额外的页边界栈，直接用保留区首条的条目 id 即可。
 *
 * 裁剪点只认**轮的起点**（用户消息）：一行可以由多项渲染单元合成（过程行），也可以由后面
 * 的工具结果条目并入，切在别的条目上会把一行从中间劈开。找不到轮的起点就整轮跳过——不裁比
 * 裁错好。
 */
import type { ChatView, EntryView, ToolCallView } from "./state.ts";

/** 首屏装载的页数，也是裁剪后至少保留的页数。 */
export const RETAIN_MAX_PAGES = 2;

/** 一次裁剪的位置。 */
export interface HistoryTrimCut {
	/** 保留区的首条下标，同时也是被裁掉的条数 */
	cutIndex: number;
	/** 保留区首条的视图标识，界面据此在行模型里定位裁剪线 */
	cutViewId: string;
	/** 裁剪后回退到的游标：这条条目前面的历史都还没装载 */
	olderCursor: string;
}

/** 这一条是不是一轮的起点：带条目的用户消息，且已经写完。 */
function isTurnStart(view: EntryView): boolean {
	return view.entry !== undefined && view.message?.role === "user" && !view.isStreaming;
}

/** 由下标造出裁剪点；找不到可用条目时为空。 */
function cutAt(items: readonly EntryView[], index: number): HistoryTrimCut | undefined {
	const view = items[index];
	const entryId = view?.entry?.id;
	if (view === undefined || entryId === undefined) {
		return undefined;
	}
	return { cutIndex: index, cutViewId: view.id, olderCursor: entryId };
}

/**
 * 算出这次该从哪儿裁。
 *
 * `maxEntries` 是保留水位，由调用方按**当前客户端真实的页大小**给出（`pageSize * 首屏页数`）：
 * 写死一个数字就会与应用的配置脱开——应用用的是 200 条一页，差四倍。
 *
 * 先算出至少该裁掉多少（`items.length - maxEntries`），再**向前**找最近的一轮起点：宁可多留
 * 几轮，也不把保留区压到水位以下。前面已经没有可对齐的起点时（比如第一轮就跳过了水位）才向后找，
 * 宁可少留一些也不劈开一行。两处都找不到时返回空。
 */
export function planHistoryTrim(items: readonly EntryView[], maxEntries: number): HistoryTrimCut | undefined {
	if (items.length <= maxEntries) {
		return undefined;
	}
	const floor = items.length - Math.max(1, Math.trunc(maxEntries));
	// 反向只在确实有整轮可裁时才走：下标 0 的起点等于没裁，不算结果
	for (let index = floor; index >= 1; index -= 1) {
		const view = items[index];
		if (view !== undefined && isTurnStart(view)) {
			return cutAt(items, index);
		}
	}
	for (let index = floor + 1; index < items.length; index += 1) {
		const view = items[index];
		if (view !== undefined && isTurnStart(view)) {
			return cutAt(items, index);
		}
	}
	return undefined;
}

/** 一批条目引用到的工具调用 id：助手消息里的调用块，加上工具结果自身。 */
function callIdsOf(views: readonly EntryView[]): Set<string> {
	const ids = new Set<string>();
	for (const view of views) {
		const message = view.message;
		if (message === undefined) {
			continue;
		}
		if (message.role === "toolResult") {
			ids.add(message.callId);
			continue;
		}
		if (message.role !== "assistant") {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "toolCall") {
				ids.add(block.id);
			}
		}
	}
	return ids;
}

/**
 * 按裁剪点裁掉更早的条目。
 *
 * 工具调用状态与标识迁移一起修剪：`toTranscript` 会把"没有任何保留条目引用的工具调用"当成游离
 * 调用排在末尾，不修剪的话被裁掉那些调用会以孤立卡片的形式重新出现在对话底部。
 */
export function applyHistoryTrim(view: ChatView, cut: HistoryTrimCut): ChatView {
	const end = Math.min(Math.max(cut.cutIndex, 0), view.items.length);
	// 已经裁到这一步了（同一个裁剪点重复应用、或裁剪点已越界）：原样返回，动作幂等
	if (end <= 0 || view.items[0]?.id === cut.cutViewId) {
		return view;
	}
	const kept = view.items.slice(end);
	const droppedCalls = callIdsOf(view.items.slice(0, end));
	let toolCalls = view.toolCalls;
	if (droppedCalls.size > 0) {
		const keptCalls = callIdsOf(kept);
		let changed = false;
		const next: Record<string, ToolCallView> = {};
		for (const [callId, call] of Object.entries(view.toolCalls)) {
			if (droppedCalls.has(callId) && !keptCalls.has(callId)) {
				changed = true;
				continue;
			}
			next[callId] = call;
		}
		if (changed) {
			toolCalls = next;
		}
	}
	return { ...view, items: kept, toolCalls };
}
