import type { GitFileChange } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { buildChangesTree, flattenChangesTree } from "./changes-tree.ts";

function file(path: string, added = 0, removed = 0): GitFileChange {
	return { path, status: "modified", added, removed, binary: false };
}

describe("变更树", () => {
	it("按目录分组，目录在前、文件在后", () => {
		const tree = buildChangesTree([
			file("src/app.ts", 12, 3),
			file("src/components/Button.tsx", 2, 1),
			file("docs/readme.md", 1, 0),
			file("root.ts", 4, 2),
		]);
		expect(tree.map((node) => (node.kind === "folder" ? node.name : node.file.path))).toEqual([
			"docs",
			"src",
			"root.ts",
		]);
		const src = tree.find((node) => node.kind === "folder" && node.name === "src");
		expect(src?.kind === "folder" ? src.children.length : undefined).toBe(2);
	});

	it("合并只有一个子目录的目录链", () => {
		const tree = buildChangesTree([file("src/components/Button.tsx", 2, 1)]);
		expect(tree).toHaveLength(1);
		expect(tree[0]?.kind === "folder" ? tree[0].name : undefined).toBe("src/components");
		const children = tree[0]?.kind === "folder" ? tree[0].children : [];
		expect(children[0]?.kind === "file" ? children[0].file.path : undefined).toBe(
			"src/components/Button.tsx",
		);
	});

	it("折叠目录时只保留目录行", () => {
		const tree = buildChangesTree([file("src/app.ts", 12, 3), file("src/components/Button.tsx", 2, 1)]);
		const rows = flattenChangesTree(tree, new Set(["src"]));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind === "folder" ? rows[0].path : undefined).toBe("src");
	});

	it("展开后按层级给出缩进深度", () => {
		const tree = buildChangesTree([file("src/app.ts", 12, 3)]);
		const rows = flattenChangesTree(tree, new Set());
		expect(
			rows.map((row) => (row.kind === "folder" ? [row.name, row.depth] : [row.file.path, row.depth])),
		).toEqual([
			["src", 0],
			["src/app.ts", 1],
		]);
	});
});
