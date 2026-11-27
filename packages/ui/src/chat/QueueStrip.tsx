/**
 * 排队条与后续消息卡片。
 *
 * 运行中发送的消息默认进入「后续消息（follow-up）」队列，以卡片形式列在输入区上方；
 * 每条支持转为插话立即发送、放回输入框编辑或删除。若同时有正在插话（steering）的条目，
 * 保留紧凑提示条供整批收回。
 */
import type { QueuedInput } from "@facet/protocol";
import { ArrowRight, ChevronDown, ChevronUp, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "../common/Badge.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";

/** 排队条参数。 */
export interface QueueStripProps {
	/** 当前排队内容 */
	queued: QueuedInput;
	/** 把插话排队内容收回输入框 */
	onClear: () => void;
	/** 将指定索引的后续消息转为插话立即发送 */
	onPromoteFollowUp?: (index: number) => void;
	/** 将指定索引的后续消息放回输入框编辑 */
	onEditFollowUp?: (index: number) => void;
	/** 删除指定索引的后续消息 */
	onRemoveFollowUp?: (index: number) => void;
}

function keyedEntries(
	items: readonly string[],
	prefix: string,
): Array<{ key: string; text: string; index: number }> {
	const counts = new Map<string, number>();
	return items.map((text, index) => {
		const seen = (counts.get(text) ?? 0) + 1;
		counts.set(text, seen);
		return { key: `${prefix}:${text}:${seen}`, text, index };
	});
}

export function QueueStrip({
	queued,
	onClear,
	onPromoteFollowUp,
	onEditFollowUp,
	onRemoveFollowUp,
}: QueueStripProps) {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [expanded, setExpanded] = useState(true);

	const steering = keyedEntries(queued.steering, "steering");
	const followUp = keyedEntries(queued.followUp, "followUp");
	if (steering.length === 0 && followUp.length === 0) {
		return null;
	}

	return (
		<>
			{steering.length === 0 ? null : (
				<div className="queue-strip">
					<span className="queue-label">
						{t("queue.label", { count: steering.length })}
						{steering.length > 1 ? <span className="queue-merge-hint">· {t("queue.mergeHint")}</span> : null}
					</span>
					{steering.map((entry) => (
						<span key={entry.key} className="queue-item" {...tip.handlers(entry.text)}>
							{entry.text}
						</span>
					))}
					<button type="button" className="queue-clear" onClick={onClear}>
						<X size={ICON_SIZE.sm} />
						{t("queue.withdraw")}
					</button>
				</div>
			)}

			{followUp.length === 0 ? null : (
				<section className="queue-card" aria-label={t("queue.followUpTitle")}>
					<div className="queue-card-head">
						<div className="queue-card-meta">
							<span className="queue-card-title">{t("queue.followUpTitle")}</span>
							<Badge>{followUp.length}</Badge>
							<span className="queue-card-hint ell">{t("queue.followUpHint")}</span>
						</div>
						<IconButton
							size="xs"
							variant="ghost"
							aria-label={t("queue.toggleList")}
							aria-expanded={expanded}
							onClick={() => setExpanded((current) => !current)}
						>
							{expanded ? <ChevronDown size={ICON_SIZE.sm} /> : <ChevronUp size={ICON_SIZE.sm} />}
						</IconButton>
					</div>

					{expanded ? (
						<ul className="queue-card-list">
							{followUp.map((entry) => (
								<li key={entry.key} className="queue-card-row">
									<span className="queue-card-text ell" {...tip.handlers(entry.text)}>
										{entry.text}
									</span>
									<div className="queue-card-actions">
										{onPromoteFollowUp === undefined ? null : (
											<IconButton
												size="xs"
												variant="ghost"
												aria-label={t("queue.sendNow")}
												{...tip.handlers(t("queue.sendNow"))}
												onClick={() => onPromoteFollowUp(entry.index)}
											>
												<ArrowRight size={ICON_SIZE.sm} />
											</IconButton>
										)}
										{onEditFollowUp === undefined ? null : (
											<IconButton
												size="xs"
												variant="ghost"
												aria-label={t("queue.edit")}
												{...tip.handlers(t("queue.edit"))}
												onClick={() => onEditFollowUp(entry.index)}
											>
												<Pencil size={ICON_SIZE.sm} />
											</IconButton>
										)}
										{onRemoveFollowUp === undefined ? null : (
											<IconButton
												size="xs"
												variant="ghost"
												aria-label={t("queue.remove")}
												{...tip.handlers(t("queue.remove"))}
												onClick={() => onRemoveFollowUp(entry.index)}
											>
												<Trash2 size={ICON_SIZE.sm} />
											</IconButton>
										)}
									</div>
								</li>
							))}
						</ul>
					) : null}
				</section>
			)}
			{tip.render()}
		</>
	);
}
