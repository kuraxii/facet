/**
 * 列表、菜单与树的行。
 *
 * 只管排布与两个交互底色（悬停 `--bg-hover`、选中 `--bg-active`），**不锁死内部结构**：
 * 左边可以是状态点，中间可以是标题加副标题，右边可以挂悬浮才出现的操作区。缩进、拖拽态
 * 这类领域几何由业务样式表在自己的类上覆盖 `padding` 即可。
 *
 * `as` 决定语义标签：会话行是被点的按钮，菜单项用 `li` 包一个按钮，纯展示行用 `div`。
 * 三种标签共用同一批属性，`interactive={false}` 时不再给悬停反馈。
 */
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from "react";

/** 行可以渲染成的语义标签。 */
export type ListRowAs = "div" | "button" | "li";

/** 行的高度档位：24 / 28 / 32。 */
export type ListRowSize = "xs" | "sm" | "md";

/** 行的用法：列表行圆角大一档，菜单项小一档。 */
export type ListRowVariant = "list" | "menu";

/** 列表行的公共参数（与标签无关的那部分）。 */
interface ListRowBaseProps {
	/** 高度档位，缺省 `sm`（28px） */
	size?: ListRowSize;
	/** 列表行还是菜单项 */
	variant?: ListRowVariant;
	/** 当前选中（列表里唯一的那个） */
	selected?: boolean;
	/** 激活（展开、按下、当前项）；与 `selected` 同底色，语义更宽 */
	active?: boolean;
	/** 是否给悬停反馈，缺省 `true` */
	interactive?: boolean;
	/** 额外的业务类名 */
	className?: string;
	children?: ReactNode;
}

/** 渲染成 `div` 的展示行。 */
export interface ListRowDivProps
	extends ListRowBaseProps,
		Omit<HTMLAttributes<HTMLDivElement>, "ref" | "className" | "children"> {
	/** 标签 */
	as?: "div";
	ref?: Ref<HTMLDivElement>;
}

/** 渲染成按钮的可点行。 */
export interface ListRowButtonProps
	extends ListRowBaseProps,
		Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref" | "className" | "children" | "type"> {
	/** 标签 */
	as: "button";
	ref?: Ref<HTMLButtonElement>;
}

/** 渲染成列表项的行。 */
export interface ListRowItemProps
	extends ListRowBaseProps,
		Omit<HTMLAttributes<HTMLLIElement>, "ref" | "className" | "children"> {
	/** 标签 */
	as: "li";
	ref?: Ref<HTMLLIElement>;
}

/** 列表行的参数。 */
export type ListRowProps = ListRowDivProps | ListRowButtonProps | ListRowItemProps;

/** 列表行。 */
export function ListRow(props: ListRowProps): ReactNode {
	const {
		as,
		size = "sm",
		variant = "list",
		selected,
		active,
		interactive = true,
		className,
		children,
		...rest
	} = props;
	const classes = className === undefined ? "ui-row" : `ui-row ${className}`;
	const shared = {
		"data-size": size,
		"data-variant": variant,
		"data-selected": selected ? "true" : undefined,
		"data-active": active ? "true" : undefined,
		"data-interactive": interactive ? "true" : "false",
		className: classes,
	};
	if (as === "button") {
		// 行按钮不提交表单：列表里的每一行都可能是 `<form>` 里的子树
		return (
			<button type="button" {...shared} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
				{children}
			</button>
		);
	}
	if (as === "li") {
		return (
			<li {...shared} {...(rest as HTMLAttributes<HTMLLIElement>)}>
				{children}
			</li>
		);
	}
	return (
		<div {...shared} {...(rest as HTMLAttributes<HTMLDivElement>)}>
			{children}
		</div>
	);
}
