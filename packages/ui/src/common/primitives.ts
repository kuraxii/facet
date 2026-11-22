/**
 * 控件原语的门面。
 *
 * 五个原语与它们的类型从这里一起出去，包外（`@facet/ui/primitives`）与包内都走这一份，
 * 免得每加一个原语就要在几个地方各加一行。样式在 `styles/primitives.css`。
 */
export type { BadgeProps, BadgeShape, BadgeVariant } from "./Badge.tsx";
export { Badge } from "./Badge.tsx";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button.tsx";
export { Button } from "./Button.tsx";
export type { IconButtonProps, IconButtonSize, IconButtonVariant } from "./IconButton.tsx";
export { IconButton } from "./IconButton.tsx";
export type { InputProps, InputSize, InputVariant } from "./Input.tsx";
export { Input } from "./Input.tsx";
export type {
	ListRowAs,
	ListRowButtonProps,
	ListRowDivProps,
	ListRowItemProps,
	ListRowProps,
	ListRowSize,
	ListRowVariant,
} from "./ListRow.tsx";
export { ListRow } from "./ListRow.tsx";
