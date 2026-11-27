/**
 * 待发送插话气泡列表。
 *
 * 已通过 steering 发出、尚待模型在当前工具间隙消费的消息，直接以右侧用户气泡形态
 * 接在消息流末尾，表现「已发出」；悬停或聚焦气泡时在左侧浮现 `×` 按钮，点击任意一条
 * 都将全部待插话消息按序退回到后续消息队列顶部。
 */
import { X } from "lucide-react";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { keyedEntries } from "./queued-entries.ts";

/** 待发送插话气泡参数。 */
export interface SteeringMessagesProps {
	/** 当前排队中的插话消息文本列表 */
	steering: readonly string[];
	/** 将全部待插话消息退回到后续消息队列顶部 */
	onDemoteSteering: () => void;
}

/** 在对话消息流末尾渲染待发送的 steering 用户气泡。 */
export function SteeringMessages({ steering, onDemoteSteering }: SteeringMessagesProps) {
	const { t } = useI18n();
	const tip = useHoverTip();
	const entries = keyedEntries(steering, "steering");
	if (entries.length === 0) {
		return null;
	}

	const label = t("queue.demoteSteering");

	return (
		<>
			{entries.map((entry) => (
				<div key={entry.key} className="row is-user is-steering">
					<div className="user-line">
						<IconButton
							variant="ghost"
							size="sm"
							className="msg-action is-reveal"
							aria-label={label}
							data-action="demote"
							onClick={onDemoteSteering}
							{...tip.handlers(label)}
						>
							<X size={ICON_SIZE.sm} />
						</IconButton>
						<div className="bub">{entry.text}</div>
					</div>
				</div>
			))}
			{tip.render()}
		</>
	);
}
