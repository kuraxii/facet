/**
 * 文件变更状态的图标。
 *
 * 状态由图形与颜色表达，行内不出现 A/M/D 这类字母。
 */

import type { GitFileStatus } from "@facet/protocol";
import { SquareDot, SquareMinus, SquarePen, SquarePlus, TriangleExclamationPoint } from "lucide-react";
import type { ReactNode } from "react";

/** 状态对应的 lucide 图标。 */
const STATUS_ICONS: Record<GitFileStatus, typeof SquareDot> = {
	added: SquarePlus,
	modified: SquareDot,
	deleted: SquareMinus,
	renamed: SquarePen,
	untracked: SquarePlus,
	conflicted: TriangleExclamationPoint,
};

/** 状态对应的界面文案键。 */
export type ChangeStatusLabelKey =
	| "panel.status.added"
	| "panel.status.modified"
	| "panel.status.deleted"
	| "panel.status.renamed"
	| "panel.status.untracked"
	| "panel.status.conflicted";

/** 把文件状态映射到界面文案键。 */
export function changeStatusLabelKey(status: GitFileStatus): ChangeStatusLabelKey {
	switch (status) {
		case "added":
			return "panel.status.added";
		case "modified":
			return "panel.status.modified";
		case "deleted":
			return "panel.status.deleted";
		case "renamed":
			return "panel.status.renamed";
		case "untracked":
			return "panel.status.untracked";
		case "conflicted":
			return "panel.status.conflicted";
	}
}

export interface ChangeMarkProps {
	/** 文件状态 */
	status: GitFileStatus;
	/** 图标边长 */
	size?: number;
}

/** 文件状态图标；颜色由外层按 `data-status` 给出。 */
export function ChangeMark({ status, size = 14 }: ChangeMarkProps): ReactNode {
	const Icon = STATUS_ICONS[status];
	return <Icon size={size} strokeWidth={1.5} aria-hidden />;
}
