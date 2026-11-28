/**
 * 文件顶栏路径面包屑工具（纯函数，无 Electron / Node 依赖）。
 */

/** 把可选的项目名与相对路径拆成面包屑分段列表。 */
export function buildFileBreadcrumbs(
	rootLabel: string | undefined,
	relativePath: string | undefined,
): string[] {
	const parts: string[] = [];
	const trimmedRoot = rootLabel?.trim() ?? "";
	if (trimmedRoot.length > 0) {
		parts.push(trimmedRoot);
	}
	if (relativePath !== undefined && relativePath.length > 0) {
		for (const segment of relativePath.split(/[/\\]/)) {
			if (segment.length > 0) {
				parts.push(segment);
			}
		}
	}
	return parts;
}
