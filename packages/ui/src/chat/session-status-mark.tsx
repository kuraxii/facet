/**
 * 会话行首的状态标记。
 *
 * 槽位尺寸固定，只有里面的画法随状态变，所以标题不会因为状态切换而左右跳动。
 * 颜色在 `styles/chat.css` 里取 `--dot-*`，这里只管画。
 */

import { CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { type SessionStatusBucket, STATUS_RING_PERIOD_MS, statusBucketLabel } from "./session-status.ts";

/** 状态标记参数。 */
export interface SessionStatusMarkProps {
	/** 这一行此刻的分档 */
	bucket: SessionStatusBucket;
}

export function SessionStatusMark({ bucket }: SessionStatusMarkProps) {
	const { t } = useI18n();
	return (
		<span
			className={`status-mark is-${bucket}`}
			role="status"
			aria-label={statusBucketLabel(bucket, t)}
			data-status={bucket}
		>
			{bucket === "running" ? <StatusRing /> : null}
			{bucket === "needs_input" ? <CircleAlert size={ICON_SIZE.sm} aria-hidden="true" /> : null}
			{bucket === "attention" || bucket === "failed" || bucket === "done" ? (
				<span className="status-dot" aria-hidden="true" />
			) : null}
		</span>
	);
}

/**
 * 运行中的环。
 *
 * 轨道、弧与中心的点画在一个 SVG 里，描边是几何路径：边框画法在缩放不是 1 的屏幕上四侧
 * 厚度不一，弧的端头也会因为相邻边框抗锯齿过渡变成渐隐的楔形。
 *
 * 转的是虚线的偏移量。`strokeDashoffset` 是绘制属性，每帧重画这一小块，弧在任何角度都保持
 * 同样的粗细；`transform: rotate()` 会被当作纹理旋转采样，12px 的图会糊一档。
 *
 * `pathLength` 把周长归一成 100，虚线就是百分数：`25 75` 是四分之一圈加四分之三空档，
 * 偏移走满 100 正好回到起点，一圈下来接缝处不跳。用 `getTotalLength()` 取不到这个数：
 * 它返回的是浏览器内部拉直的路径长度，比几何周长短一截，偏移走满它每个周期会错开一点。
 * 虚线写在属性上，不动效时也是一个完整的弧。
 *
 * `startTime = 0` 让所有环共用文档时间轴的起点，后插入的环与在转的环对得上。
 */
function StatusRing() {
	const arcRef = useRef<SVGCircleElement>(null);

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
			{ strokeDashoffset: ["0", "-100px"] },
			{ duration: STATUS_RING_PERIOD_MS, easing: "linear", iterations: Number.POSITIVE_INFINITY },
		);
		animation.startTime = 0;
		return () => animation.cancel();
	}, []);

	return (
		<svg className="status-ring" aria-hidden="true">
			<circle className="status-ring-track" />
			<circle className="status-ring-arc" ref={arcRef} pathLength={100} strokeDasharray="25 75" />
			<circle className="status-ring-dot" />
		</svg>
	);
}
