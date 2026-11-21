/**
 * `@` 补全的文件清单。
 *
 * 纯逻辑只有两件事：目录要不要往下走、按预算走出来的清单长什么样。取目录这一步用假的
 * 主机函数顶掉，不碰网络。
 */
import type { FileEntry } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { collectMentionFiles, MENTION_FILE_LIMIT, shouldWalkMentionDir } from "./useMentionFiles.ts";

/** 一层目录的内容：路径 → 条目，目录按名字顺序给。 */
function fakeTree(tree: Record<string, FileEntry[]>) {
	const calls: string[] = [];
	return {
		calls,
		client: {
			listDirectory: async (_cwd: string, path: string): Promise<FileEntry[]> => {
				calls.push(path);
				const entries = tree[path];
				if (entries === undefined) {
					throw new Error(`没有这一层：${path}`);
				}
				return entries;
			},
		},
	};
}

/** 一条文件条目。 */
function file(path: string): FileEntry {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}

/** 一条目录条目。 */
function dir(path: string): FileEntry {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "directory" };
}

describe("目录要不要往下走", () => {
	it("依赖与构建目录不进", () => {
		expect(shouldWalkMentionDir("node_modules", 1)).toBe(false);
		expect(shouldWalkMentionDir("src/dist", 1)).toBe(false);
		expect(shouldWalkMentionDir(".git", 1)).toBe(false);
	});

	it("普通目录在深度预算内才走", () => {
		expect(shouldWalkMentionDir("src", 1)).toBe(true);
		expect(shouldWalkMentionDir("src/chat/editor", 3)).toBe(false);
	});
});

describe("收集文件清单", () => {
	it("广度优先列出文件,跳过依赖目录", async () => {
		const tree = fakeTree({
			"": [dir("src"), dir("node_modules"), file("README.md")],
			src: [file("src/a.ts"), dir("src/chat")],
			"src/chat": [file("src/chat/Composer.tsx")],
		});
		const files = await collectMentionFiles(tree.client, "/repo");

		expect(files).toEqual(["README.md", "src/a.ts", "src/chat/Composer.tsx"]);
		// 依赖目录一次都没取
		expect(tree.calls).not.toContain("node_modules");
	});

	it("某一层取不到时跳过,其余照常", async () => {
		const tree = fakeTree({
			"": [dir("broken"), file("a.ts")],
		});
		const files = await collectMentionFiles(tree.client, "/repo");
		expect(files).toEqual(["a.ts"]);
	});

	it("收满预算就停", async () => {
		const many = Array.from({ length: MENTION_FILE_LIMIT + 20 }, (_, index) => file(`f${index}.ts`));
		const tree = fakeTree({ "": many });
		const files = await collectMentionFiles(tree.client, "/repo");
		expect(files).toHaveLength(MENTION_FILE_LIMIT);
	});
});
