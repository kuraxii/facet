/**
 * 定位 pi 系统提示词中的顶层 XML 分段。
 *
 * 参考并裁剪自 pi-context-view（MIT，Copyright (c) Dmitry Makarov）。
 */

/** 半开字符区间 `[start, end)`。 */
export interface TextSpan {
	readonly start: number;
	readonly end: number;
}

/** 一个完整的顶层 XML 提示词分段，包装标签与正文范围分开记录。 */
export interface PromptSection extends TextSpan {
	/** 分段标签名，如 `tools`、`rules`、`project_context`、`skills` */
	readonly name: string;
	/** 分段正文区间（不含闭合标签前的换行） */
	readonly body: TextSpan;
}

/**
 * 按渲染顺序扫描系统提示词中的顶层 XML 分段。
 *
 * 跳过围栏代码块与分段内部嵌套标签，避免把指令文件、Skill 或示例文本里的 XML 标签误判为顶层分段。
 */
export function findPromptSections(prompt: string): PromptSection[] {
	const sections: PromptSection[] = [];
	let fence: string | undefined;
	const pattern = /^<([a-z][a-z0-9_-]*)>\n|^ {0,3}(`{3,}|~{3,})([^\n]*)/gm;
	for (let match = pattern.exec(prompt); match !== null; match = pattern.exec(prompt)) {
		const marker = match[2];
		if (marker !== undefined) {
			if (fence === undefined) {
				fence = marker;
			} else if (marker[0] === fence[0] && marker.length >= fence.length && (match[3] ?? "").trim() === "") {
				fence = undefined;
			}
			continue;
		}
		if (fence !== undefined) {
			continue;
		}

		const name = match[1];
		if (name === undefined) {
			continue;
		}
		const closing = `\n</${name}>`;
		const end = prompt.indexOf(closing, pattern.lastIndex);
		if (end === -1) {
			continue;
		}

		const after = end + closing.length;
		if (after < prompt.length && prompt[after] !== "\n") {
			continue;
		}
		sections.push({
			name,
			start: match.index,
			end: after,
			body: { start: pattern.lastIndex - 1, end },
		});
		pattern.lastIndex = after;
	}

	return sections;
}
