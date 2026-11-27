/**
 * 纯逻辑：由消息记录与会话统计计算 tok/s 速度、累计 Token 与上下文明细校准。
 */
import type {
	AssistantMessage,
	ContextBreakdown,
	ContextBreakdownCategory,
	ContextCategoryId,
	Message,
	SessionStats,
	TokenTotals,
} from "@facet/protocol";

/** 单次生成速度统计时过滤极短回复，避免几毫秒极小样本拉偏峰值。 */
const PEAK_MIN_OUTPUT_TOKENS = 20;

/** 对齐校准后的单个上下文分类。 */
export interface AlignedContextCategory extends ContextBreakdownCategory {
	/** 占上下文窗口的百分比；窗口未知时为空 */
	readonly percent: number | null;
}

/** 校准后的上下文拆解视图数据。 */
export interface AlignedContextBreakdown {
	readonly usedTokens: number;
	readonly contextWindow: number;
	readonly usedPercent: number | null;
	readonly freeTokens: number | null;
	readonly freePercent: number | null;
	readonly isEstimated: boolean;
	readonly categories: readonly AlignedContextCategory[];
}

/** 最近一次请求的缓存命中分布。 */
export interface CacheHitBreakdown {
	readonly totalInput: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly newInput: number;
	readonly cacheReadPercent: number;
	readonly cacheWritePercent: number;
	readonly newInputPercent: number;
}

/** 会话级 Token、费用、耗时与 tok/s 速度汇总。 */
export interface SessionTelemetry {
	readonly tokens: TokenTotals;
	readonly reasoningTokens: number;
	readonly cost: number;
	readonly userMessages: number;
	readonly assistantMessages: number;
	readonly toolCalls: number;
	readonly cacheHitPercent: number | null;
	readonly latestTps: number | null;
	readonly avgTps: number | null;
	readonly peakTps: number | null;
	readonly modelTimeMs: number | null;
	readonly toolTimeMs: number | null;
}

/** 根据模型回报总用量（若可用）用最大余数法按比例分摊各分类 token，使各项加和精确等于总占用。 */
export function alignContextBreakdown(breakdown: ContextBreakdown): AlignedContextBreakdown {
	const contextWindow = Math.max(breakdown.contextWindow, 0);
	const hasReported = breakdown.reportedTokens !== null && breakdown.reportedTokens > 0;
	const isEstimated = !hasReported;
	const usedTokens = hasReported ? (breakdown.reportedTokens as number) : breakdown.estimatedTokens;
	const rawTotal = breakdown.estimatedTokens;

	let allocatedCounts: number[];
	if (hasReported && rawTotal > 0 && breakdown.categories.length > 0) {
		const exactShares = breakdown.categories.map((cat) => (usedTokens * Math.max(0, cat.tokens)) / rawTotal);
		allocatedCounts = exactShares.map(Math.floor);
		const remainder = usedTokens - allocatedCounts.reduce((sum, count) => sum + count, 0);
		const order = exactShares
			.map((value, index) => ({ index, rem: value - (allocatedCounts[index] ?? 0) }))
			.sort((a, b) => b.rem - a.rem);
		for (let i = 0; i < remainder; i += 1) {
			const target = order[i % order.length];
			if (target !== undefined) {
				allocatedCounts[target.index] = (allocatedCounts[target.index] ?? 0) + 1;
			}
		}
	} else {
		allocatedCounts = breakdown.categories.map((cat) => cat.tokens);
	}

	const toPercent = (tokens: number): number | null =>
		contextWindow > 0 ? Number(((tokens / contextWindow) * 100).toFixed(1)) : null;

	const categories: AlignedContextCategory[] = breakdown.categories.map((cat, index) => {
		const tokens = allocatedCounts[index] ?? cat.tokens;
		return {
			...cat,
			tokens,
			percent: toPercent(tokens),
		};
	});

	const freeTokens = contextWindow > 0 ? Math.max(0, contextWindow - usedTokens) : null;
	const usedPercent =
		breakdown.reportedPercent !== null ? Number(breakdown.reportedPercent.toFixed(1)) : toPercent(usedTokens);

	return {
		usedTokens,
		contextWindow,
		usedPercent,
		freeTokens,
		freePercent: freeTokens === null ? null : toPercent(freeTokens),
		isEstimated,
		categories,
	};
}

/** 计算最近一次有效请求中的缓存读取/写入/新增输入比例。 */
export function computeCacheHitBreakdown(
	usage: ContextBreakdown["latestRequestUsage"],
): CacheHitBreakdown | null {
	if (usage === undefined) {
		return null;
	}
	const totalInput = usage.input + usage.cacheRead + usage.cacheWrite;
	if (totalInput <= 0) {
		return null;
	}
	return {
		totalInput,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		newInput: usage.input,
		cacheReadPercent: Number(((usage.cacheRead / totalInput) * 100).toFixed(1)),
		cacheWritePercent: Number(((usage.cacheWrite / totalInput) * 100).toFixed(1)),
		newInputPercent: Number(((usage.input / totalInput) * 100).toFixed(1)),
	};
}

/** 各类目在进度条中的语义色令牌名（均来自 theme.css）。 */
export const CATEGORY_TONE: Record<ContextCategoryId, string> = {
	"system-prompt": "prompt",
	"context-files": "files",
	skills: "skills",
	"built-in-tools": "tools",
	"custom-tools": "tools",
	"mcp-tools": "tools",
	"user-messages": "user",
	"assistant-messages": "assistant",
	"assistant-thinking": "thinking",
	"tool-calls": "calls",
	"tool-output": "output",
	extensions: "extensions",
	"compacted-data": "compacted",
};

