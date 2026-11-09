/**
 * 输入区。
 *
 * 输入框、发送与停止、以及当前模型与思考档位的两个芯片。附件与引用还没有实现,
 * 按钮保持可见但不可点,避免与设计稿的布局产生落差。
 */
import type { ModelInfo, ThinkingLevel } from "@facet/protocol";
import { ClipIcon, SendIcon, StopIcon } from "../transcript/icons.tsx";

/** 输入区参数。 */
export interface ComposerProps {
	/** 输入内容 */
	value: string;
	/** 输入变化 */
	onChange: (value: string) => void;
	/** 发送当前内容 */
	onSend: () => void;
	/** 停止运行 */
	onStop: () => void;
	/** 是否有回合在运行 */
	isRunning: boolean;
	/** 当前模型 */
	model: ModelInfo | undefined;
	/** 当前思考档位 */
	thinkingLevel: ThinkingLevel | undefined;
	/** 切换模型,不提供时芯片只展示 */
	onCycleModel?: (() => void) | undefined;
}

/** 模型芯片的显示文本。 */
function modelLabel(model: ModelInfo | undefined): string {
	if (!model) {
		return "无模型";
	}
	return model.id;
}

export function Composer({
	value,
	onChange,
	onSend,
	onStop,
	isRunning,
	model,
	thinkingLevel,
	onCycleModel,
}: ComposerProps) {
	const canSend = value.trim().length > 0 && !isRunning;

	return (
		<div className="composer">
			<textarea
				rows={2}
				value={value}
				placeholder="输入消息,回车发送"
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						if (canSend) {
							onSend();
						}
					}
				}}
			/>
			<div className="composer-row">
				<button type="button" className="ib" aria-label="添加附件" disabled title="尚未实现">
					<ClipIcon size={16} />
				</button>
				<button type="button" className="ib" aria-label="引用文件" disabled title="尚未实现">
					@
				</button>
				<button
					type="button"
					className="chip"
					onClick={onCycleModel}
					disabled={onCycleModel === undefined}
					title="切换模型"
				>
					{modelLabel(model)}
					{onCycleModel === undefined ? null : <i className="chev is-open" />}
				</button>
				<span className="chip">思考 · {thinkingLevel ?? "默认"}</span>
				<span className="composer-send">
					{isRunning ? (
						<button type="button" className="btn" onClick={onStop}>
							<StopIcon size={11} />
							停止
						</button>
					) : null}
					<button type="button" className="send" aria-label="发送" onClick={onSend} disabled={!canSend}>
						<SendIcon size={16} />
					</button>
				</span>
			</div>
		</div>
	);
}
