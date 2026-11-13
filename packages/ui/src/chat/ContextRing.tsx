/**
 * 上下文用量环，摆输入区的动作行里、发送按钮左边。
 *
 * 未给出数值时只画一圈底环并在说明里写「暂无数据」，不把未知画成 0%。接近上限换成提醒色，
 * 越过 90% 换成错误色。点一下打开浮层，里面有具体数值与手动压缩入口。
 */
import type { ContextUsage } from "@facet/protocol";

/** 讲占用的说法，未知时也有一句明确的。 */
export function usageLabel(usage: ContextUsage | undefined): string {
	if (usage === undefined || usage.tokens === null || usage.percent === null) {
		return "上下文窗口：暂无数据";
	}
	const percent = Math.round(usage.percent);
	return `上下文窗口已使用 ${percent}% · ${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)}`;
}

/** token 数收成便于阅读的写法：一万以上按千取整，千位保留一位小数。 */
export function formatTokens(tokens: number): string {
	if (tokens >= 10_000) {
		return `${Math.round(tokens / 1000)}k`;
	}
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}k`;
	}
	return String(tokens);
}

/** 占用比例的档位：普通、提醒、危险。 */
export type UsageLevel = "normal" | "warn" | "danger";

/** 由百分比取档位。取不到百分比时按普通处理。 */
export function usageLevel(percent: number | null): UsageLevel {
	if (percent === null) {
		return "normal";
	}
	if (percent > 90) {
		return "danger";
	}
	return percent >= 70 ? "warn" : "normal";
}

/** 圆弧颜色，跟着界面令牌走。 */
const RING_STROKE: Record<UsageLevel, string> = {
	normal: "var(--t2)",
	warn: "var(--warn)",
	danger: "var(--err)",
};

export interface ContextRingProps {
	/** 当前用量，未估算出来时为空 */
	usage: ContextUsage | undefined;
	/** 直径，缺省 16 */
	size?: number;
	/** 线宽，缺省 2 */
	strokeWidth?: number;
}

export function ContextRing({ usage, size = 16, strokeWidth = 2 }: ContextRingProps): React.JSX.Element {
	const radius = (size - strokeWidth) / 2;
	const center = size / 2;
	const circumference = 2 * Math.PI * radius;
	const valid =
		usage !== undefined && usage.tokens !== null && usage.percent !== null && usage.contextWindow > 0;
	const percent = valid ? Math.max(0, Math.min(100, usage.percent as number)) : null;
	const level = usageLevel(percent);
	const label = usageLabel(usage);

	return (
		<span className="ctx-ring" role="img" aria-label={label} title={label}>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
				<circle
					cx={center}
					cy={center}
					r={radius}
					fill="none"
					stroke="var(--surface3)"
					strokeWidth={strokeWidth}
				/>
				{percent === null || percent <= 0 ? null : (
					<circle
						cx={center}
						cy={center}
						r={radius}
						fill="none"
						stroke={RING_STROKE[level]}
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						strokeDasharray={circumference}
						strokeDashoffset={circumference - (percent / 100) * circumference}
						transform={`rotate(-90 ${center} ${center})`}
					/>
				)}
			</svg>
		</span>
	);
}
