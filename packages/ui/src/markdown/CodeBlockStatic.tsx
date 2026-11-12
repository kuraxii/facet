/**
 * 代码块渲染。
 *
 * 库自带的代码卡把正文渲染在 shadow root 里,字号、折行、配色都无法用样式覆盖,
 * 也不便按行上色,所以这里换成自绘卡片:shiki 分词、按行输出,长行折行不横向滚动。
 * 标题栏常态隐身,悬浮或聚焦时才出现复制按钮。
 */

import { type ReactNode, useEffect, useState } from "react";
import type { CodeBlockNode } from "stream-markdown-parser";
import { codeThemeName } from "../theme.ts";
import { shouldShowCodeBlock } from "./code-block-state.ts";
import { resolveCodeLang } from "./code-lang.ts";
import { useCodeTheme } from "./code-theme.tsx";
import { getHighlighterFor, type HighlightLine, highlightLines } from "./highlighter.ts";

/** 自定义组件从库里拿到的参数,只取用得到的部分。 */
export interface CodeBlockStaticProps {
	/** 解析出来的代码块节点 */
	node: CodeBlockNode;
	/** 是否仍在流式写入 */
	stream?: boolean;
}

/** 纯文本按行拆开,高亮就绪前与分词失败时使用。 */
function plainLines(code: string): readonly HighlightLine[] {
	return code.split("\n").map((line) => ({ tokens: [{ text: line, color: undefined }] }));
}

/** 行首的增删标记,diff 围栏按行上红绿。 */
function lineMark(line: HighlightLine): string {
	const first = line.tokens[0]?.text ?? "";
	if (first.startsWith("+")) {
		return "is-add";
	}
	if (first.startsWith("-")) {
		return "is-del";
	}
	return "";
}

/** 行内片段。键用累计字符偏移,流式追加时不会因为下标移动而重建整行。 */
function tokenSpans(line: HighlightLine): ReactNode[] {
	const spans: ReactNode[] = [];
	let offset = 0;
	for (const token of line.tokens) {
		spans.push(
			<span key={`at-${offset}`} style={token.color === undefined ? undefined : { color: token.color }}>
				{token.text}
			</span>,
		);
		offset += token.text.length;
	}
	return spans;
}

/** 一行代码。 */
function CodeLine({ line }: { line: HighlightLine }) {
	const mark = lineMark(line);
	return (
		<span className={`code-card-line${mark.length > 0 ? ` ${mark}` : ""}`}>
			{tokenSpans(line)}
			{"\n"}
		</span>
	);
}

/** 复制按钮。 */
function CopyButton({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) {
			return;
		}
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<button
			type="button"
			className="code-copy"
			onClick={() => {
				void navigator.clipboard?.writeText(code).then(
					() => setCopied(true),
					() => setCopied(false),
				);
			}}
		>
			{copied ? "已复制" : "复制"}
		</button>
	);
}

/** 代码行。键用行内容与位置组合,内容变化时自然重建这一行。 */
function lineRows(lines: readonly HighlightLine[]): ReactNode[] {
	const rows: ReactNode[] = [];
	let offset = 0;
	for (const line of lines) {
		const text = line.tokens.map((token) => token.text).join("");
		rows.push(<CodeLine key={`line-${offset}`} line={line} />);
		offset += text.length + 1;
	}
	return rows;
}

/** 代码块卡片。 */
function CodeCard({ code, language }: { code: string; language: string }) {
	const codeTheme = useCodeTheme();
	const [lines, setLines] = useState<readonly HighlightLine[] | undefined>(undefined);
	const theme = codeThemeName(codeTheme.theme, codeTheme.isDark);

	useEffect(() => {
		let cancelled = false;
		void getHighlighterFor(codeTheme.theme, codeTheme.isDark).then(
			(instance) => {
				if (cancelled) {
					return;
				}
				setLines(highlightLines(instance, code, language, theme) ?? plainLines(code));
			},
			() => {
				if (!cancelled) {
					setLines(plainLines(code));
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [code, language, theme, codeTheme.theme, codeTheme.isDark]);

	const body = lines ?? plainLines(code);
	return (
		<div className="code-card">
			<div className="code-card-head">
				<span className="code-lang">{language}</span>
				<CopyButton code={code} />
			</div>
			<pre className="code-card-body">{lineRows(body)}</pre>
		</div>
	);
}

/**
 * 代码块入口。围栏未写完且无正文时不出卡片,diff 围栏固定用 diff 语法。
 */
export function CodeBlockStatic({ node }: CodeBlockStaticProps) {
	const isDiff = node.diff === true;
	// diff 围栏用统一文本,去掉围栏行之后的内容才能按行着色
	const code = (isDiff ? node.raw : node.code) ?? "";
	if (!shouldShowCodeBlock({ loading: node.loading, code })) {
		return null;
	}
	return <CodeCard code={code} language={isDiff ? "diff" : resolveCodeLang(node.language)} />;
}
