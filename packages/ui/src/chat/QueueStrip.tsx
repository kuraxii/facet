/**
 * 后续消息卡片。
 *
 * 运行中发送的消息默认进入「后续消息（follow-up）」队列，以卡片形式列在输入区上方；
 * 每条支持转为插话立即发送、放回输入框编辑或删除。正在插话（steering）的消息另由
 * `SteeringMessages` 渲染在消息流末尾。
 */
import type { QueuedInput } from "@facet/protocol";
import { ArrowRight, ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "../common/Badge.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { keyedEntries } from "./queued-entries.ts";

/** 后续消息卡片参数。 */
export interface QueueStripProps {
	/** 当前排队内容 */
	queued: QueuedInput;
	/** 将指定索引的后续消息转为插话立即发送 */
	onPromoteFollowUp?: (index: number) => void;
	/** 将指定索引的后续消息放回输入框编辑 */
	onEditFollowUp?: (index: number) => void;
	/** 删除指定索引的后续消息 */
	onRemoveFollowUp?: (index: number) => void;
}

export function QueueStrip({ queued, onPromoteFollowUp, onEditFollowUp, onRemoveFollowUp }: QueueStripProps) {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [expanded, setExpanded] = useState(true);

	const followUp = keyedEntries(queued.followUp, "followUp");
	if (followUp.length === 0) {
		return null;
	}

	return (
		<>
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
			{tip.render()}
		</>
	);
}
