/**
 * 变更侧栏的目录树。
 *
 * git 只给出文件路径；这里按路径拼出目录，合并只有单个子目录的链，并把每个目录的增删
 * 行数汇总到目录行。折叠状态不进树结构，展开时由 `flattenChangesTree` 过滤。
 */

import type { GitFileChange } from "@facet/protocol";

/** 树里的一个目录。 */
export interface ChangesTreeFolder {
	/** 目录完整路径，相对项目根 */
	path: string;
	/** 显示名；单子目录链会合并成 `a/b` 这样的形式 */
	name: string;
	/** 子目录与文件，目录在前 */
	children: ChangesTreeNode[];
	kind: "folder";
}

/** 树里的一个文件。 */
export interface ChangesTreeFile {
	/** 文件的改动信息 */
	file: GitFileChange;
	kind: "file";
}

/** 目录或文件。 */
export type ChangesTreeNode = ChangesTreeFolder | ChangesTreeFile;

/** 展开后的一行。 */
export type ChangesTreeRow =
	| {
			/** 目录行 */
			kind: "folder";
			/** 目录完整路径 */
			path: string;
			/** 显示名 */
			name: string;
			/** 缩进层级，顶层为 0 */
			depth: number;
			/** 当前是否折叠 */
			collapsed: boolean;
	  }
	| {
			/** 文件行 */
			kind: "file";
			/** 文件的改动信息 */
			file: GitFileChange;
			/** 缩进层级，顶层为 0 */
			depth: number;
	  };

interface RawFolder {
	/** 当前目录自己的名字，顶层为空 */
	name: string;
	/** 当前目录完整路径，顶层为空 */
	path: string;
	/** 子目录，按目录名索引 */
	folders: Map<string, RawFolder>;
	/** 当前目录下的文件，按文件名索引 */
	files: Map<string, GitFileChange>;
}

/** 新建一个空目录节点。 */
function createFolder(name: string, path: string): RawFolder {
	return { name, path, folders: new Map(), files: new Map() };
}

/** 按名字排序，文件与目录都用同一规则。 */
function byName(left: { name: string }, right: { name: string }): number {
	return left.name.localeCompare(right.name);
}

/** 把文件路径插进目录节点。 */
function insertFile(root: RawFolder, file: GitFileChange): void {
	const parts = file.path.split("/").filter((part) => part.length > 0);
	if (parts.length === 0) {
		return;
	}
	let folder = root;
	for (let index = 0; index < parts.length - 1; index += 1) {
		const part = parts[index];
		if (part === undefined) {
			continue;
		}
		const path = parts.slice(0, index + 1).join("/");
		let child = folder.folders.get(part);
		if (child === undefined) {
			child = createFolder(part, path);
			folder.folders.set(part, child);
		}
		folder = child;
	}
	const name = parts[parts.length - 1];
	if (name !== undefined) {
		folder.files.set(name, file);
	}
}

/** 从目录节点生成显示用的节点。 */
function collectNodes(folder: RawFolder): ChangesTreeNode[] {
	const nodes: ChangesTreeNode[] = [];
	const folders = [...folder.folders.values()].sort(byName);
	for (const child of folders) {
		const chain = collapseChain(child);
		nodes.push({
			kind: "folder",
			path: chain.folder.path,
			name: chain.name,
			children: collectNodes(chain.folder),
		});
	}
	const files = [...folder.files.values()].sort((left, right) =>
		byName({ name: left.path }, { name: right.path }),
	);
	for (const file of files) {
		nodes.push({ kind: "file", file });
	}
	return nodes;
}

/** 合并没有文件且只有一个子目录的链。 */
function collapseChain(start: RawFolder): { folder: RawFolder; name: string } {
	let folder = start;
	let name = start.name;
	while (folder.files.size === 0 && folder.folders.size === 1) {
		const child = folder.folders.values().next().value;
		if (child === undefined) {
			break;
		}
		folder = child;
		name = `${name}/${child.name}`;
	}
	return { folder, name };
}

/** 把改动文件拼成目录树；目录在前，文件在后。 */
export function buildChangesTree(files: readonly GitFileChange[]): ChangesTreeNode[] {
	const root = createFolder("", "");
	for (const file of files) {
		insertFile(root, file);
	}
	return collectNodes(root);
}

/** 按折叠状态展开成行；折叠的目录只保留目录行。 */
export function flattenChangesTree(
	nodes: readonly ChangesTreeNode[],
	collapsed: ReadonlySet<string>,
	depth = 0,
): ChangesTreeRow[] {
	const rows: ChangesTreeRow[] = [];
	for (const node of nodes) {
		if (node.kind === "file") {
			rows.push({ kind: "file", file: node.file, depth });
			continue;
		}
		const isCollapsed = collapsed.has(node.path);
		rows.push({
			kind: "folder",
			path: node.path,
			name: node.name,
			depth,
			collapsed: isCollapsed,
		});
		if (!isCollapsed) {
			rows.push(...flattenChangesTree(node.children, collapsed, depth + 1));
		}
	}
	return rows;
}
