/**
 * 文本按钮。
 *
 * 四种变体 × 三档高度，几何全部来自 `styles/primitives.css`（读 `--control-*` / `--radius-*` /
 * `--space-*` 这些刻度）。业务层需要额外外边距、固定宽度或领域配色时，用自己的类盖在
 * `className` 上即可——`primitives.css` 排在最前面，同优先级就够覆盖，不必 `!important`。
 *
 * `type` 缺省是 `button`：界面里的按钮大多不提交表单，不写这一条的话放进 `<form>` 里点一下
 * 就会顺手提交，而且很难查。
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

/** 按钮的视觉变体。 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** 按钮的高度档位。 */
export type ButtonSize = "sm" | "md" | "lg";

/** 文本按钮的参数：原生按钮属性加变体与档位。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** 视觉变体，缺省 `secondary` */
	variant?: ButtonVariant;
	/** 高度档位，缺省 `md`（32px） */
	size?: ButtonSize;
	/**
	 * 两步确认里的"已经按过一次"。
	 *
	 * 用于删除这类不可撤销的动作：第一下把按钮染成错误底色，第二下才真的执行；
	 * 只在 `variant="danger"` 上有意义。
	 */
	armed?: boolean;
	/** 额外的业务类名，用来加外边距、定位或领域配色 */
	className?: string;
	ref?: Ref<HTMLButtonElement>;
	children?: ReactNode;
}

/** 文本按钮。 */
export function Button({
	variant = "secondary",
	size = "md",
	armed = false,
	type = "button",
	className,
	children,
	...rest
}: ButtonProps): ReactNode {
	return (
		<button
			type={type}
			data-variant={variant}
			data-size={size}
			data-armed={armed ? "true" : undefined}
			className={className === undefined ? "ui-btn" : `ui-btn ${className}`}
			{...rest}
		>
			{children}
		</button>
	);
}
