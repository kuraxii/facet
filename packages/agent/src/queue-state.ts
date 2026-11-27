/**
 * 排队消息镜像同步与回收合并的纯逻辑。
 *
 * `pi-coding-agent` 的 `clearQueue()` 只返回纯文本数组且不提供单条移除接口；
 * 这里把带有完整图片附件的本地队列快照与 SDK 文本清单对齐，保证：
 * 1. 已进入模型生成（`message_start`）的插话按真实消耗从队列头移除；
 * 2. 点击撤回或中止回收时尽量保留对应的图片附件，并兜底兼容扩展直接入队的纯文本。
 */
import type { ImageBlock } from "@facet/protocol";

/** 排队中的单条用户输入快照（含可选图片附件）。 */
export interface QueuedMessageItem {
	readonly text: string;
	readonly images?: ImageBlock[];
}

/**
 * 根据 SDK 当前仍待发送的文本顺序，把本地镜像队列对齐到最新状态。
 *
 * `pi-coding-agent` 在每条排队消息开始处理时移除对应元素，扩展也可能直接向队列追加文本；
 * 这里按当前活跃列表依次匹配并消耗本地项，未在镜像里找到的条目补成纯文本项。
 */
export function syncSteeringMirror(
	mirror: readonly QueuedMessageItem[],
	activeTexts: readonly string[],
): QueuedMessageItem[] {
	if (activeTexts.length === 0) {
		return [];
	}
	const pool = [...mirror];
	const next: QueuedMessageItem[] = [];
	for (const text of activeTexts) {
		const index = pool.findIndex((item) => item.text === text);
		if (index >= 0) {
			const [matched] = pool.splice(index, 1);
			if (matched !== undefined) {
				next.push(matched);
				continue;
			}
		}
		next.push({ text });
	}
	return next;
}

/** 把从 SDK `clearQueue()` 取出的纯文本条目与本地镜像里的图片附件合并。 */
export function mergeClearedSteering(
	mirror: readonly QueuedMessageItem[],
	clearedTexts: readonly string[],
): QueuedMessageItem[] {
	return syncSteeringMirror(mirror, clearedTexts);
}
