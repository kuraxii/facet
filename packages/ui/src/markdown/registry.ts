/**
 * Markdown 组件表。
 *
 * `setCustomComponents` 按整表替换,同一作用域调用两次会丢掉上一次注册的键,
 * 所以全部组件在这一处一次注册,用独立作用域避免与别处的渲染互相覆盖。
 */
import { setCustomComponents } from "markstream-react";
import { CodeBlockStatic } from "./CodeBlockStatic.tsx";
import { MermaidBlock } from "./MermaidBlock.tsx";

/** 聊天正文的组件表作用域名。 */
export const MARKDOWN_SCOPE = "facet-chat";

setCustomComponents(MARKDOWN_SCOPE, {
	code_block: CodeBlockStatic,
	mermaid: MermaidBlock,
});
