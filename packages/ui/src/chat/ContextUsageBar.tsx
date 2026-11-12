/**
 * 上下文用量条。
 *
 * 输入区上方一行：占用比例、已用与窗口大小，接近上限时换成提醒色；用量未知时明说未知；
 * 压缩进行中换成状态文字。右侧一个手动压缩入口，运行中或压缩中时不可点。
 */
import type { ContextUsage } from "@facet/protocol";
import { Minimize2 } from "lucide-react";

/** 到这个比例就提醒可以压缩。 */
const NEAR_LIMIT_PERCENT = 80;

/** 把 token 数收成便于阅读的写法：一万以上按千取一位，其余取整。 */
export function formatTokens(tokens: number): string {
	if (tokens >= 10_000) {
		return `${Math.round(tokens / 1000)}k`;
	}
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}k`;
	}
	return String(tokens);
}

/** 用量的一行说明。用量未知时给出明确说法，不留空。 */
export function usageLabel(usage: ContextUsage | undefined): string {
	if (usage === undefined) {
		return "上下文用量未知";
	}
	if (usage.tokens === null || usage.percent === null) {
		return "上下文用量未知";
	}
	const percent = Math.round(usage.percent);
	return `上下文 ${percent}% · ${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)}`;
}

export interface ContextUsageBarProps {
	/** 当前用量，未估算出来时为空 */
	usage: ContextUsage | undefined;
	/** 是否正在压缩 */
	isCompacting: boolean;
	/** 这一轮是否在跑，跑的时候不能压缩 */
	isRunning: boolean;
	/** 手动压缩 */
	onCompact: () => void;
}

export function ContextUsageBar({
	usage,
	isCompacting,
	isRunning,
	onCompact,
}: ContextUsageBarProps): React.JSX.Element {
	const percent = usage?.percent ?? null;
	const known = usage !== undefined && usage.tokens !== null && percent !== null;
	const isNearLimit = percent !== null && percent >= NEAR_LIMIT_PERCENT;
	const className = ["usage", isNearLimit ? "is-near" : ""].filter((part) => part.length > 0).join(" ");
	const canCompact = !isRunning && !isCompacting;

	return (
		<div className={className}>
			{known ? (
				<span className="usage-track" aria-hidden="true">
					<span className="usage-fill" style={{ width: `${Math.min(100, Math.max(2, percent))}%` }} />
				</span>
			) : null}
			<span className="usage-text">{isCompacting ? "正在压缩上下文…" : usageLabel(usage)}</span>
			{isNearLimit && !isCompacting ? <span className="usage-hint">接近上限，可以压缩</span> : null}
			<button
				type="button"
				className="usage-compact"
				onClick={onCompact}
				disabled={!canCompact}
				title={
					isCompacting ? "正在压缩" : isRunning ? "等这一轮结束再压缩" : "把较早的历史压成摘要，腾出上下文"
				}
			>
				<Minimize2 size={12} strokeWidth={1.6} />
				压缩
			</button>
		</div>
	);
}
