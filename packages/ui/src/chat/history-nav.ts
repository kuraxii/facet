/**
 * 输入框里的历史回溯。
 *
 * 按 `↑` 从最近一条已发消息往回翻，按 `↓` 往前走，越过最后一条就回到自己写了一半的草稿。
 * 这里只有纯变换：翻到哪一条、要不要还原草稿都是算出来的，键盘与编辑器不参与——
 * 测试也不必挂一个编辑器。
 *
 * 语义照 shell：进浏览态的那一刻把当前草稿存起来，退出时原样还回去；到最旧的一条就停住，
 * 不会绕回最新。
 */

/** 浏览态：正在看第几条，以及进浏览态之前用户自己写的那份草稿。 */
export interface HistoryNavState {
	/** 正在看第几条（0 是最旧的一条）；不在浏览态时为空 */
	index: number | null;
	/** 进浏览态之前用户自己写的草稿，退出浏览态时还给他；不在浏览态时为空 */
	savedDraft: string | null;
}

/** 一次翻动的结果：新的浏览态，以及要铺进输入框的文本。 */
export interface HistoryNavStep {
	/** 翻完之后的状态 */
	state: HistoryNavState;
	/** 要铺进去的文本；`null` 表示这一下不关历史的事，交给编辑器自己处理 */
	text: string | null;
}

/**
 * 归一化已发消息：去掉空白项，连续重复的只留一条。
 *
 * 连发两遍同一句话在回溯里看不出区别，留着只会让人多按几下 `↑`；不相邻的重复要保留——
 * 那是两次真实的发送。
 */
export function normalizeHistory(history: readonly string[]): string[] {
	const kept: string[] = [];
	for (const raw of history) {
		const text = raw.trim();
		if (text.length === 0 || text === kept[kept.length - 1]) {
			continue;
		}
		kept.push(text);
	}
	return kept;
}

/** 回到初始态：不在浏览态，也没有存下来的草稿。 */
export function resetHistoryNav(): HistoryNavState {
	return { index: null, savedDraft: null };
}

/**
 * 往回翻一条。
 *
 * 第一次翻时把 `currentText` 存成草稿——退出浏览态要还回去的正是它。已经翻到最旧的一条时
 * 原样返回，`text` 为空，让 `↑` 回到编辑器自己的行内移动。
 */
export function stepHistoryUp(
	state: HistoryNavState,
	history: readonly string[],
	currentText: string,
): HistoryNavStep {
	if (history.length === 0) {
		return { state, text: null };
	}
	if (state.index === null) {
		const index = history.length - 1;
		return { state: { index, savedDraft: currentText }, text: history[index] ?? null };
	}
	if (state.index === 0) {
		return { state, text: null };
	}
	const index = state.index - 1;
	return { state: { index, savedDraft: state.savedDraft }, text: history[index] ?? null };
}

/**
 * 往前翻一条。
 *
 * 只在浏览态里生效：不在浏览态时返回空文本，`↓` 还是普通的光标下移。越过最新的一条就退出
 * 浏览态，把草稿原样还回去（没存过草稿时还的是一个空串，也就是把输入框清空）。
 */
export function stepHistoryDown(state: HistoryNavState, history: readonly string[]): HistoryNavStep {
	if (state.index === null) {
		return { state, text: null };
	}
	if (state.index < history.length - 1) {
		const index = state.index + 1;
		return { state: { index, savedDraft: state.savedDraft }, text: history[index] ?? null };
	}
	return { state: resetHistoryNav(), text: state.savedDraft ?? "" };
}
