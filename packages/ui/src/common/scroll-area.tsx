/**
 * 滚动容器。
 *
 * Chromium 把滚动条画在容器的内边距里：容器只要有横向内边距，滚动条就跟着离开容器边缘。
 * 占满一整栏的列表（侧栏会话、变更树、设置页正文）因此要把横向留白交给里面的行，自己
 * 只留纵向内边距。
 *
 * 这两个组件把这条约定收成一处：`ScrollArea` 负责滚动行为，`ScrollRow` 负责横向留白。
 * 弹层（命令列表、搜索下拉、项目选择）不在此列：它们的留白要跟着弹层自己的内边距走。
 *
 * 样式见 `styles/base.css` 里的 `.scroll-y` 与 `.scroll-row`。
 */
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";

/** 滚动容器的参数。 */
export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
	/** 行相对容器边缘的横向留白，写进 `--scroll-inset`；不传时用容器类自己声明的值 */
	inset?: string;
	/** 是否始终预留滚动条沟槽，缺省预留，滚动条出现时内容不跳动 */
	gutter?: boolean;
	ref?: Ref<HTMLDivElement>;
	children?: ReactNode;
}

/** 纵向滚动的容器。滚动条贴着容器右缘，内容不会因为滚动条出现而左右跳动。 */
export function ScrollArea({ inset, gutter = true, className, style, ref, ...rest }: ScrollAreaProps) {
	const classes = className === undefined ? "scroll-y" : `scroll-y ${className}`;
	const merged: CSSProperties = {
		...style,
		...(inset === undefined ? {} : { "--scroll-inset": inset }),
		...(gutter ? {} : { "--scroll-gutter": "auto" }),
	} as CSSProperties;
	return <div ref={ref} className={classes} style={merged} {...rest} />;
}

/** 滚动区域里的一行。横向留白取容器的 `--scroll-inset`，右侧扣掉滚动条沟槽。 */
export function ScrollRow({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div className={className === undefined ? "scroll-row" : `scroll-row ${className}`} {...rest}>
			{children}
		</div>
	);
}
