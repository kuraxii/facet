/**
 * 会话条目转协议结构，以及从分支尾部增量抽取新落盘条目。
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Entry, EntryKind } from "@facet/protocol";
import { toMessage } from "./convert.ts";

/** 一条新落盘条目及其对应的流式消息序号（若来源于流式消息）。 */
export interface CommittedEntryItem {
	/** 写盘后的协议条目 */
	readonly entry: Entry;
	/** 对应的 `message_start` 顺序号 */
	readonly messageSeq?: number;
}

/** 把持久化条目转成对外条目，只保留界面需要的字段。 */
export function toEntry(entry: SessionEntry): Entry {
	const base: Entry = {
		id: entry.id,
		parentId: entry.parentId,
		kind: entry.type as EntryKind,
		timestamp: entry.timestamp,
	};
	switch (entry.type) {
		case "message":
			return { ...base, message: toMessage(entry.message) };
		case "compaction":
		case "branch_summary":
			return { ...base, summary: entry.summary };
		case "session_info":
			return { ...base, name: entry.name };
		default:
			return base;
	}
}

/**
 * 从当前活动分支中截取 `afterLeafId` 之后新写入的条目，并与先前记录的流式消息匹配。
 *
 * `pi-coding-agent` 的 `message_end` 监听先于 `SessionManager.appendMessage` 触发，但在同一次
 * 同步栈内立即写盘；因此在随后的微任务或下一节点按对象引用与分支边界补齐配对，既不需要
 * 等整轮结束，也不依赖全量条目计数。
 */
export function collectCommittedEntries(
	branch: readonly SessionEntry[],
	afterLeafId: string | null,
	startedMessages: WeakMap<object, number>,
	pendingCustomMessageSeqs: number[],
): CommittedEntryItem[] {
	let start = 0;
	if (afterLeafId !== null) {
		const index = branch.findIndex((entry) => entry.id === afterLeafId);
		if (index < 0) {
			return [];
		}
		start = index + 1;
	}
	const committed: CommittedEntryItem[] = [];
	for (const rawEntry of branch.slice(start)) {
		const entry = toEntry(rawEntry);
		let messageSeq: number | undefined;
		if (rawEntry.type === "message") {
			messageSeq = startedMessages.get(rawEntry.message);
			if (messageSeq !== undefined) {
				startedMessages.delete(rawEntry.message);
			}
		} else if (rawEntry.type === "custom_message") {
			messageSeq = pendingCustomMessageSeqs.shift();
		}
		committed.push(messageSeq === undefined ? { entry } : { entry, messageSeq });
	}
	return committed;
}
