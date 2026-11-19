/**
 * 工作树的改动状态与最近提交。
 *
 * 变更侧栏只看 git：工作树相对 HEAD 的差异，已暂存与未暂存合并成一份。这里的结构是主机
 * 算出来之后直接给界面用的，字段尽量与界面展示一一对应，界面不再自己推断状态。
 */

/** 一个文件相对 HEAD 的改动状态。 */
export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

/** 一个文件在改动清单里的样子。 */
export interface GitFileChange {
	/** 相对项目根的路径，斜杠分隔 */
	path: string;
	/** 改动状态 */
	status: GitFileStatus;
	/** 重命名或复制前的路径，其余状态为空 */
	oldPath?: string;
	/** 新增行数，二进制文件为 0 */
	added: number;
	/** 删除行数，二进制文件为 0 */
	removed: number;
	/** 是否是二进制文件，补丁不展开 */
	binary: boolean;
}

/** 一次提交相对第一父提交的改动规模。 */
export interface GitCommitStats {
	/** 改动的文件数 */
	filesChanged: number;
	/** 新增行数 */
	insertions: number;
	/** 删除行数 */
	deletions: number;
}

/** 最近的一条提交。 */
export interface GitCommit {
	/** 完整提交哈希 */
	sha: string;
	/** 短哈希，列表里显示 */
	shortSha: string;
	/** 提交说明的第一行 */
	subject: string;
	/** 说明里第一行之后的内容，段落之间保留空行；没有正文时为空串 */
	body: string;
	/** 作者名 */
	authorName: string;
	/** 作者邮箱 */
	authorEmail: string;
	/** 作者时间，ISO 8601 */
	authorDate: string;
	/** 改动规模；合并提交自身没有差异，此时为空 */
	stats?: GitCommitStats;
}

/** 提交清单。 */
export interface GitCommits {
	/** 项目根是不是一个 git 仓库 */
	isRepo: boolean;
	/** 从新到旧排列的提交 */
	commits: readonly GitCommit[];
	/** 远端仓库在浏览器里的地址（`https://host/owner/repo`，不带 `.git`），用来打开提交页；没有远端时为空 */
	webUrl?: string;
}

/** 某一次提交相对第一父提交的改动。 */
export interface GitCommitDetail {
	/** 提交自身的信息 */
	commit: GitCommit;
	/** 这次提交改动的文件，按路径排序 */
	files: readonly GitFileChange[];
}

/** 工作树的整体状态。 */
export interface GitStatus {
	/** 项目根是不是一个 git 仓库；不是时下面的字段都没有意义 */
	isRepo: boolean;
	/** 当前分支名；游离 HEAD 时是 `(detached)` */
	branch?: string;
	/** 上游分支与领先落后多少提交 */
	upstream?: {
		/** 上游分支名，例如 origin/dev */
		name: string;
		/** 本地领先的提交数 */
		ahead: number;
		/** 本地落后的提交数 */
		behind: number;
	};
	/** 改动清单，按路径排序 */
	files: readonly GitFileChange[];
}

/** 单个文件的补丁。 */
export interface GitDiff {
	/** unified diff 文本；二进制文件为空串 */
	patch: string;
	/** 输出超过主机上限被截断 */
	truncated: boolean;
	/** 二进制文件不产生补丁 */
	binary: boolean;
}
