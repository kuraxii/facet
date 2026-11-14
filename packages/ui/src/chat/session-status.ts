/**
 * 会话状态点的分档与配色。
 *
 * 一档对应一种画法：运行中是环，等待输入是告警图标，需要关注是实心点，失败是带描边的点，
 * 已完成是弱化的点。颜色只在这里映射一次，行、角标、分组头都从这里取。
 */

/** 侧栏行首的状态分档。 */
export type SessionStatusBucket = "running" | "needs_input" | "attention" | "failed" | "done";

/** 环转一圈的周期，毫秒。 */
export const STATUS_RING_PERIOD_MS = 900;

/**
 * 环此刻的旋转角。
 *
 * 相位按绝对时间算，不从挂载时刻起算：后加入列表的环与已经在转的环角度一致，不会各自从
 * 0° 起步。
 */
export function statusRingRotation(nowMs: number): number {
	const phase = ((nowMs % STATUS_RING_PERIOD_MS) + STATUS_RING_PERIOD_MS) % STATUS_RING_PERIOD_MS;
	return (phase / STATUS_RING_PERIOD_MS) * 360;
}

/**
 * 分档对应的强调色。
 *
 * `done` 没有强调色：它只是一个占住左侧导轨的弱化点，用中性色加透明度画。
 */
export function statusBucketColor(bucket: SessionStatusBucket): string | undefined {
	switch (bucket) {
		case "running":
			return "var(--dot-run)";
		case "needs_input":
			return "var(--dot-warn)";
		case "attention":
			return "var(--dot-ok)";
		case "failed":
			return "var(--dot-err)";
		case "done":
			return undefined;
	}
}

/** 分档给人看（读屏也与它一致）的说明。 */
export function statusBucketLabel(bucket: SessionStatusBucket): string {
	switch (bucket) {
		case "running":
			return "运行中";
		case "needs_input":
			return "等待输入";
		case "attention":
			return "有结果";
		case "failed":
			return "失败";
		case "done":
			return "已完成";
	}
}

/** 会话列表里已有的状态点取值，换算成画法分档。 */
export function statusBucketOfDot(dot: "running" | "compacting" | "idle"): SessionStatusBucket {
	// 压缩上下文也是这台会话在忙，画同一个环
	return dot === "idle" ? "done" : "running";
}
