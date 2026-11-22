/**
 * 消息行尾的图标动作：复制、回退、分叉。
 *
 * 三处动作在屏幕上是同一种东西——悬停才出现（或一直可见）的一枚无边框图标按钮，点下去做
 * 一件事。以前它们各写一份类名与悬停色，复制用强调色、分叉用焦点色，放在同一行动作区里
 * 一左一右就看出不齐；这里把"长什么样"收成一处，`action` 只决定它是谁。
 */
import type { ReactNode } from "react";
import { IconButton } from "../common/IconButton.tsx";

/** 消息上可以挂的动作。 */
export type MessageActionKind = "copy" | "revert" | "fork";

/** 消息动作的参数。 */
export interface MessageActionProps {
	/** 动作名：同时写进 `data-action`，测试与样式都靠它认人 */
	action: MessageActionKind;
	/** 可访问名 */
	label: string;
	/** 点下去做什么 */
	onClick: () => void;
	/** 完成态：颜色转成功色（复制成功后短暂亮一下） */
	isDone?: boolean;
	/** 默认藏起来，悬停整行或键盘聚焦到它时才出现；缺省常驻可见 */
	isReveal?: boolean;
	/** 这个动作此刻不可用 */
	disabled?: boolean;
	/** 图标 */
	children: ReactNode;
}

/** 消息行尾的一枚动作按钮。 */
export function MessageAction({
	action,
	label,
	onClick,
	isDone = false,
	isReveal = false,
	disabled = false,
	children,
}: MessageActionProps): ReactNode {
	const classes = ["msg-action"];
	if (isReveal) {
		classes.push("is-reveal");
	}
	if (isDone) {
		classes.push("is-done");
	}
	return (
		<IconButton
			variant="ghost"
			size="sm"
			className={classes.join(" ")}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			{...{ "data-action": action }}
		>
			{children}
		</IconButton>
	);
}
