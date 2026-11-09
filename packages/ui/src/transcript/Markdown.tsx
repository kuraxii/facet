/**
 * Markdown 正文渲染。
 *
 * 用 markstream 渲染:它按「是否已结束」区分进行中与固化两种状态,未闭合的代码块、
 * 表格、链接在流式期间不会闪成空白。代码块由 stream-diffs 接管,公式与流程图是可选的。
 */
import MarkdownRender from "markstream-react";
import "markstream-react/index.css";
import "katex/dist/katex.min.css";

/** 代码块的最大高度,超过后在块内滚动。 */
const CODE_MAX_HEIGHT = 360;

/** 正文渲染参数。 */
export interface MarkdownProps {
	/** Markdown 原文 */
	text: string;
	/** 是否仍在流式写入,决定进行中外观与光标 */
	isStreaming: boolean;
	/** 一段正文在列表里的序号,用于让代码块的 DOM id 保持唯一 */
	indexKey?: number | string;
}

export function Markdown({ text, isStreaming, indexKey }: MarkdownProps) {
	return (
		<div className="md">
			<MarkdownRender
				content={text}
				final={!isStreaming}
				isDark
				typewriter={isStreaming}
				fade={false}
				showTooltips={false}
				indexKey={indexKey}
				codeBlockOptions={{
					fontSize: 12.5,
					lineHeight: 1.65,
					maxHeight: CODE_MAX_HEIGHT,
					padding: 10,
					overflow: "scroll",
					disableLineNumbers: true,
				}}
				codeBlockProps={{
					showLineNumbers: false,
					showFontSizeButtons: false,
					showPreviewButton: false,
					showCollapseButton: false,
				}}
			/>
		</div>
	);
}
