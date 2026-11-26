/**
 * 提交标题拆分。
 *
 * 把常规提交（Conventional Commits）的 `type(scope): ` 前缀与后面的正文说明拆开，
 * 列表渲染时可以弱化前缀颜色，让真正要扫读的修改内容更突出。
 */

/** 拆分后的提交标题。 */
export interface CommitSubjectParts {
	/** 含末尾冒号与分隔空白的前缀；非规范格式时为 `undefined` */
	readonly prefix: string | undefined;
	/** 提交说明主体 */
	readonly body: string;
}

/** 匹配无空格的提交类型（可选作用域与 `!`），后接冒号、空白与非空正文。 */
const CONVENTIONAL_PREFIX = /^([a-zA-Z][a-zA-Z0-9_-]*(?:\([^)]+\))?!?:\s+)(.+)$/;

/** 拆分一条提交标题；不符合常规提交前缀格式时原样返回 `body`。 */
export function splitCommitSubject(subject: string): CommitSubjectParts {
	const match = CONVENTIONAL_PREFIX.exec(subject);
	if (match === null) {
		return { prefix: undefined, body: subject };
	}
	const prefix = match[1] ?? "";
	const body = match[2] ?? "";
	if (body.trim().length === 0) {
		return { prefix: undefined, body: subject };
	}
	return { prefix, body };
}
