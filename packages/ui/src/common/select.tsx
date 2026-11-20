/**
 * 设置里的下拉。
 *
 * 菜单由 `appearance: base-select` 画，`<select>` 继续负责语义、键盘与弹层；但选中的那一句
 * 话在浏览器的 shadow DOM 里，Chromium 还没把 `::selectedcontent` 开放给作者样式，单行省略号
 * 加不上去，长值只能折行或者被生硬裁掉。
 *
 * 所以这里让 `<select>` 的文字透明、只负责按当前值撑出宽度与画出右边的箭头，另叠一个
 * `.ell` 的 span 显示同一句话：按钮宽度跟着当前值走，放不下时按侧栏会话行那套省略，
 * 语义与可访问名仍然由真正的 `<select>` 提供。
 */
import type { ReactNode } from "react";

/** 一个选项。 */
export interface SelectOption {
	/** 提交给 `onChange` 的值 */
	value: string;
	/** 界面上显示的文字 */
	label: string;
}

/** 下拉的参数。 */
export interface SelectProps {
	/** 当前值 */
	value: string;
	/** 选项，按显示顺序 */
	options: readonly SelectOption[];
	/** 选中项变了 */
	onChange: (value: string) => void;
	/** 可访问名 */
	ariaLabel?: string;
	/** 不能改动 */
	disabled?: boolean;
	/** 额外类名，给需要固定宽度的地方 */
	className?: string;
}

export function Select({
	value,
	options,
	onChange,
	ariaLabel,
	disabled = false,
	className,
}: SelectProps): ReactNode {
	const current = options.find((option) => option.value === value);
	const classes = className === undefined ? "set-select" : `set-select ${className}`;
	return (
		<span className={classes}>
			<select
				className="set-input"
				value={value}
				disabled={disabled}
				aria-label={ariaLabel}
				onChange={(event) => onChange(event.target.value)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<span className="set-select-label ell" aria-hidden="true">
				{current?.label ?? ""}
			</span>
		</span>
	);
}
