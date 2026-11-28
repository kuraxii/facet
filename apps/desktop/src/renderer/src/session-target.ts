/**
 * 跨主机联合会话标识与活跃目标。
 *
 * 多主机并发运行时，不同主机上可能存在同名目录或路径相同的会话文件；全部选中态、
 * 草稿与归档索引统一使用 `(endpoint, file)` 联合标识。
 */

/** `(endpoint, file)` 联合键，形式为 `<endpoint>::<file>`。 */
export type SessionKey = `${string}::${string}`;

/** 当前主工作区正在查看的会话目标。 */
export interface ActiveTarget {
	/** 所属主机端点（本机为 `local`） */
	readonly endpoint: string;
	/** 会话文件或 ACP 定位符 */
	readonly file: string;
}

/** 生成 `(endpoint, file)` 联合会话键。 */
export function toSessionKey(endpoint: string, file: string): SessionKey {
	return `${endpoint}::${file}`;
}

/** 比较两个活跃目标是否指向同一台主机的同一条会话。 */
export function sameTarget(left: ActiveTarget | undefined, right: ActiveTarget | undefined): boolean {
	if (left === right) {
		return true;
	}
	if (left === undefined || right === undefined) {
		return false;
	}
	return left.endpoint === right.endpoint && left.file === right.file;
}
