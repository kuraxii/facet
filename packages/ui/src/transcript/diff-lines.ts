/**
 * 补丁的逐行解析。
 *
 * 对话里的文件改动行与变更侧栏用同一套：按 hunk 头算出旧行号与新行号，增行只有新行号、
 * 删行只有旧行号，上下文两列都算；键用累计偏移，补丁重算时不会错位。
 */

/** 一行相对上文的类别，对应样式里的 is-meta / is-add / is-del。 */
export function lineClass(line: string): string {
	if (
		line.startsWith("@@") ||
		line.startsWith("+++ ") ||
		line.startsWith("--- ") ||
		line.startsWith("diff ") ||
		line.startsWith("index ") ||
		line.startsWith("\\ ")
	) {
		return "is-meta";
	}
	if (line.startsWith("+")) {
		return "is-add";
	}
	if (line.startsWith("-")) {
		return "is-del";
	}
	return "";
}

/** 补丁里的一行。 */
export interface PatchLine {
	/** 稳定键，取累计偏移 */
	key: string;
	/** 原始行 */
	line: string;
	/** 行号；文件头与 hunk 头为空 */
	number: string;
}

/** 补丁按行拆开并带上行号。 */
export function patchLines(patch: string): readonly PatchLine[] {
	const lines: PatchLine[] = [];
	let offset = 0;
	let oldLine = 0;
	let newLine = 0;
	for (const line of patch.split("\n")) {
		const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
		if (header) {
			oldLine = Number(header[1]);
			newLine = Number(header[2]);
		}
		let number = "";
		const isMeta =
			header !== null ||
			line.startsWith("+++ ") ||
			line.startsWith("--- ") ||
			line.startsWith("diff ") ||
			line.startsWith("index ") ||
			line.startsWith("\\ ");
		if (!isMeta) {
			if (line.startsWith("-")) {
				number = String(oldLine);
				oldLine += 1;
			} else if (line.startsWith("+")) {
				number = String(newLine);
				newLine += 1;
			} else {
				number = String(newLine);
				oldLine += 1;
				newLine += 1;
			}
		}
		lines.push({ key: `at-${offset}`, line, number });
		offset += line.length + 1;
	}
	return lines;
}
