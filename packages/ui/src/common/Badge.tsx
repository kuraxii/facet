/**
 * 计数与状态徽标。
 *
 * 字号固定在 `--text-xs`（12px）：更小的字号在 1x 屏上会糊成一团，宁可把胶囊做高一点。
 * 计数用等宽字体加 `tabular-nums`，数字变化时宽度不跳。
 */
import type { HTMLAttributes, ReactNode, Ref } from "react";

/** 徽标的语义变体。 */
export type BadgeVariant = "neutral" | "accent" | "ok" | "warn" | "err";

/** 徽标的形状：胶囊用于计数，方角标签用于分类。 */
export type BadgeShape = "pill" | "tag";

/** 徽标的参数。 */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
	/** 语义变体，缺省 `neutral` */
	variant?: BadgeVariant;
	/** 形状，缺省 `pill` */
	shape?: BadgeShape;
	/** 额外的业务类名 */
	className?: string;
	ref?: Ref<HTMLSpanElement>;
	children?: ReactNode;
}

/** 徽标。 */
export function Badge({
	variant = "neutral",
	shape = "pill",
	className,
	children,
	...rest
}: BadgeProps): ReactNode {
	return (
		<span
			data-variant={variant}
			data-shape={shape}
			className={className === undefined ? "ui-badge" : `ui-badge ${className}`}
			{...rest}
		>
			{children}
		</span>
	);
}
