/**
 * 上下文窗口详细构成浮层，嵌在输入区上下文用量环弹出框内。
 *
 * 展开时按需向宿主请求当前活动分支的分项拆解（System Prompt 分段、指令文件、Skills、
 * 工具定义与消息分类），没有明细数据时退回只展示基础百分比与总量。
 */
import type { ContextBreakdown, ContextCategoryId, ContextUsage } from "@facet/protocol";
import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { formatTokens, usageDetailText, usagePercentText } from "./ContextRing.tsx";
import { alignContextBreakdown, CATEGORY_TONE, computeCacheHitBreakdown } from "./session-telemetry.ts";

export interface ContextPopoverProps {
	/** 基础上下文用量（始终可用） */
	readonly contextUsage: ContextUsage | undefined;
	/** 按需拉取到的精细上下文明细 */
	readonly breakdown: ContextBreakdown | undefined;
	/** 是否正在加载明细 */
	readonly loading?: boolean;
	/** 是否正在执行压缩 */
	readonly isCompacting: boolean;
	/** 是否允许触发手动压缩 */
	readonly canCompact: boolean;
	/** 触发手动压缩 */
	readonly onCompact?: (() => void) | undefined;
}

/** 翻译一级分类标识。 */
function categoryLabel(id: ContextCategoryId, t: ReturnType<typeof useI18n>["t"]): string {
	return t(`context.categories.${id}`);
}

