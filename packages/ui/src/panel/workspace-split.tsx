/**
 * 工作区里的「预览 + 索引」两栏。
 *
 * 文件与变更两个分页都是这个形状：左边是预览（文件内容 / 补丁），右边是索引（文件树 /
 * 变更列表）。DOM 顺序就是视觉与阅读顺序——预览在前、索引在后，不靠 `row-reverse` 反转：
 * 依赖视觉翻转的话，键盘 Tab 与读屏仍然按「索引在前」走，和眼睛看到的对不上。
 *
 * 这一层只管摆位：索引收起来之后预览向右长满，它的左缘不动（左边就是工作区边界）。
 * 收起/展开的按钮跟着各自的顶栏走，见 `workspace-body.tsx`。
 */

import type { ReactNode } from "react";

/** 预览 + 索引两栏的参数。 */
export interface WorkspaceSplitProps {
	/** 左边那一栏：预览内容 */
	detail: ReactNode;
	/** 右边那一栏：索引，自带表头 */
	list: ReactNode;
	/** 索引那一栏被收起了：不占位，预览占满 */
	isListCollapsed: boolean;
	/** 组件自己的类名，用来区分文件树与变更列表 */
	className?: string;
}

/**
 * 工作区窄于这个宽度时，索引栏让位给预览（CSS px）。
 *
 * 再窄下去两栏都放不下：`--workspace-list-width` 最少也要一百六十来像素，剩下的预览连
 * 一行代码都读不了。判定在 `apps/desktop/.../workspace-body.tsx`，样式只认结果。
 */
export const WORKSPACE_SPLIT_MIN_WIDTH_PX = 480;

export function WorkspaceSplit({ detail, list, isListCollapsed, className }: WorkspaceSplitProps): ReactNode {
	const classes = ["workspace-split", isListCollapsed ? "is-list-collapsed" : undefined, className]
		.filter((name): name is string => name !== undefined && name.length > 0)
		.join(" ");
	return (
		<div className={classes}>
			<div className="workspace-split-detail">{detail}</div>
			<div className="workspace-split-list">{list}</div>
		</div>
	);
}
