/**
 * 提取文件名与目录名供 Symbols 图标表查找。
 *
 * 工作区与变更视图传来的路径可能是带斜杠的相对路径（如 `apps/desktop/tsconfig.json`），
 * `@react-symbols/icons` 的精确文件名映射与目录映射分别要求不含路径分隔符且目录名全小写。
 */

/** 从斜杠或反斜杠分隔的路径中取出最后一段名称。 */
export function symbolEntryBasename(path: string): string {
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return slash < 0 ? path : path.slice(slash + 1);
}

/** 归一化目录名，保证大小写混写目录也能命中 `@react-symbols/icons` 的语义图标表。 */
export function normalizeFolderSymbolName(path: string): string {
	return symbolEntryBasename(path).toLowerCase();
}
