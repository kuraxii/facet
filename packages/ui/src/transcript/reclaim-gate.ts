/**
 * 静默回收的判据。
 *
 * 回收本身（裁 `view.items`、回退游标）在 `@facet/client-core`；这里只回答一个问题：**这一刻
 * 能不能裁**。条件写成纯函数，是为了把"流式中不裁""离开裁剪线不到十行不裁""用户还在翻旧页
 * 不裁"这些红线一条条钉在单测里，而不是散落在 effect 的 if 里。
 *
 * 每 5 分钟问一次；被任何一条挡住都只是这一轮不裁，等下一轮。
 */

/** 检查周期。 */
export const RECLAIM_INTERVAL_MS = 5 * 60 * 1000;

/** 最近一次交互之后的静默期：这段时间里有滚动、指针或按键就不动。 */
export const IDLE_GUARD_MS = 10_000;

/** 视口顶边距裁剪线至少隔这么多行才动手，给"往上滑一点"留出余量。 */
export const VIEWPORT_BUFFER_ROWS = 10;

/** 这一轮不裁的原因。 */
export type ReclaimBlock =
	/** 装载量还没超过两页水位 */
	| "below-watermark"
	/** 找不到对齐到整轮的裁剪点 */
	| "no-cut"
	/** 正在流式输出 */
	| "streaming"
	/** 正在程序化滚动（平滑跳转） */
	| "jumping"
	/** 正在补更早的历史 */
	| "loading-older"
	/** 十秒内有滚动、指针或按键 */
	| "recent-interaction"
	/** 有非空文本选区 */
	| "selection"
	/** 窗口不可见或滚动区没有高度 */
	| "hidden"
	/** 行元素数与行模型对不上，布局还没落稳 */
	| "no-rows"
	/** 视口还停在更早的历史页，离裁剪线不足十行 */
	| "old-page";

/** 判据的输入。 */
export interface ReclaimGateInput {
	/** 当前会话已装载的条目数 */
	entryCount: number;
	/** 保留水位：不少于这么多条 */
	retainMaxEntries: number;
	/** 是否正在流式输出 */
	isStreaming: boolean;
	/** 是否正在程序化滚动 */
	isJumping: boolean;
	/** 是否正在补更早的历史 */
	isLoadingOlder: boolean;
	/** 距最后一次滚动、指针或按键多少毫秒 */
	idleMs: number;
	/** 是否存在非空文本选区 */
	hasSelection: boolean;
	/** 窗口是否可见 */
	isVisible: boolean;
	/** 滚动区的可见高度 */
	viewportHeight: number;
	/** 正文里实际挂着几条行 */
	rowCount: number;
	/** 裁剪线所在的行下标；找不到时为空 */
	cutRowIndex: number | undefined;
	/** 视口里最顶部那一行的下标；整个视口没有行时为空 */
	firstVisibleRowIndex: number | undefined;
}

/** 判据的结论。 */
export interface ReclaimDecision {
	/** 这一轮要不要裁 */
	go: boolean;
	/** 不裁的原因；要裁时为空 */
	block: ReclaimBlock | undefined;
	/** 要裁时钉住位置用的锚点行：视口最顶那一行 */
	anchorRowIndex: number | undefined;
}

/** 决定这一轮能不能裁。 */
export function decideHistoryReclaim(input: ReclaimGateInput): ReclaimDecision {
	const block: ReclaimBlock | undefined = blockedBy(input);
	return block === undefined
		? { go: true, block: undefined, anchorRowIndex: input.firstVisibleRowIndex }
		: { go: false, block, anchorRowIndex: undefined };
}

/** 按顺序过一遍闸门，第一条命中的就是原因。 */
function blockedBy(input: ReclaimGateInput): ReclaimBlock | undefined {
	if (input.entryCount <= input.retainMaxEntries) {
		return "below-watermark";
	}
	if (input.isStreaming) {
		return "streaming";
	}
	if (input.isJumping) {
		return "jumping";
	}
	if (input.isLoadingOlder) {
		return "loading-older";
	}
	if (input.idleMs < IDLE_GUARD_MS) {
		return "recent-interaction";
	}
	if (input.hasSelection) {
		return "selection";
	}
	// 不可见或没有高度时量不出视口：这时候读到的位置没有意义，宁可放过一轮
	if (!input.isVisible || input.viewportHeight <= 0) {
		return "hidden";
	}
	if (input.cutRowIndex === undefined) {
		return "no-cut";
	}
	if (input.rowCount <= 0 || input.firstVisibleRowIndex === undefined) {
		return "no-rows";
	}
	// 红线：用户还在更早的历史里读，离裁剪线不到十行就不动，绝不把人拽回去
	if (input.firstVisibleRowIndex < input.cutRowIndex + VIEWPORT_BUFFER_ROWS) {
		return "old-page";
	}
	return undefined;
}
