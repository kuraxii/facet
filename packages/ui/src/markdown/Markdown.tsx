/**
 * Markdown 正文渲染。
 *
 * 用 markstream 渲染:它按「是否已结束」区分进行中与固化两种状态,未闭合的代码块、
 * 表格、链接在流式期间不会闪成空白。代码块走本项目的悬浮卡,公式与流程图是可选的。
 */
import MarkdownRender, { type SmoothMarkdownStreamOptions } from "markstream-react";
import { useMemo, useRef } from "react";
import "markstream-react/index.css";
import "katex/dist/katex.min.css";
import { codeThemeName } from "../theme.ts";
import { useCodeTheme } from "./code-theme.tsx";
import { MARKDOWN_SCOPE } from "./registry.ts";

/** 平滑输出的基速,其余节奏用库默认值。 */
const SMOOTH_OPTIONS: SmoothMarkdownStreamOptions = {
	minCharsPerSecond: 80,
};

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

/**
 * 流程图（mermaid）的排版。
 *
 * 主题由 `isDark` 决定：库会在源码前注入 `%%{init: {"theme": "dark"|"default"}}%%`。
 * 高度封顶，长图在块内滚动，不把整段对话顶走；渲染失败时进 error 态，`showModeToggle`
 * 让使用者随时切到源码；严格模式关掉交互与 html 标签。
 */
const MERMAID_PROPS = {
	maxHeight: "420px",
	showHeader: true,
	showModeToggle: true,
	showCopyButton: true,
	showFullscreenButton: true,
	showZoomControls: false,
	showCollapseButton: false,
	enableWheelZoom: false,
	enableMermaidInteractions: false,
	isStrict: true,
	showTooltips: false,
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
}

export function Markdown({ text, isStreaming, indexKey }: MarkdownProps) {
	// 平滑只看挂载时的状态:历史消息挂载时不是流式,就不该重播一遍打字机
	const smoothRef = useRef(isStreaming && !prefersReducedMotion());
	const codeTheme = useCodeTheme();
	const isDark = codeTheme.isDark;
	// 主题名变化时才换数组引用:库按身份比较,每次渲染新建数组会让整棵子树重渲
	const blockThemes = useMemo<readonly [string, string]>(
		() => [codeThemeName(codeTheme.theme, true), codeThemeName(codeTheme.theme, false)],
		[codeTheme.theme],
	);

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
				codeBlockDarkTheme={blockThemes[0]}
				codeBlockLightTheme={blockThemes[1]}
				themes={blockThemes}
				codeBlockProps={CODE_BLOCK_PROPS}
				mermaidProps={MERMAID_PROPS}
				codeBlockOptions={CODE_BLOCK_OPTIONS}
				showTooltips={false}
				// 关闭按可见性延迟渲染:占位条只在内容更新时被顺带刷新,流一停就永久留下
				deferNodesUntilVisible={false}
				indexKey={indexKey}
			/>
		</div>
	);
}
