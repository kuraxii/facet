/**
 * 会话状态点的分档说明。
 *
 * 一档对应一种画法：运行中是环，等待输入是告警图标，需要关注是实心点，失败是带空隙的点，
 * 已完成是弱化的点。颜色在 `styles/chat.css` 里直接取 `--dot-*`，这里只管分档与读屏文案。
 */
import { createI18n, type Translate, translate } from "@facet/i18n";
import type { SessionStatus } from "@facet/protocol";

const fallbackI18n = createI18n("zh-CN");
const fallbackT = translate(fallbackI18n);

/** 侧栏行首的分档。一档对应一种画法。 */
export type SessionStatusBucket = "needs_input" | "failed" | "running" | "attention" | "done";

/**
 * 由主机状态推出分档。
 *
 * 主机只报事实（在不在忙、最近一轮怎么收的尾、有几个交互在等人、已读到哪），分档在这里
 * 推出来。顺序有讲究：等输入压过在忙（这一轮要人动手），在忙压过收尾（正跑着不该显示成
 * 上一个结果），未读压过已读。`settle` 里的结果只区分完成与失败，用户中止的一轮主机不记收尾。
 */
export function deriveBucket(status: SessionStatus): SessionStatusBucket {
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

/** 环转一圈的周期，毫秒。 */
export const STATUS_RING_PERIOD_MS = 900;

/** 分档给人看（读屏也与它一致）的说明。 */
export function statusBucketLabel(bucket: SessionStatusBucket, t: Translate = fallbackT): string {
	switch (bucket) {
		case "running":
			return t("sessionStatus.running");
		case "needs_input":
			return t("sessionStatus.needsInput");
		case "attention":
			return t("sessionStatus.attention");
		case "failed":
			return t("sessionStatus.failed");
		case "done":
			return t("sessionStatus.done");
	}
}
