/** 主区域的一个标签。会话、文件、补丁、变更文档与终端各自占一个标签。 */
export type MainTab =
	| {
			/** 标签标识，同一份内容只保留一个标签 */
			id: string;
			kind: "session";
			/** 会话文件路径；内存会话为空 */
			file?: string;
			/** 会话标识；内存会话没有文件时用它区分 */
			sessionId?: string;
	  }
	| {
			/** 标签标识 */
			id: string;
			kind: "file";
			/** 文件所属的项目目录 */
			cwd: string;
			/** 相对项目根的路径 */
			path: string;
	  }
	| {
			/** 标签标识 */
			id: string;
			kind: "diff";
			/** 补丁所属的项目目录 */
			cwd: string;
			/** 相对项目根的路径 */
			path: string;
			/** 未跟踪文件需要单独取补丁 */
			untracked: boolean;
	  }
	| {
			/** 标签标识 */
			id: string;
			kind: "changes";
			/** 变更文档所属的项目目录 */
			cwd: string;
			/** 需要定位的文件路径；没有时从文档顶部开始 */
			focusPath?: string;
			/** 同一次定位的序号；重复点同一个文件时也要重新滚动 */
			focusRequestId?: number;
	  }
	| {
			/** 标签标识 */
			id: string;
			kind: "commit";
			/** 提交所属的项目目录 */
			cwd: string;
			/** 完整提交哈希 */
			sha: string;
			/** 短哈希 */
			shortSha: string;
			/** 提交说明 */
			subject: string;
	  }
	| {
			/** 标签标识 */
			id: string;
			kind: "terminal";
			/** 主机上的终端标识 */
			terminalId: string;
	  };

/** 会话标签的标识：有文件时按文件区分，内存会话按会话标识区分。 */
export function sessionTabId(file: string | undefined, sessionId: string): string {
	return `session:${file ?? sessionId}`;
}

/** 文件标签的标识：同一路径在同一项目里只开一个标签。 */
export function fileTabId(cwd: string, path: string): string {
	return `file:${cwd}:${path}`;
}

/** 补丁标签的标识：同一文件在同一项目里只开一个标签。 */
export function diffTabId(cwd: string, path: string): string {
	return `diff:${cwd}:${path}`;
}

/** 变更文档标签的标识：同一项目只保留一个文档。 */
export function changesTabId(cwd: string): string {
	return `changes:${cwd}`;
}

/** 提交标签的标识：同一项目里同一个提交只保留一个标签。 */
export function commitTabId(cwd: string, sha: string): string {
	return `commit:${cwd}:${sha}`;
}

/** 终端标签的标识：每个终端一个标签。 */
export function terminalTabId(terminalId: string): string {
	return `terminal:${terminalId}`;
}

/**
 * 把一条标签拖到另一条标签的前面或后面。
 *
 * 返回完整的新顺序；拖动标识或目标标识不存在、以及拖到自己身上时保持原顺序。
 */
export function reorderMainTabIds(
	tabs: readonly { id: string }[],
	draggedId: string,
	targetId: string,
	after: boolean,
): string[] {
	const ids = tabs.map((tab) => tab.id);
	const from = ids.indexOf(draggedId);
	const target = ids.indexOf(targetId);
	if (from < 0 || target < 0 || from === target) {
		return ids;
	}
	const next = [...ids];
	next.splice(from, 1);
	const targetIndex = next.indexOf(targetId);
	if (targetIndex < 0) {
		return ids;
	}
	next.splice(after ? targetIndex + 1 : targetIndex, 0, draggedId);
	return next;
}

/** 拖动落点：放在某条标签前面还是后面。 */
export interface MainTabDropTarget {
	/** 目标标签标识 */
	id: string;
	/** 放在目标标签后面 */
	after: boolean;
}

/**
 * 把落点统一成“前一条标签之后”。
 *
 * 相邻两条标签之间的插入点既可以写成“前一条之后”，也可以写成“后一条之前”。统一成前者，
 * 同一条缝隙只画一根落点线；最前面没有前一条标签，保留“第一条之前”。
 */
export function normalizeMainTabDropTarget(
	tabs: readonly { id: string }[],
	target: MainTabDropTarget,
): MainTabDropTarget {
	if (target.after) {
		return target;
	}
	const index = tabs.findIndex((tab) => tab.id === target.id);
	if (index <= 0) {
		return target;
	}
	const previous = tabs[index - 1];
	return previous === undefined ? target : { id: previous.id, after: true };
}
