/**
 * 把主机侧与插件发来的通知翻译成轻提示。
 *
 * 两路来源都只追加：`chat/notice` 落在对话通道上，插件的 `ctx.ui.notify` 落在会话状态的
 * `extensionUi.notices` 上。这里按「上次看到第几条」取增量，避免切换会话时把旧通知重弹一遍。
 *
 * 计数与尾巴都是纯粹的比较逻辑，单独抽出来配用例；计时与弹窗留在调用方。
 */

/** 只看这两件事：通知按等级与内容去重。 */
export interface NoticeLike {
	/** 等级 */
	level: "info" | "warning" | "error";
	/** 事实内容 */
	message: string;
}

/** 一条通知来源已经消费到哪：条数与最后一条的签名。 */
export interface NoticeCursor {
	/** 已经消费过的条数 */
	count: number;
	/** 最后一条的「等级:内容」，用于识别整份清单被替换或计数到顶后再滚动 */
	tail: string | undefined;
}

/** 一条通知的签名。 */
function signature(notice: NoticeLike): string {
	return `${notice.level}:${notice.message}`;
}

/** 一份清单的尾巴签名，空清单为空。 */
export function noticesTail(notices: readonly NoticeLike[]): string | undefined {
	const last = notices[notices.length - 1];
	return last === undefined ? undefined : signature(last);
}

/**
 * 取出一组通知里新冒出来的那些，并给出新的游标。
 *
 * - 条数变多：只有「原游标位置的内容还能对上」才算增量，否则视为整份清单换过（切了会话），
 *   只记基线不重报；
 * - 条数不变：可能到了上限后滚动淘汰，尾巴换过就只补最后一条；
 * - 条数变少：被清空或截断，同样只记基线。
 */
export function freshNotices(
	cursor: NoticeCursor,
	notices: readonly NoticeLike[],
): { cursor: NoticeCursor; fresh: readonly NoticeLike[] } {
	const next: NoticeCursor = { count: notices.length, tail: noticesTail(notices) };
	if (notices.length < cursor.count) {
		return { cursor: next, fresh: [] };
	}
	if (notices.length > cursor.count) {
		const anchor = notices[cursor.count - 1];
		const continuous = cursor.count === 0 || (anchor !== undefined && signature(anchor) === cursor.tail);
		return continuous ? { cursor: next, fresh: notices.slice(cursor.count) } : { cursor: next, fresh: [] };
	}
	const last = notices[notices.length - 1];
	if (notices.length === 0 || last === undefined || signature(last) === cursor.tail) {
		return { cursor: next, fresh: [] };
	}
	return { cursor: next, fresh: [last] };
}
