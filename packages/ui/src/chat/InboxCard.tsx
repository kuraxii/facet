/**
 * Task Inbox 里的 3 行任务卡片。
 *
 * 第 1 行：项目名；右侧有活跃状态时始终只显示原版状态标记（不展示时间，悬停也不切出 Settle 按钮）；
 * 无活跃状态时默认显示相对时间，悬停/聚焦切换为 Settle 按钮。
 * 第 2 行：任务标题（最多两行）。
 * 第 3 行：左侧 Host 图标与名称；右侧 Agent 图标与名称。
 */
import { Check, Monitor, Server } from "lucide-react";
import { type MouseEvent, memo, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { BackendIcon } from "./AgentsIcon.tsx";
import type { SidebarTaskCard } from "./inbox-model.ts";
import { SessionStatusMark } from "./session-status-mark.tsx";

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

export const InboxCard = memo(function InboxCard({
	card,
	isActive,
	onSelect,
	onSettle,
	onContextMenu,
}: InboxCardProps): ReactNode {
	const { t } = useI18n();
	const showStatusMark = card.hostOnline && card.bucket !== "done";
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
					{showStatusMark ? (
						<SessionStatusMark bucket={card.bucket} />
					) : (
						<>
							<span className="inbox-card-status">
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
						</>
					)}
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
