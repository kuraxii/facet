/**
 * `@` 补全的纯逻辑：候选排序与触发判定。
 *
 * 这两件事决定「打什么会弹、弹出的第一条是哪条」，与菜单怎么画无关。
 */
import { describe, expect, it } from "vitest";
import { MAX_MENTION_OPTIONS, mentionTrigger, rankMentionFiles } from "./FileMentionPlugin.tsx";

const FILES = [
	"docs/readme.md",
	"src/chat/Composer.tsx",
	"src/composer-helper.ts",
	"src/chat/composer.css",
	"README.md",
];

describe("候选排序", () => {
	it("文件名前缀命中优先,其次文件名包含,最后路径包含;同一档里保持清单原顺序", () => {
		// 三条都命中文件名前缀，所以按清单原来的顺序排；`docs/readme.md` 只命中路径，落在后面
		expect(rankMentionFiles([...FILES, "docs/composer-notes.md"], "composer")).toEqual([
			"src/chat/Composer.tsx",
			"src/composer-helper.ts",
			"src/chat/composer.css",
			"docs/composer-notes.md",
		]);
	});

	it("空查询按原顺序给", () => {
		expect(rankMentionFiles(FILES, "")).toEqual(FILES);
	});

	it("最多十条", () => {
		const many = Array.from({ length: 40 }, (_, index) => `f${index}.ts`);
		expect(rankMentionFiles(many, "f")).toHaveLength(MAX_MENTION_OPTIONS);
	});
});

describe("触发判定", () => {
	it("行首或空白之后的 @ 才触发", () => {
		expect(mentionTrigger("@src/")?.matchingString).toBe("src/");
		expect(mentionTrigger("看 @src/")?.matchingString).toBe("src/");
		expect(mentionTrigger("mail a@b.com")).toBeNull();
	});

	it("查询里允许斜杠与点,不跨空白", () => {
		expect(mentionTrigger("@src/chat/Composer.tsx")?.matchingString).toBe("src/chat/Composer.tsx");
		expect(mentionTrigger("@src/ chat")).toBeNull();
	});

	it("给出替换片段,供菜单换掉 `@查询`", () => {
		const match = mentionTrigger("看 @a");
		expect(match?.replaceableString).toBe("@a");
		expect(match?.leadOffset).toBe(2);
	});
});
