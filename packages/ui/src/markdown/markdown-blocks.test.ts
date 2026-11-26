/**
 * 流式解析的顶层块沿用。
 *
 * `Markdown.tsx` 给解析器开了 `reuseStableTopLevelNodes`：没变的顶层块连节点对象一起沿用，
 * 渲染器按节点身份做的记忆才是活的——否则后端每帧给所有块造一批新节点，一条长回答在流式期间
 * 等于整条重渲。
 *
 * 这里钉住的是**依赖的行为**，不是我们的代码：这条一旦不成立（升级解析器后节点不再沿用），
 * 界面不会报错，只会悄悄变慢。所以在这里断言，让它红。
 */
import { getMarkdown, parseMarkdownToStructure } from "stream-markdown-parser";
import { describe, expect, it } from "vitest";

const md = getMarkdown("markdown-blocks-test");
const streaming = { reuseStableTopLevelNodes: true, final: false } as const;

describe("流式解析的顶层块沿用", () => {
	it("只追加正文时，已稳定的段落与代码块沿用同一个节点", () => {
		const first = parseMarkdownToStructure("第一段\n\n```js\nconst a = 1\n```\n", md, streaming);
		const grown = parseMarkdownToStructure(
			"第一段\n\n```js\nconst a = 1\n```\n\n第二段正在写",
			md,
			streaming,
		);
		const more = parseMarkdownToStructure(
			"第一段\n\n```js\nconst a = 1\n```\n\n第二段正在写更多",
			md,
			streaming,
		);
		expect(first[0]).toBe(grown[0]);
		expect(grown[0]).toBe(more[0]);
		// 代码块闭合之后也稳定下来
		expect(grown[1]).toBe(more[1]);
	});

	it("正在写的那一块每次都是新节点，渲染不会漏", () => {
		const grown = parseMarkdownToStructure("第一段\n\n正在写的第二段", md, streaming);
		const more = parseMarkdownToStructure("第一段\n\n正在写的第二段继续", md, streaming);
		expect(grown[1]).not.toBe(more[1]);
	});

	it("不开这个选项时节点不沿用，所以选项必须显式打开", () => {
		const withReuse = parseMarkdownToStructure("甲\n\n乙", md, streaming);
		const without = parseMarkdownToStructure("甲\n\n乙", md, { final: false });
		expect(withReuse[0]).not.toBe(without[0]);
	});

	it("最终解析（final）不做块沿用，收尾一定重算一次", () => {
		const streamingRun = parseMarkdownToStructure("甲\n\n```js\nb\n```", md, streaming);
		const finalRun = parseMarkdownToStructure("甲\n\n```js\nb\n```", md, {
			reuseStableTopLevelNodes: true,
			final: true,
		});
		expect(streamingRun[0]).not.toBe(finalRun[0]);
	});
});
