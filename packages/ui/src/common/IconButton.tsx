/**
 * 图标按钮。
 *
 * 只放一枚图标，边长等于高度；`flex: none` 保证它在一行里不被压扁。可访问名由
 * `IconButtonLabel` 强制：一枚没有文字的按钮必须带 `aria-label`、`aria-labelledby` 或
 * `title` 之一，类型层面就拦下来——否则读屏里它是个没有名字的按钮。
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

/** 图标按钮的视觉变体。 */
export type IconButtonVariant = "ghost" | "outline" | "primary";

/** 图标按钮的尺寸档位：24 / 28 / 32。 */
export type IconButtonSize = "xs" | "sm" | "md";

/**
 * 可访问名：三种写法至少给一种。
 *
 * 拆成联合类型而不是可选字段，是为了让"漏写"在编译期就红。
 */
type IconButtonLabel =
	| { "aria-label": string; title?: string }
	| { "aria-labelledby": string; title?: string }
	| { title: string };

/** 图标按钮的参数。 */
export type IconButtonProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"aria-label" | "aria-labelledby" | "title" | "children"
> &
	IconButtonLabel & {
		/** 视觉变体，缺省 `ghost` */
		variant?: IconButtonVariant;
		/** 尺寸档位，缺省 `sm`（28 × 28） */
		size?: IconButtonSize;
		/** 圆角单独放宽一档：输入区那种要跟外框圆角对齐的主图标按钮写 `lg` */
		radius?: "lg";
		/** 选中 / 激活态：底色取 `--bg-active`，替代过去零散的 `is-on` */
		active?: boolean;
		/** 额外的业务类名 */
		className?: string;
		ref?: Ref<HTMLButtonElement>;
		/** 图标 */
		children?: ReactNode;
	};

/** 图标按钮。 */
export function IconButton({
	variant = "ghost",
	size = "sm",
	radius,
	active = false,
	type = "button",
	className,
	children,
	...rest
}: IconButtonProps): ReactNode {
	return (
		<button
			type={type}
			data-variant={variant}
			data-size={size}
			data-radius={radius}
			data-active={active ? "true" : undefined}
			className={className === undefined ? "ui-icon-btn" : `ui-icon-btn ${className}`}
			{...rest}
		>
			{children}
		</button>
	);
}
