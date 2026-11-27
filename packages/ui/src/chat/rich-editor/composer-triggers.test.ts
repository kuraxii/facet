import { describe, expect, it } from "vitest";
import {
	appendQuoteText,
	fileBasename,
	fileDirname,
	findDecorations,
	mentionTrigger,
	rankMentionFiles,
	slashTrigger,
} from "./composer-triggers.ts";

describe("composer-triggers 触发与胶囊范围", () => {
	it("文件名拆分与候选排序", () => {
		expect(fileBasename("src/chat/Composer.tsx")).toBe("Composer.tsx");
		expect(fileDirname("src/chat/Composer.tsx")).toBe("src/chat");
		expect(fileDirname("readme.md")).toBe("");
		expect(rankMentionFiles(["docs/composer.md", "src/chat/Composer.tsx", "src/a.ts"], "com")).toEqual([
			"docs/composer.md",
			"src/chat/Composer.tsx",
		]);
		expect(rankMentionFiles(["src/a.ts", "src/sub/foo-com.ts", "src/chat/Composer.tsx"], "com")).toEqual([
			"src/chat/Composer.tsx",
			"src/sub/foo-com.ts",
		]);
	});

	it("邮箱中的 @ 不触发补全，行首与空白后触发", () => {
		expect(mentionTrigger("mail a@b.com", 12)).toBeNull();
		expect(mentionTrigger("看 @Com", 6)).toEqual({ from: 2, to: 6, query: "Com" });
		expect(mentionTrigger("@", 1)).toEqual({ from: 0, to: 1, query: "" });
	});

	it("命令补全仅在文档第一行开头触发", () => {
		const known = new Set(["compact"]);
		expect(slashTrigger("/comp", 5, known)).toEqual({ from: 0, to: 5, query: "comp" });
		expect(slashTrigger("hello /comp", 11, known)).toBeNull();
		expect(slashTrigger("line1\n/comp", 11, known)).toBeNull();
	});

	it("计算文首 /命令 与文中 @文件 胶囊范围且不影响其余符号", () => {
		const files = new Set(["src/a.ts"]);
		const cmds = new Set(["review"]);
		expect(findDecorations("/review 看 @src/a.ts *.ts", files, cmds)).toEqual([
			{ kind: "command", from: 0, to: 7, name: "review" },
			{ kind: "mention", from: 10, to: 19, filePath: "src/a.ts" },
		]);
		// 尚未输入空白时不提前折叠正在输入的 `/review`
		expect(findDecorations("/review", files, cmds)).toEqual([]);
	});

	it("appendQuoteText 按纯文本引用格式拼接", () => {
		expect(appendQuoteText("", "line 1\nline 2")).toBe("> line 1\n> line 2\n");
		expect(appendQuoteText("先写的一段", "被引用的文字")).toBe("先写的一段\n> 被引用的文字\n");
	});
});
