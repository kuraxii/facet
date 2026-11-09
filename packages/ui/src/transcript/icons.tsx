/** 界面用的小图标。统一 24 栅格,尺寸由调用处给。 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 14, children, ...rest }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
			{children}
		</svg>
	);
}

/** 新建会话。 */
export function PlusIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<path d="M12 5v14M5 12h14" />
		</Icon>
	);
}

/** 搜索。 */
export function SearchIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<circle cx="11" cy="11" r="7" />
			<path d="M20 20l-3.5-3.5" />
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

/** 远端主机上的会话。 */
export function MonitorIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<rect x="3" y="4" width="18" height="12" rx="2" />
			<path d="M8 20h8M12 16v4" />
		</Icon>
	);
}

/** 从一个用户消息处分叉。 */
export function ForkIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<circle cx="6" cy="5" r="2.2" />
			<circle cx="6" cy="19" r="2.2" />
			<circle cx="18" cy="8" r="2.2" />
			<path d="M6 7.2v9.6M18 10.2c0 4-6 3-12 6" />
		</Icon>
	);
}

/** 发送。 */
export function SendIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest} style={{ strokeWidth: 2.2 }}>
			<path d="M12 19V5M5 12l7-7 7 7" />
		</Icon>
	);
}

/** 关闭。 */
export function CloseIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<path d="M6 6l12 12M18 6L6 18" />
		</Icon>
	);
}

/** 添加文件夹。 */
export function FolderPlusIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
			<path d="M12 11v6M9 14h6" />
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

/** 停止。 */
export function StopIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<rect x="7" y="7" width="10" height="10" rx="2" />
		</Icon>
	);
}

/** 附件。 */
export function ClipIcon({ size, ...rest }: IconProps) {
	return (
		<Icon size={size} {...rest}>
			<path d="M20 11l-8 8a5 5 0 01-7-7l8.5-8.5a3.5 3.5 0 015 5L10 17a2 2 0 01-3-3l7.5-7.5" />
		</Icon>
	);
}
