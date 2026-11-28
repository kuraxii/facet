/**
 * Task Inbox 里的 3 行任务卡片。
 *
 * 第 1 行：项目缩写徽标 + 目录名；右侧默认展示状态点与时间，悬停/聚焦切换为 Settle 按钮。
 * 第 2 行：任务标题（最多两行）。
 * 第 3 行：左侧 Host 图标与名称；右侧 Agent 图标与名称。
 * 全部状态只通过样式（颜色、脉冲点、离线降透明）表达，不写状态标签文字。
 */
import { Check, Monitor, Server } from "lucide-react";
import { type MouseEvent, memo, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { BackendIcon } from "./AgentsIcon.tsx";
import type { SidebarTaskCard, TaskAttentionState } from "./inbox-model.ts";

export interface InboxCardProps {
	/** 任务卡片数据 */
	card: SidebarTaskCard;
	/** 是否为当前正在查看的任务 */
	isActive: boolean;
	/** 点击打开任务 */
	onSelect: (card: SidebarTaskCard) => void;
	/** 点击 Settle 归档 */
	onSettle: (card: SidebarTaskCard) => void;
	/** 右键上下文菜单 */
	onContextMenu: (card: SidebarTaskCard, event: MouseEvent<HTMLDivElement>) => void;
}

function attentionDotClass(attention: TaskAttentionState, hostOnline: boolean): string {
	if (!hostOnline) {
		return "dot is-off";
	}
	if (attention === "needs_approval") {
		return "dot is-warn";
	}
	if (attention === "running") {
		return "dot is-run is-pulse";
	}
	if (attention === "unread") {
		return "dot is-acc";
	}
	return "dot is-off";
}

export const InboxCard = memo(function InboxCard({
	card,
	isActive,
	onSelect,
	onSettle,
	onContextMenu,
}: InboxCardProps): ReactNode {
	const { t } = useI18n();
	const cardClass = [
		"inbox-card",
		isActive ? "is-on" : undefined,
		!card.hostOnline ? "is-offline" : undefined,
	]
		.filter((part) => part !== undefined)
		.join(" ");

	return (
		// biome-ignore lint/a11y/useSemanticElements: 卡片内含独立的 Settle 按钮，外层采用 button 语义容器以避免嵌套 button
		<div
			role="button"
			tabIndex={0}
			className={cardClass}
			aria-current={isActive ? "true" : undefined}
			onClick={() => onSelect(card)}
			onContextMenu={(event) => onContextMenu(card, event)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect(card);
				}
			}}
		>
			<div className="inbox-card-top">
				<span className="inbox-card-proj">
					<span className="inbox-proj-name ell">
						{card.projectName.length > 0 ? card.projectName : t("inbox.noProject")}
					</span>
				</span>
				<span className="inbox-card-right">
					<span className="inbox-card-status">
						{card.attention === "idle" && card.hostOnline ? null : (
							<i className={attentionDotClass(card.attention, card.hostOnline)} aria-hidden="true" />
						)}
						<span className="inbox-time mono">{card.timeText}</span>
					</span>
					<button
						type="button"
						className="inbox-settle-btn"
						aria-label={t("inbox.settle")}
						onClick={(event) => {
							event.stopPropagation();
							onSettle(card);
						}}
					>
						<Check size={ICON_SIZE.sm} />
						<span>{t("inbox.settle")}</span>
					</button>
				</span>
			</div>

			<p className="inbox-card-title ell">{card.title}</p>

			<div className="inbox-card-foot">
				<span className="inbox-card-host ell">
					{card.isLocal ? <Monitor size={ICON_SIZE.sm} /> : <Server size={ICON_SIZE.sm} />}
					<span className="ell">{card.hostLabel}</span>
				</span>
				<span className="inbox-card-agent" title={card.agentId}>
					<BackendIcon agentId={card.agentId} size={ICON_SIZE.sm} />
				</span>
			</div>
		</div>
	);
});
