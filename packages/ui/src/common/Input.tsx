/**
 * 单行输入框。
 *
 * 只收 `<input>`：多行富文本输入区（Lexical 的 `.composer`）有自己的编辑语义与滚动规则，
 * 不套这一层。业务层要的是"一行字 + 一个框"时用它，宽度与 flex 由调用处给——输入框不知道自己
 * 该多宽。
 */
import type { InputHTMLAttributes, ReactNode, Ref } from "react";

/** 输入框的视觉变体。 */
export type InputVariant = "default" | "ghost";

/** 输入框的高度档位。 */
export type InputSize = "sm" | "md" | "lg";

/** 单行输入框的参数。 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
	/** 视觉变体：`ghost` 用于已经嵌在带框容器里的输入（搜索栏、下拉触发器） */
	variant?: InputVariant;
	/** 高度档位，缺省 `md`（32px） */
	size?: InputSize;
	/** 校验失败：边框转错误色，不改文字 */
	invalid?: boolean;
	/** 额外的业务类名 */
	className?: string;
	ref?: Ref<HTMLInputElement>;
}

/** 单行输入框。 */
export function Input({
	variant = "default",
	size = "md",
	invalid = false,
	className,
	...rest
}: InputProps): ReactNode {
	return (
		<input
			data-variant={variant}
			data-size={size}
			data-invalid={invalid ? "true" : undefined}
			className={className === undefined ? "ui-input" : `ui-input ${className}`}
			aria-invalid={invalid ? true : undefined}
			{...rest}
		/>
	);
}