export function ContextPopover({
	contextUsage,
	breakdown,
	loading = false,
	isCompacting,
	canCompact,
	onCompact,
}: ContextPopoverProps): React.JSX.Element {
	const { t } = useI18n();
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

	const toggleCategory = (id: string) => {
		setExpanded((previous) => {
			const next = new Set(previous);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const aligned = breakdown ? alignContextBreakdown(breakdown) : undefined;
	const cache = breakdown ? computeCacheHitBreakdown(breakdown.latestRequestUsage) : null;

	const headline = isCompacting
		? t("composer.compacting")
		: aligned
			? aligned.usedPercent !== null
				? aligned.isEstimated
					? t("context.usedApprox", { percent: Math.round(aligned.usedPercent) })
					: t("context.used", { percent: Math.round(aligned.usedPercent) })
				: `${aligned.isEstimated ? "≈" : ""}${formatTokens(aligned.usedTokens)}`
			: (usagePercentText(contextUsage, t) ?? t("composer.noData"));

	const capacityText = isCompacting
		? null
		: aligned
			? aligned.contextWindow > 0
				? `${aligned.isEstimated ? "≈" : ""}${formatTokens(aligned.usedTokens)} / ${formatTokens(aligned.contextWindow)} tokens`
				: `${aligned.isEstimated ? "≈" : ""}${formatTokens(aligned.usedTokens)} tokens`
			: usageDetailText(contextUsage);

	return (
		// biome-ignore lint/a11y/useSemanticElements: 浮层展示上下文明细与操作按钮，不用 fieldset 语义
		<div className="chip-pop is-context" role="group" aria-label={t("composer.contextUsage")}>
			<div className="ctx-pop-head">
				<span className="ctx-pop-title">{t("composer.contextWindow")}</span>
				{breakdown && breakdown.compactions > 0 ? (
					<span className="ctx-pop-badge">
						{t("context.compactedCount", { count: breakdown.compactions })}
					</span>
				) : null}
			</div>
			<div className="ctx-pop-summary">
				<span className="ctx-pop-value">{headline}</span>
				{capacityText === null ? null : <span className="ctx-pop-detail">{capacityText}</span>}
			</div>

			{aligned && aligned.categories.length > 0 ? (
				<>
					{/* biome-ignore lint/a11y/useSemanticElements: 分段进度条需要多个着色 span，原生 meter 无法承载 */}
					<div
						className="ctx-bar"
						role="meter"
						aria-label={t("composer.contextUsage")}
						aria-valuenow={aligned.usedPercent ?? 0}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						{aligned.categories.map((cat) => {
							const pct =
								aligned.contextWindow > 0
									? (cat.tokens / aligned.contextWindow) * 100
									: aligned.usedTokens > 0
										? (cat.tokens / aligned.usedTokens) * 100
										: 0;
							if (pct <= 0) {
								return null;
							}
							return (
								<span
									key={cat.id}
									className={`ctx-bar-seg is-${CATEGORY_TONE[cat.id]}`}
									style={{ width: `${Math.max(0.8, pct)}%` }}
								/>
							);
						})}
					</div>

					<div className="ctx-cat-list">
						{aligned.categories.map((cat) => {
							const hasChildren = (cat.items?.length ?? 0) > 0;
							const isOpen = expanded.has(cat.id);
							const tone = CATEGORY_TONE[cat.id];
							return (
								<div key={cat.id} className="ctx-cat-group">
									<button
										type="button"
										className="ctx-cat-row"
										disabled={!hasChildren}
										aria-expanded={hasChildren ? isOpen : undefined}
										onClick={() => {
											if (hasChildren) {
												toggleCategory(cat.id);
											}
										}}
									>
										<span className={`ctx-dot is-${tone}`} aria-hidden="true" />
										<span className="ctx-cat-name">
											{categoryLabel(cat.id, t)}
											{hasChildren && cat.items && cat.items.length > 1 ? ` (${cat.items.length})` : ""}
										</span>
										{hasChildren ? <ChevronIcon isOpen={isOpen} /> : null}
										<span className="ctx-cat-tokens">{formatTokens(cat.tokens)}</span>
										<span className="ctx-cat-pct">
											{cat.percent === null ? "-" : `${cat.percent.toFixed(1)}%`}
										</span>
									</button>
									{hasChildren && isOpen ? (
										<div className="ctx-sub-list">
											{cat.items?.map((item) => (
												<div key={item.id} className="ctx-sub-row">
													<span className="ctx-sub-name" title={item.detail ?? item.label}>
														{item.label}
														{item.count !== undefined && item.count > 1 ? ` ×${item.count}` : ""}
													</span>
													<span className="ctx-sub-tokens">{formatTokens(item.tokens)}</span>
												</div>
											))}
										</div>
									) : null}
								</div>
							);
						})}

						{aligned.freeTokens !== null ? (
							<div className="ctx-cat-row is-static">
								<span className="ctx-dot is-free" aria-hidden="true" />
								<span className="ctx-cat-name">{t("context.freeSpace")}</span>
								<span className="ctx-cat-tokens">{formatTokens(aligned.freeTokens)}</span>
								<span className="ctx-cat-pct">
									{aligned.freePercent === null ? "-" : `${aligned.freePercent.toFixed(1)}%`}
								</span>
							</div>
						) : null}
					</div>
				</>
			) : loading ? (
				<div className="ctx-cat-loading" aria-hidden="true" />
			) : null}

			{breakdown && (breakdown.hiddenTools.length > 0 || breakdown.forcedPrompt) ? (
				<div className="ctx-pop-meta">
					{breakdown.hiddenTools.length > 0 ? (
						<span className="ctx-pop-meta-line" title={breakdown.hiddenTools.join(", ")}>
							{t("context.hiddenTools", { count: breakdown.hiddenTools.length })}
						</span>
					) : null}
					{breakdown.forcedPrompt ? (
						<span className="ctx-pop-meta-line">{t("context.forcedPrompt")}</span>
					) : null}
				</div>
			) : null}

			{cache ? (
				<div className="ctx-cache-box">
					<div className="ctx-cache-row">
						<span className="ctx-dot is-cache-read" aria-hidden="true" />
						<span className="ctx-cat-name">{t("context.cacheRead")}</span>
						<span className="ctx-cat-tokens">{formatTokens(cache.cacheRead)}</span>
						<span className="ctx-cat-pct">{cache.cacheReadPercent.toFixed(1)}%</span>
					</div>
					{cache.cacheWrite > 0 ? (
						<div className="ctx-cache-row">
							<span className="ctx-dot is-cache-write" aria-hidden="true" />
							<span className="ctx-cat-name">{t("context.cacheWrite")}</span>
							<span className="ctx-cat-tokens">{formatTokens(cache.cacheWrite)}</span>
							<span className="ctx-cat-pct">{cache.cacheWritePercent.toFixed(1)}%</span>
						</div>
					) : null}
					<div className="ctx-cache-row">
						<span className="ctx-dot is-new-input" aria-hidden="true" />
						<span className="ctx-cat-name">{t("context.newInput")}</span>
						<span className="ctx-cat-tokens">{formatTokens(cache.newInput)}</span>
						<span className="ctx-cat-pct">{cache.newInputPercent.toFixed(1)}%</span>
					</div>
				</div>
			) : null}

			{onCompact === undefined ? null : (
				<button
					type="button"
					className="ctx-pop-action"
					onClick={onCompact}
					disabled={!canCompact || isCompacting}
				>
					{t("composer.compact")}
				</button>
			)}
		</div>
	);
}
