/**
 * 界面用的小图标。统一 24 栅格、尺寸由调用处给。
 *
 * 描边走 `.ui-icon` 那一条（`--icon-stroke-width`），与 lucide 同一份真值；这里不写
 * `strokeWidth`，写一处就多一个改不动的地方。
 */
import type { SVGProps } from "react";
import { ICON_SIZE } from "../styles/visual-contract.ts";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = ICON_SIZE.md, children, ...rest }: IconProps) {
	return (
		<svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
			{children}
		</svg>
	);
}

/** 项目信任。 */
export function ShieldIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
		</Icon>
	);
}

/** 项目目录。 */
export function FolderIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
		</Icon>
	);
}

/** 发送。 */
/** 发送。 */
export function SendIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<path d="M12 19V5M5 12l7-7 7 7" />
		</Icon>
	);
}

/** 回到底部。 */
export function ArrowDownIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<path d="M12 5v14M5 12l7 7 7-7" />
		</Icon>
	);
}

/** 停止：红色方块，外围的边界由按钮自己画。 */
export function StopIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<rect x="4" y="4" width="16" height="16" rx="3" fill="var(--status-err-fg)" stroke="none" />
		</Icon>
	);
}
