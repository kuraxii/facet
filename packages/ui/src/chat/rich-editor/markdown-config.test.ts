import { $createCodeNode } from "@lexical/code";
import { $createLinkNode } from "@lexical/link";
import { $createListItemNode, $createListNode } from "@lexical/list";
import { $createQuoteNode } from "@lexical/rich-text";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	createEditor,
	type ElementNode,
	type LexicalEditor,
} from "lexical";
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

/**
 * 把一段原文当成纯文本粘进输入区再导出。
 *
 * 不走 Markdown 解析：粘贴的是纯文本时落进段落的就是一个文本节点，`#`、`*`、反引号都是
 * 普通字符，导出必须一字不差地吐回来。
 */
function pastedPlainText(text: string): string {
	const editor = testEditor();
	let exported = "";
	editor.update(
		() => {
			$getRoot().clear();
			$getRoot().append($createParagraphNode().append($createTextNode(text)));
			exported = $exportComposerMarkdown();
		},
		{ discrete: true },
	);
	return exported;
}

/** 手工搭一份文档再导出：覆盖「手敲出来的富文本」这条路径。 */
function exportedDocument(build: (root: ElementNode) => void): string {
	const editor = testEditor();
	let exported = "";
	editor.update(
		() => {
			$getRoot().clear();
			build($getRoot());
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

describe("粘进来的原文不转义", () => {
	/** 一段典型的手写提示词：标题、列表、行内代码、通配符都在里面 */
	const RAW = ["## 标题", "1. **加粗**", "`layout-contract.ts`", "`prefers-*`", "通配符 *.ts"].join("\n");

	it("整段原文导出逐字符一致", () => {
		expect(pastedPlainText(RAW)).toBe(RAW);
	});

	it("一个反斜杠都不补", () => {
		expect(pastedPlainText(RAW)).not.toContain("\\");
	});

	it("星号、反引号、下划线、波浪线与方括号都原样输出", () => {
		const text = "a*b_c`d~e[f]g#h @x/y.ts - 甲 1. 乙";
		expect(pastedPlainText(text)).toBe(text);
	});

	it("原文里的空行与行尾空白照实保留", () => {
		const text = "甲\n\n乙\n";
		expect(pastedPlainText(text)).toBe(text);
	});

	it("只粘通配符与连字符时也不会被当成标记", () => {
		expect(pastedPlainText("*.ts")).toBe("*.ts");
		expect(pastedPlainText("prefers-*")).toBe("prefers-*");
		expect(pastedPlainText("-*-")).toBe("-*-");
	});
});

describe("手敲出来的富文本导出", () => {
	it("加粗、斜体、粗斜体与行内代码各包一层", () => {
		const out = exportedDocument((root) => {
			root.append(
				$createParagraphNode().append(
					$createTextNode("粗").toggleFormat("bold"),
					$createTextNode("与"),
					$createTextNode("斜").toggleFormat("italic"),
					$createTextNode("与"),
					$createTextNode("粗斜").toggleFormat("bold").toggleFormat("italic"),
					$createTextNode("与"),
					$createTextNode("行内").toggleFormat("code"),
				),
			);
		});
		expect(out).toBe("**粗**与*斜*与***粗斜***与`行内`");
	});

	it("两端带空白的加粗把空白挪到标记外面", () => {
		const out = exportedDocument((root) => {
			root.append(
				$createParagraphNode().append(
					$createTextNode("甲 "),
					$createTextNode(" 加粗 ").toggleFormat("bold"),
					$createTextNode(" 乙"),
				),
			);
		});
		expect(out).toBe("甲  **加粗**  乙");
	});

	it("同一段粗体被拆成多个文本节点时只包一层", () => {
		const out = exportedDocument((root) => {
			root.append(
				$createParagraphNode().append(
					$createTextNode("前").toggleFormat("bold"),
					$createTextNode("后").toggleFormat("bold"),
				),
			);
		});
		expect(out).toBe("**前后**");
	});

	it("行内代码里含反引号时围栏加长并补空格", () => {
		expect(
			exportedDocument((root) => {
				root.append($createParagraphNode().append($createTextNode("a`b").toggleFormat("code")));
			}),
		).toBe("`` a`b ``");
	});

	it("代码块带语言，内容原样", () => {
		const out = exportedDocument((root) => {
			root.append($createCodeNode("ts").append($createTextNode("const a = 1;")));
		});
		expect(out).toBe("```ts\nconst a = 1;\n```");
	});

	it("引用块每一行都带前缀", () => {
		const out = exportedDocument((root) => {
			const quote = $createQuoteNode();
			quote.append($createTextNode("一"), $createTextNode("\n"), $createTextNode("二"));
			root.append(quote);
		});
		expect(out).toBe("> 一\n> 二");
	});

	it("无序列表的嵌套按父项标记宽度缩进两格", () => {
		const out = exportedDocument((root) => {
			const inner = $createListNode("bullet");
			inner.append($createListItemNode().append($createTextNode("甲一")));
			const outer = $createListNode("bullet");
			const item = $createListItemNode().append($createTextNode("甲"));
			item.append(inner);
			outer.append(item, $createListItemNode().append($createTextNode("乙")));
			root.append(outer);
		});
		expect(out).toBe("- 甲\n  - 甲一\n- 乙");
		expect(roundTrip(out)).toBe(out);
	});

	it("三层嵌套与混排都按各层标记宽度累加", () => {
		const out = exportedDocument((root) => {
			const third = $createListNode("number");
			third.append($createListItemNode().append($createTextNode("丙")));
			const second = $createListNode("bullet");
			const secondItem = $createListItemNode().append($createTextNode("乙"));
			secondItem.append(third);
			second.append(secondItem);
			const first = $createListNode("bullet");
			const firstItem = $createListItemNode().append($createTextNode("甲"));
			firstItem.append(second);
			first.append(firstItem);
			root.append(first);
		});
		// 第一层 `- ` 两格，第二层再让出 `- ` 两格，第三层的 `1. ` 落在四格上
		expect(out).toBe("- 甲\n  - 乙\n    1. 丙");
		// 缩进恰好落在上一层的起始列上，读回来还是同一棵树
		expect(roundTrip(out)).toBe(out);
	});

	it("有序列表按 list.getStart() 递增，嵌套跟着标记宽度缩进三格", () => {
		const out = exportedDocument((root) => {
			const inner = $createListNode("number");
			inner.append($createListItemNode().append($createTextNode("乙")));
			const outer = $createListNode("number");
			const item = $createListItemNode().append($createTextNode("甲"));
			item.append(inner);
			outer.append(item);
			root.append(outer);
		});
		expect(out).toBe("1. 甲\n   1. 乙");
		expect(roundTrip(out)).toBe(out);
	});

	it("文件胶囊与命令胶囊导出成 `@路径` 与 `/名字`", () => {
		const out = exportedDocument((root) => {
			root.append(
				$createParagraphNode().append(
					$createTextNode("看 "),
					$createFileMentionNode("src/a.ts"),
					$createTextNode(" 再 "),
					$createSlashCommandNode("review"),
				),
			);
		});
		expect(out).toBe("看 @src/a.ts 再 /review");
	});

	it("链接的文本与地址相同时只写地址，否则写成行内链接", () => {
		const same = exportedDocument((root) => {
			root.append(
				$createParagraphNode().append(
					$createLinkNode("https://a.dev").append($createTextNode("https://a.dev")),
				),
			);
		});
		expect(same).toBe("https://a.dev");
		const labelled = exportedDocument((root) => {
			root.append(
				$createParagraphNode().append($createLinkNode("https://a.dev").append($createTextNode("地址"))),
			);
		});
		expect(labelled).toBe("[地址](https://a.dev)");
	});
});