/** 计算单条已完成助手消息的生成速度（tok/s）。 */
export function messageTps(message: AssistantMessage): number | null {
	if (message.stopReason === "pending") {
		return null;
	}
	const output = message.usage.output;
	const durationMs = message.durationMs;
	if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0 || output <= 0) {
		return null;
	}
	return Number(((output * 1000) / durationMs).toFixed(1));
}

/** 流式生成中的实时估算速度（按字符数 / 4 估算输出 token）。 */
export function estimateStreamingTps(streamingChars: number, elapsedMs: number): number | null {
	if (elapsedMs < 350 || streamingChars < 12) {
		return null;
	}
	const estimatedTokens = Math.ceil(streamingChars / 4);
	return Number(((estimatedTokens * 1000) / elapsedMs).toFixed(1));
}

/** 汇总当前会话的 Token、缓存命中、耗时与 tok/s 速度统计。 */
export function computeSessionTelemetry(
	messages: readonly Message[],
	stats?: SessionStats,
): SessionTelemetry {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let reasoning = 0;
	let cost = 0;
	let userMessages = 0;
	let assistantMessages = 0;
	let toolCalls = 0;

	let timedOutput = 0;
	let timedDurationMs = 0;
	let modelTimeMs = 0;
	let toolTimeMs = 0;
	let latestTps: number | null = null;
	let peakTpsQualified: number | null = null;
	let peakTpsAny: number | null = null;

	for (const message of messages) {
		if (message.role === "user") {
			userMessages += 1;
			continue;
		}
		if (message.role === "toolResult") {
			if (message.durationMs !== undefined && message.durationMs > 0) {
				toolTimeMs += message.durationMs;
			}
			continue;
		}
		if (message.role !== "assistant") {
			continue;
		}
		assistantMessages += 1;
		for (const block of message.content) {
			if (block.type === "toolCall") {
				toolCalls += 1;
			}
		}
		if (message.stopReason === "pending") {
			continue;
		}
		input += message.usage.input;
		output += message.usage.output;
		cacheRead += message.usage.cacheRead;
		cacheWrite += message.usage.cacheWrite;
		reasoning += message.usage.reasoning;
		cost += message.usage.cost.total;

		if (message.durationMs !== undefined && message.durationMs > 0) {
			modelTimeMs += message.durationMs;
			if (message.usage.output > 0) {
				timedOutput += message.usage.output;
				timedDurationMs += message.durationMs;
				const tps = Number(((message.usage.output * 1000) / message.durationMs).toFixed(1));
				latestTps = tps;
				if (peakTpsAny === null || tps > peakTpsAny) {
					peakTpsAny = tps;
				}
				if (message.usage.output >= PEAK_MIN_OUTPUT_TOKENS) {
					if (peakTpsQualified === null || tps > peakTpsQualified) {
						peakTpsQualified = tps;
					}
				}
			}
		}
	}

	const tokens: TokenTotals = stats
		? stats.tokens
		: {
				input,
				output,
				cacheRead,
				cacheWrite,
				total: input + output + cacheRead + cacheWrite,
			};

	const totalInput = tokens.input + tokens.cacheRead + tokens.cacheWrite;
	const cacheHitPercent = totalInput > 0 ? Number(((tokens.cacheRead / totalInput) * 100).toFixed(1)) : null;
	const avgTps = timedDurationMs > 0 ? Number(((timedOutput * 1000) / timedDurationMs).toFixed(1)) : null;

	return {
		tokens,
		reasoningTokens: reasoning,
		cost: stats ? stats.cost : cost,
		userMessages: stats ? stats.userMessages : userMessages,
		assistantMessages: stats ? stats.assistantMessages : assistantMessages,
		toolCalls: stats ? stats.toolCalls : toolCalls,
		cacheHitPercent,
		latestTps,
		avgTps,
		peakTps: peakTpsQualified ?? peakTpsAny,
		modelTimeMs: modelTimeMs > 0 ? modelTimeMs : null,
		toolTimeMs: toolTimeMs > 0 ? toolTimeMs : null,
	};
}

/** 格式化毫秒耗时，便于统计行展示。 */
export function formatTelemetryDuration(ms: number | null): string {
	if (ms === null || !Number.isFinite(ms) || ms <= 0) {
		return "-";
	}
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	const sec = ms / 1000;
	if (sec < 60) {
		return `${sec.toFixed(1)}s`;
	}
	const min = Math.floor(sec / 60);
	const remSec = Math.round(sec % 60);
	return `${min}m ${remSec}s`;
}

/** 格式化美元参考费用。 */
export function formatTelemetryCost(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) {
		return "$0.00";
	}
	return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

/** 速度表满刻度上限（tok/s），覆盖主流在线推理速率区间。 */
const GAUGE_MAX_TPS = 120;

/**
 * 将输出速度（tok/s）映射为 Lucide `Gauge` 指针相对默认朝向（+45°）的 CSS 旋转角。
 *
 * Lucide `Gauge` 的表盘圆弧以 SVG 坐标 `(12, 14)` 为圆心跨越 `-120°..+120°`；
 * 两端各留 10° 余量映射到 `-110°..+110°`，无速度数据时停在最左侧 `-110°`。
 */
export function gaugeNeedleRotateDeg(tps: number | null): number {
	const ratio = tps === null || !Number.isFinite(tps) ? 0 : Math.max(0, Math.min(1, tps / GAUGE_MAX_TPS));
	const targetDeg = -110 + ratio * 220;
	return Math.round(targetDeg - 45);
}
