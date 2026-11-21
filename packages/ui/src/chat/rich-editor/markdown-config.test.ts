import { createEditor, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
	$exportComposerMarkdown,
	$importComposerMarkdown,
	COMPOSER_NODES,
	importComposerMarkdown,
} from "./markdown-config.ts";

/** 建一个只在用例里用的编辑器：有 DOM、有节点，不挂 React。 */
function testEditor(): LexicalEditor {
	return createEditor({
		namespace: "composer-markdown-test",
		nodes: COMPOSER_NODES,
		onError: (error) => {
			throw error;
		},
	});
}

/** 把一段 Markdown 铺进编辑器再导出，模拟「外部写入之后用户接着编辑」这一趟。 */
function roundTrip(markdown: string): string {
	const editor = testEditor();
	let exported = "";
	editor.update(
		() => {
			$importComposerMarkdown(markdown);
			exported = $exportComposerMarkdown();
		},
		{ discrete: true },
	);
	return exported;
}

describe("输入区的 Markdown 口径", () => {
	it("空编辑态导出空串", () => {
		const editor = testEditor();
		expect(editor.getEditorState().read(() => $exportComposerMarkdown())).toBe("");
	});

	it("纯文本原样进出", () => {
		expect(roundTrip("你好")).toBe("你好");
	});

	it("单换行保留，不会被并成一段", () => {
		expect(roundTrip("第一行\n第二行")).toBe("第一行\n第二行");
	});

	it("末尾的换行照实保留", () => {
		// 按下换行却没接着写时，草稿要与编辑器里看见的一致
		expect(roundTrip("第一行\n")).toBe("第一行\n");
	});

	it("引用块逐行往返稳定", () => {
		const quoted = "我的问题\n\n> 第一行\n> 第二行";
		expect(roundTrip(quoted)).toBe(quoted);
	});

	it("列表往返仍是列表", () => {
		expect(roundTrip("- 甲\n- 乙")).toBe("- 甲\n- 乙");
		expect(roundTrip("1. 甲\n2. 乙")).toBe("1. 甲\n2. 乙");
	});

	it("代码块往返保留围栏与内容", () => {
		const code = "```\nconst a = 1;\n```";
		expect(roundTrip(code)).toBe(code);
	});

	it("行内格式与行内代码往返", () => {
		expect(roundTrip("**粗**与*斜*与`代码`")).toBe("**粗**与*斜*与`代码`");
	});

	it("开头的井号不当成标题", () => {
		// `#12` 是聊天里常见的引用编号，转了标题就把原意改了
		expect(roundTrip("#12 这条提交")).toBe("#12 这条提交");
	});

	it("外部写入整份替换内容", () => {
		const editor = testEditor();
		editor.update(() => $importComposerMarkdown("旧内容"), { discrete: true });
		importComposerMarkdown(editor, "新内容");
		expect(editor.getEditorState().read(() => $exportComposerMarkdown())).toBe("新内容");
	});

	it("外部写入空串时回到空编辑态", () => {
		const editor = testEditor();
		editor.update(() => $importComposerMarkdown("要点"), { discrete: true });
		importComposerMarkdown(editor, "");
		expect(editor.getEditorState().read(() => $exportComposerMarkdown())).toBe("");
	});
});
