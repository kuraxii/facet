/**
 * 会话 Token 与 tok/s 速度浮层，摆在输入区上下文环旁边。
 *
 * 速度指标纯由界面侧消息与流式增量算出；累计 Token 与费用优先使用会话快照，确保压缩或
 * 分页回收旧历史后统计仍完整准确。
 */
import type { Message, SessionStats } from "@facet/protocol";
import { Gauge } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { formatTokens } from "./ContextRing.tsx";
import {
	computeSessionTelemetry,
	estimateStreamingTps,
	formatTelemetryCost,
	formatTelemetryDuration,
	gaugeNeedleRotateDeg,
} from "./session-telemetry.ts";

export interface SessionStatsChipProps {
	/** 当前已加载的消息列表，用于计算单次/平均/峰值 tok/s 与用时 */
	readonly messages: readonly Message[];
	/** 当前正在流式输出的字符总数（文本 + 思考 + 工具参数） */
	readonly streamingChars: number;
	/** 是否正处于流式生成态 */
	readonly isStreaming: boolean;
	/** 主机同步的全会话累计统计 */
	readonly sessionStats: SessionStats | undefined;
	/** 浮层是否展开 */
	readonly isOpen: boolean;
	/** 切换展开态 */
	readonly onToggle: () => void;
}

export function SessionStatsChip({
	messages,
	streamingChars,
	isStreaming,
	sessionStats,
	isOpen,
	onToggle,
}: SessionStatsChipProps): React.JSX.Element {
	const { t } = useI18n();
	const tip = useHoverTip();
	const streamStartRef = useRef<number | null>(null);
	const [liveTps, setLiveTps] = useState<number | null>(null);

	useEffect(() => {
		if (!isStreaming || streamingChars <= 0) {
			streamStartRef.current = null;
			setLiveTps(null);
			return;
		}
		if (streamStartRef.current === null) {
			streamStartRef.current = performance.now();
		}
		const elapsed = performance.now() - streamStartRef.current;
		setLiveTps(estimateStreamingTps(streamingChars, elapsed));
	}, [isStreaming, streamingChars]);

	const telemetry = useMemo(() => computeSessionTelemetry(messages, sessionStats), [messages, sessionStats]);

	const displayTps = liveTps ?? telemetry.latestTps ?? telemetry.avgTps;
	const needleStyle = { "--gauge-deg": `${gaugeNeedleRotateDeg(displayTps)}deg` } as CSSProperties;

	return (
		<>
			<button
				type="button"
				className="composer-status-chip"
				data-chip="stats"
				style={needleStyle}
				onClick={onToggle}
				aria-expanded={isOpen}
				aria-label={t("stats.triggerLabel")}
				{...tip.handlers(t("stats.triggerLabel"))}
			>
				<Gauge size={ICON_SIZE.md} />
				{displayTps !== null ? <span>{displayTps.toFixed(1)} tok/s</span> : null}
			</button>

			{isOpen ? (
				// biome-ignore lint/a11y/useSemanticElements: 浮层展示会话统计只读指标，不用 fieldset 语义
				<div className="chip-pop is-stats" role="group" aria-label={t("stats.title")}>
					<p className="ctx-pop-title">{t("stats.title")}</p>

					<div className="stats-list">
						{liveTps !== null ? (
							<div className="stats-row">
								<span className="stats-label">{t("stats.speedLive")}</span>
								<span className="stats-val">{liveTps.toFixed(1)} tok/s</span>
							</div>
						) : null}
						<div className="stats-row">
							<span className="stats-label">{t("stats.speedLatest")}</span>
							<span className="stats-val">
								{telemetry.latestTps === null ? "-" : `${telemetry.latestTps.toFixed(1)} tok/s`}
							</span>
						</div>
						<div className="stats-row">
							<span className="stats-label">{t("stats.speedAvg")}</span>
							<span className="stats-val">
								{telemetry.avgTps === null ? "-" : `${telemetry.avgTps.toFixed(1)} tok/s`}
							</span>
						</div>
						<div className="stats-row">
							<span className="stats-label">{t("stats.speedPeak")}</span>
							<span className="stats-val">
								{telemetry.peakTps === null ? "-" : `${telemetry.peakTps.toFixed(1)} tok/s`}
							</span>
						</div>
					</div>

					<div className="stats-sep" />

					<div className="stats-list">
						<div className="stats-row">
							<span className="stats-label">{t("stats.totalTokens")}</span>
							<span className="stats-val">{formatTokens(telemetry.tokens.total)}</span>
						</div>
						<div className="stats-row">
							<span className="stats-label">{t("stats.inputTokens")}</span>
							<span className="stats-val">{formatTokens(telemetry.tokens.input)}</span>
						</div>
						<div className="stats-row">
							<span className="stats-label">{t("stats.cacheReadTokens")}</span>
							<span className="stats-val">
								{formatTokens(telemetry.tokens.cacheRead)}
								{telemetry.cacheHitPercent !== null ? ` (${telemetry.cacheHitPercent.toFixed(1)}%)` : ""}
							</span>
						</div>
						{telemetry.tokens.cacheWrite > 0 ? (
							<div className="stats-row">
								<span className="stats-label">{t("stats.cacheWriteTokens")}</span>
								<span className="stats-val">{formatTokens(telemetry.tokens.cacheWrite)}</span>
							</div>
						) : null}
						<div className="stats-row">
							<span className="stats-label">{t("stats.outputTokens")}</span>
							<span className="stats-val">{formatTokens(telemetry.tokens.output)}</span>
						</div>
						{telemetry.reasoningTokens > 0 ? (
							<div className="stats-row">
								<span className="stats-label">{t("stats.reasoningTokens")}</span>
								<span className="stats-val">{formatTokens(telemetry.reasoningTokens)}</span>
							</div>
						) : null}
						{telemetry.cost > 0 ? (
							<div className="stats-row">
								<span className="stats-label">{t("stats.cost")}</span>
								<span className="stats-val">{formatTelemetryCost(telemetry.cost)}</span>
							</div>
						) : null}
					</div>

					<div className="stats-sep" />

					<div className="stats-list">
						<div className="stats-row">
							<span className="stats-label">{t("stats.messages")}</span>
							<span className="stats-val">
								{telemetry.userMessages} / {telemetry.assistantMessages}
							</span>
						</div>
						<div className="stats-row">
							<span className="stats-label">{t("stats.toolCalls")}</span>
							<span className="stats-val">{telemetry.toolCalls}</span>
						</div>
						<div className="stats-row">
							<span className="stats-label">{t("stats.modelTime")}</span>
							<span className="stats-val">{formatTelemetryDuration(telemetry.modelTimeMs)}</span>
						</div>
						<div className="stats-row">
							<span className="stats-label">{t("stats.toolTime")}</span>
							<span className="stats-val">{formatTelemetryDuration(telemetry.toolTimeMs)}</span>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
