/**
 * 会话状态到侧栏分档的换算。
 *
 * 主机只报事实（在不在忙、最近一轮怎么收的尾、有几个交互在等人、已读到哪），
 * 界面的分档在这里推出来：一档对应一种画法，判定顺序就是优先级。
 */
import type { SessionStatus } from "@facet/protocol";

/** 侧栏行首的分档。 */
export type SessionBucket = "needs_input" | "failed" | "running" | "attention" | "done";

/**
 * 由主机状态推出分档。
 *
 * 顺序有讲究：等输入压过在忙（这一轮要人动手），在忙压过收尾（正跑着不该显示成上一个结果），
 * 未读压过已读。`settle` 里的结果只区分完成与失败，用户中止的一轮主机不记收尾。
 */
export function deriveBucket(status: SessionStatus): SessionBucket {
	if (status.pendingInput > 0) {
		return "needs_input";
	}
	if (status.activity !== "idle") {
		return "running";
	}
	if (status.settle === undefined || status.settle.at <= status.seenAt) {
		return "done";
	}
	return status.settle.outcome === "failed" ? "failed" : "attention";
}
