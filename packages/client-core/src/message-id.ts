/**
 * 消息标识。
 *
 * 历史投影出来的消息用会话条目 id 加前缀,与主机实时分配的标识分属两个命名空间,
 * 既不会相撞,也能从标识反查条目。
 */

/** 历史消息标识的前缀 */
const HISTORY_PREFIX = "e:";

/** 由会话条目 id 拼出历史消息的视图标识。 */
export function historyMessageId(entryId: string): string {
	return `${HISTORY_PREFIX}${entryId}`;
}

/** 历史消息是否是投影出来的。界面据此区分历史与本次连接产生的消息。 */
export function isHistoryMessageId(id: string): boolean {
	return id.startsWith(HISTORY_PREFIX);
}
