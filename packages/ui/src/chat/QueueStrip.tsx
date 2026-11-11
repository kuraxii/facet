/**
 * 排队条。
 *
 * 运行中再发一条消息会插进当前轮次,这里列出还没插进去的内容,并提供整批收回的动作。
 */
import type { QueuedInput } from "@facet/protocol";
import { CloseIcon } from "../transcript/icons.tsx";

/** 排队条参数。 */
export interface QueueStripProps {
	/** 当前排队内容 */
	queued: QueuedInput;
	/** 把排队内容收回输入框 */
	onClear: () => void;
}

/** 按插入时机排好的条目,steering 先于 followUp 生效。 */
function entriesOf(queued: QueuedInput): { key: string; text: string }[] {
	return [
		...queued.steering.map((text, index) => ({ key: `steering:${index}`, text })),
		...queued.followUp.map((text, index) => ({ key: `followUp:${index}`, text })),
	];
}

export function QueueStrip({ queued, onClear }: QueueStripProps) {
	const entries = entriesOf(queued);
	if (entries.length === 0) {
		return null;
	}

	return (
		<div className="queue-strip">
			<span className="queue-label">排队 {entries.length} 条</span>
			{entries.map((entry) => (
				<span key={entry.key} className="queue-item" title={entry.text}>
					{entry.text}
				</span>
			))}
			<button type="button" className="queue-clear" onClick={onClear} title="收回排队内容">
				<CloseIcon size={11} />
				收回
			</button>
		</div>
	);
}
