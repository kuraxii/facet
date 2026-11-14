/**
 * 会话行首的状态标记。
 *
 * 槽位尺寸固定，只有里面的画法随状态变，所以标题不会因为状态切换而左右跳动。
 * 颜色都在 `session-status.ts` 里映射，这里只管画。
 */

import { CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { type SessionStatusBucket, STATUS_RING_PERIOD_MS, statusBucketLabel } from "./session-status.ts";

/** 状态标记参数。 */
export interface SessionStatusMarkProps {
	/** 这一行此刻的分档 */
	bucket: SessionStatusBucket;
}

export function SessionStatusMark({ bucket }: SessionStatusMarkProps) {
	return (
		<span
			className={`status-mark is-${bucket}`}
			role="status"
			aria-label={statusBucketLabel(bucket)}
			data-status={bucket}
		>
			{bucket === "running" ? <StatusRing /> : null}
			{bucket === "needs_input" ? <CircleAlert size={12} strokeWidth={2} aria-hidden="true" /> : null}
			{bucket === "attention" || bucket === "failed" || bucket === "done" ? (
				<span className="status-dot" aria-hidden="true" />
			) : null}
		</span>
	);
}

/**
 * 运行中的环。
 *
 * 两层圆环叠出来：闭合的轨道环（30% 透明）+ 只留上边框的弧（90% 透明），中间再放一个与
 * 其他状态同尺寸的实心点。弧用 Web Animations API 转，`startTime = 0` 让所有环共用文档时间
 * 轴的起点，后插入的环与在转的环对得上。
 */
function StatusRing() {
	const arcRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const arc = arcRef.current;
		if (arc === null || typeof arc.animate !== "function") {
			return;
		}
		// 系统要求减少动效时保持静止，环本身仍然能表达「在忙」
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			return;
		}
		const animation = arc.animate(
			{ transform: ["rotate(0deg)", "rotate(360deg)"] },
			{ duration: STATUS_RING_PERIOD_MS, easing: "linear", iterations: Number.POSITIVE_INFINITY },
		);
		animation.startTime = 0;
		return () => animation.cancel();
	}, []);

	return (
		<span className="status-ring" aria-hidden="true">
			<span className="status-ring-track" />
			<span className="status-ring-arc" ref={arcRef} />
			<span className="status-ring-dot" />
		</span>
	);
}
