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
	// 上下文行：行号列在这三态里样式不同（上下文行有底色，增删行没有），所以要有自己的类
	return "is-ctx";
}

/** 补丁里的一行。 */
export interface PatchLine {
	/** 稳定键，取累计偏移 */
	key: string;
	/** 原始行 */
	line: string;
	/** 行号；文件头与 hunk 头为空。增行取新行号、删行取旧行号 */
	number: string;
	/** 旧文件行号：增行没有（留空），其余同 `number` */
	oldNumber: string;
	/** 新文件行号：删行没有（留空），其余同 `number` */
	newNumber: string;
	/** 行首记号：`+` / `-` / 空格；文件头与 hunk 头为空 */
	sign: string;
	/** 去掉记号之后的正文；文件头与 hunk 头保留原样 */
	text: string;
}

/** 文件头与 git 元信息行的前缀；变更文档只保留 hunk 与正文。 */
const FILE_HEADER_PREFIXES = [
	"diff --git ",
	"index ",
	"--- ",
	"+++ ",
	"new file mode ",
	"deleted file mode ",
	"old mode ",
	"new mode ",
	"similarity index ",
	"dissimilarity index ",
	"rename from ",
	"rename to ",
	"copy from ",
	"copy to ",
	"Binary files ",
	"\\ No newline at end of file",
] as const;

/** 这一行是不是补丁的文件头或 git 元信息。 */
export function isDiffFileHeader(line: string): boolean {
	return FILE_HEADER_PREFIXES.some((prefix) => line.startsWith(prefix));
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
		let oldNumber = "";
		let newNumber = "";
		let sign = "";
		let text = line;
		const isMeta =
			header !== null ||
			line.startsWith("+++ ") ||
			line.startsWith("--- ") ||
			line.startsWith("diff ") ||
			line.startsWith("index ") ||
			line.startsWith("\\ ");
		if (!isMeta) {
			if (line.startsWith("-")) {
				// 删行只有旧行号：新文件里没有这一行，那一格留空
				number = String(oldLine);
				oldNumber = number;
				sign = "-";
				oldLine += 1;
			} else if (line.startsWith("+")) {
				number = String(newLine);
				newNumber = number;
				sign = "+";
				newLine += 1;
			} else {
				number = String(newLine);
				oldNumber = String(oldLine);
				newNumber = number;
				sign = " ";
				oldLine += 1;
				newLine += 1;
			}
			// 记号占一个字符：去掉之后正文自己从第 0 列开始排
			text = line.slice(1);
		}
		lines.push({ key: `at-${offset}`, line, number, oldNumber, newNumber, sign, text });
		offset += line.length + 1;
	}
	return lines;
}

/** 变更文档里的补丁正文：去掉文件头、索引、重命名等 git 元信息，只留 hunk 与改动行。 */
export function patchBodyLines(patch: string): readonly PatchLine[] {
	return patchLines(patch).filter(({ line }) => !isDiffFileHeader(line));
}
