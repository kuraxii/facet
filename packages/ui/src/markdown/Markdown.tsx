/**
 * Markdown 正文渲染。
 *
 * 用 markstream 渲染:它按「是否已结束」区分进行中与固化两种状态,未闭合的代码块、
 * 表格、链接在流式期间不会闪成空白。代码块走本项目的悬浮卡,公式与流程图是可选的。
 */
import MarkdownRender, { type SmoothMarkdownStreamOptions } from "markstream-react";
import { useRef } from "react";
import "markstream-react/index.css";
import "katex/dist/katex.min.css";
import { MARKDOWN_SCOPE } from "./registry.ts";

/** 平滑输出的基速,其余节奏用库默认值。 */
const SMOOTH_OPTIONS: SmoothMarkdownStreamOptions = {
	minCharsPerSecond: 80,
};

/** 代码块主题。顺序是深色在前,这个是库的类型约定。 */
const CODE_DARK_THEME = "vitesse-dark";
const CODE_LIGHT_THEME = "vitesse-light";

/** 主题列表在模块级固定引用:库按身份比较,每次新建数组会让整棵子树重渲。 */
const CODE_BLOCK_THEMES: readonly [string, string] = [CODE_DARK_THEME, CODE_LIGHT_THEME];

/** 只留标题栏与复制按钮,其余按钮全部关掉。布尔项必须给显式值,传 undefined 会覆盖库的默认 true。 */
const CODE_BLOCK_PROPS = {
	showHeader: true,
	showCopyButton: true,
	showFontSizeButtons: false,
	showExpandButton: false,
	showPreviewButton: false,
	showCollapseButton: false,
	showLineNumbers: false,
} as const;

/**
 * 代码块排版。长行折行显示,不出现横向滚动条;行号与虚拟化缓冲在聊天流里都用不上。
 * 对象身份要稳定,每次渲染新建会让代码块重建。
 */
const CODE_BLOCK_OPTIONS = {
	fontSize: 12.5,
	lineHeight: 1.6,
	padding: 12,
	overflow: "wrap",
	disableLineNumbers: true,
	maxHeight: 360,
	disableVirtualizationBuffers: true,
} as const;

/** 打开平滑输出时,系统偏好减弱动效的场合不启用。 */
function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 正文渲染参数。 */
export interface MarkdownProps {
	/** Markdown 原文 */
	text: string;
	/** 是否仍在流式写入,决定进行中外观 */
	isStreaming: boolean;
	/** 一段正文在列表里的序号,用于让代码块的 DOM id 保持唯一 */
	indexKey?: number | string;
	/** 是否深色,缺省为深色 */
	isDark?: boolean;
}

export function Markdown({ text, isStreaming, indexKey, isDark = true }: MarkdownProps) {
	// 平滑只看挂载时的状态:历史消息挂载时不是流式,就不该重播一遍打字机
	const smoothRef = useRef(isStreaming && !prefersReducedMotion());

	return (
		<div className="md">
			<MarkdownRender
				customId={MARKDOWN_SCOPE}
				content={text}
				final={!isStreaming}
				fade={false}
				smoothStreaming={smoothRef.current}
				smoothStreamingOptions={SMOOTH_OPTIONS}
				isDark={isDark}
				codeBlockDarkTheme={CODE_DARK_THEME}
				codeBlockLightTheme={CODE_LIGHT_THEME}
				themes={CODE_BLOCK_THEMES}
				codeBlockProps={CODE_BLOCK_PROPS}
				codeBlockOptions={CODE_BLOCK_OPTIONS}
				showTooltips={false}
				// 关闭按可见性延迟渲染:占位条只在内容更新时被顺带刷新,流一停就永久留下
				deferNodesUntilVisible={false}
				indexKey={indexKey}
			/>
		</div>
	);
}
