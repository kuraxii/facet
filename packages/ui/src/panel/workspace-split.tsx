/**
 * 工作区里的「列表 + 预览」两栏。
 *
 * 文件与变更两个分页都是这个形状：左边一份可折叠的清单，右边是它指向的内容。折叠只影响
 * 左边那一栏：收起之后预览占满整个工作区，左上角留一个按钮把它叫回来。
 *
 * 宽度过窄时由容器查询自动收起左边（`panel.css`），不靠 JS 量尺寸——工作区宽度本来就是
 * 样式算出来的，量它就得再同步一份到 JS 里。
 */

import { PanelLeftOpen } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useHoverTip } from "../tip.tsx";

/** 两栏的参数。 */
export interface WorkspaceSplitProps {
	/** 左边那一栏：清单本身，自带表头 */
	list: ReactNode;
	/** 右边那一栏：预览内容 */
	detail: ReactNode;
	/** 用户是不是手动收起了左边 */
	isListCollapsed: boolean;
	/** 把左边叫回来的按钮上的文案，同时用作无障碍名称与提示 */
	showListLabel: string;
	/** 把左边叫回来 */
	onShowList: () => void;
	/** 组件自己的类名，用来区分文件树与变更列表 */
	className?: string;
}

export function WorkspaceSplit({
	list,
	detail,
	isListCollapsed,
	showListLabel,
	onShowList,
	className,
}: WorkspaceSplitProps): ReactNode {
	// 叫回列表的按钮平时看不见，提示在有它在时才需要
	const tip = useHoverTip();
	const rootRef = useRef<HTMLDivElement | null>(null);
	const classes = ["workspace-split", isListCollapsed ? "is-list-collapsed" : undefined, className]
		.filter((name): name is string => name !== undefined && name.length > 0)
		.join(" ");
	return (
		<div className={classes} ref={rootRef}>
			<div className="workspace-split-list">{list}</div>
			<div className="workspace-split-detail">
				<button
					type="button"
					className="workspace-split-restore"
					aria-label={showListLabel}
					{...tip.handlers(showListLabel)}
					onClick={onShowList}
				>
					<PanelLeftOpen size={14} strokeWidth={1.5} />
				</button>
				{detail}
				{tip.render()}
			</div>
		</div>
	);
}
