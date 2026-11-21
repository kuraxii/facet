import { $createParagraphNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $createFileMentionNode, $isFileMentionNode } from "./file-mention-node.ts";
import {
	$exportComposerMarkdown,
	$importComposerMarkdown,
	COMPOSER_NODES,
	importComposerMarkdown,
} from "./markdown-config.ts";
import { $createSlashCommandNode, $isSlashCommandNode } from "./slash-command-node.ts";

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
function roundTrip(markdown: string, files: readonly string[] = [], known: readonly string[] = []): string {
	const editor = testEditor();
	let exported = "";
	editor.update(
		() => {
			$importComposerMarkdown(markdown, new Set(files), new Set(known));
			exported = $exportComposerMarkdown();
		},
		{ discrete: true },
	);
	return exported;
}

/** 铺一段 Markdown 之后，树里 `/命令` 胶囊的命令名。 */
function commandsOf(markdown: string, known: readonly string[]): string[] {
	const editor = testEditor();
	let names: string[] = [];
	editor.update(
		() => {
			$importComposerMarkdown(markdown, new Set(), new Set(known));
			names = $getRoot()
				.getAllTextNodes()
				.filter((node) => $isSlashCommandNode(node))
				.map((node) => node.getCommandName());
		},
		{ discrete: true },
	);
	return names;
}

/** 铺一段 Markdown 之后，树里 `@` 引用胶囊的路径。 */
function mentionsOf(markdown: string, files: readonly string[]): string[] {
	const editor = testEditor();
	let paths: string[] = [];
	editor.update(
		() => {
			$importComposerMarkdown(markdown, new Set(files));
			paths = $getRoot()
				.getAllTextNodes()
				.filter((node) => $isFileMentionNode(node))
				.map((node) => node.getFilePath());
		},
		{ discrete: true },
	);
	return paths;
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

describe("`@文件` 胶囊", () => {
	const FILES = ["src/a.ts", "docs/readme.md"] as const;

	it("对外导出完整路径,屏幕上只显示文件名", () => {
		const editor = testEditor();
		let text = "";
		let label = "";
		let title = "";
		editor.update(
			() => {
				$importComposerMarkdown("看 @src/a.ts 这个", new Set(FILES));
				const mention = $getRoot()
					.getAllTextNodes()
					.find((node) => $isFileMentionNode(node));
				text = mention?.getTextContent() ?? "";
				label = mention?.getTextContent().replace("@src/", "@") ?? "";
				title = $exportComposerMarkdown();
			},
			{ discrete: true },
		);
		// 节点文本是完整路径，Markdown 导出照着它走
		expect(text).toBe("@src/a.ts");
		// 屏幕上那份短名字由文件名推出来
		expect(label).toBe("@a.ts");
		expect(title).toBe("看 @src/a.ts 这个");
	});

	it("命中已知文件的 @路径 还原成胶囊,文本其余部分不动", () => {
		expect(mentionsOf("看 @src/a.ts 与 @docs/readme.md 两处", FILES)).toEqual(["src/a.ts", "docs/readme.md"]);
		// 往返之后一字不差
		expect(roundTrip("看 @src/a.ts 与 @docs/readme.md 两处", FILES)).toBe(
			"看 @src/a.ts 与 @docs/readme.md 两处",
		);
	});

	it("不在清单里的 @路径、普通 @名字 与邮箱都保持文本", () => {
		expect(mentionsOf("@src/other.ts 与 @someone 与 a@b.com", FILES)).toEqual([]);
		expect(roundTrip("@src/other.ts 与 @someone 与 a@b.com", FILES)).toBe(
			"@src/other.ts 与 @someone 与 a@b.com",
		);
	});

	it("代码块里的 @路径 不还原成胶囊", () => {
		expect(mentionsOf("```\n// @src/a.ts\n```", FILES)).toEqual([]);
	});

	it("行内代码里的 @路径 不还原成胶囊", () => {
		expect(mentionsOf("`@src/a.ts`", FILES)).toEqual([]);
	});

	it("胶囊可以整块导出再读回", () => {
		const editor = testEditor();
		editor.update(
			() => {
				$getRoot().append($createParagraphNode().append($createFileMentionNode("src/a.ts")));
			},
			{ discrete: true },
		);
		expect(editor.getEditorState().read(() => $exportComposerMarkdown())).toBe("@src/a.ts");
	});
});

describe("`/命令` 胶囊", () => {
	const KNOWN = ["review", "compact"] as const;

	it("导出就是 `/名字`，屏幕上也是它", () => {
		const editor = testEditor();
		editor.update(
			() => {
				$getRoot().append($createParagraphNode().append($createSlashCommandNode("review")));
			},
			{ discrete: true },
		);
		// 草稿对外的写法与逐字敲出来的一模一样，`parseCommand` 不用另认一套
		expect(editor.getEditorState().read(() => $exportComposerMarkdown())).toBe("/review");
	});

	it("首段命中已知命令的 `/名字` 还原成胶囊,参数留在后面", () => {
		expect(commandsOf("/review 看下 diff", KNOWN)).toEqual(["review"]);
		expect(roundTrip("/review 看下 diff", [], KNOWN)).toBe("/review 看下 diff");
		// 选中命令之后那个空格也照原样读回
		expect(commandsOf("/compact ", KNOWN)).toEqual(["compact"]);
		expect(roundTrip("/compact ", [], KNOWN)).toBe("/compact ");
	});

	it("路径与非首段的斜杠保持文本", () => {
		// `/usr/bin/env` 是路径：整段不是某条命令的名字
		expect(commandsOf("/usr/bin/env node", KNOWN)).toEqual([]);
		expect(roundTrip("/usr/bin/env node", [], KNOWN)).toBe("/usr/bin/env node");
		// 命令只在文首生效，第二段里的 `/review` 只是一段文字
		expect(commandsOf("第一行\n\n/review", KNOWN)).toEqual([]);
		expect(roundTrip("第一行\n\n/review", [], KNOWN)).toBe("第一行\n\n/review");
	});

	it("没有命令清单时不认任何斜杠", () => {
		expect(commandsOf("/review 看下 diff", [])).toEqual([]);
	});

	it("行内代码与代码块里的 `/名字` 不还原成胶囊", () => {
		expect(commandsOf("`/review`", KNOWN)).toEqual([]);
		expect(commandsOf("```\n/review\n```", KNOWN)).toEqual([]);
	});
});
