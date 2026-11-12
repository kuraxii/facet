/**
 * 文件浏览的测试。
 *
 * 覆盖目录排序与忽略、路径逃逸（`..`、绝对路径、符号链接）、二进制与超限，以及 revision。
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAccessError, listDirectory, readTextFile } from "./files.ts";

const roots: string[] = [];

/** 建一个临时项目目录。 */
async function createProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "facet-files-"));
	roots.push(root);
	return root;
}

/** 断言抛出的错误码。 */
async function expectCode(work: Promise<unknown>, code: string): Promise<void> {
	await expect(work).rejects.toBeInstanceOf(FileAccessError);
	await expect(work).rejects.toMatchObject({ code });
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("listDirectory", () => {
	it("目录在前、文件在后，忽略 node_modules 与 .git", async () => {
		const root = await createProject();
		await mkdir(join(root, "src"));
		await mkdir(join(root, "node_modules"));
		await mkdir(join(root, ".git"));
		await writeFile(join(root, "README.md"), "说明\n", "utf8");
		await writeFile(join(root, "src", "app.ts"), "export {};\n", "utf8");

		const entries = await listDirectory(root, "");
		expect(entries.map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
			"directory:src",
			"file:README.md",
		]);
	});

	it("子目录的路径相对项目根", async () => {
		const root = await createProject();
		await mkdir(join(root, "src", "ui"), { recursive: true });
		await writeFile(join(root, "src", "ui", "a.tsx"), "x\n", "utf8");
		const entries = await listDirectory(root, "src/ui");
		expect(entries).toEqual([{ name: "a.tsx", path: "src/ui/a.tsx", kind: "file" }]);
	});

	it("拒绝跳出项目的相对路径", async () => {
		const root = await createProject();
		await expectCode(listDirectory(root, ".."), "outside_project");
	});

	it("拒绝绝对路径", async () => {
		const root = await createProject();
		await expectCode(listDirectory(root, "/etc"), "outside_project");
	});

	it("指向项目外的符号链接不进列表，指进来的可以", async () => {
		const root = await createProject();
		const outside = await createProject();
		await writeFile(join(outside, "secret.txt"), "秘密\n", "utf8");
		await writeFile(join(root, "inside.txt"), "内部\n", "utf8");
		await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
		await symlink(join(root, "inside.txt"), join(root, "alias.txt"));

		const entries = await listDirectory(root, "");
		expect(entries.map((entry) => entry.name)).toEqual(["alias.txt", "inside.txt"]);
	});

	it("不是目录时报错", async () => {
		const root = await createProject();
		await writeFile(join(root, "a.txt"), "x\n", "utf8");
		await expectCode(listDirectory(root, "a.txt"), "not_a_directory");
	});
});

describe("readTextFile", () => {
	it("读出内容、大小与 revision", async () => {
		const root = await createProject();
		await writeFile(join(root, "a.txt"), "第一行\n第二行\n", "utf8");
		const content = await readTextFile(root, "a.txt");
		expect(content.kind).toBe("text");
		if (content.kind !== "text") {
			return;
		}
		expect(content.content).toBe("第一行\n第二行\n");
		expect(content.size).toBe(Buffer.byteLength("第一行\n第二行\n"));
		expect(content.revision).toMatch(/^[0-9a-f]{40}$/);
	});

	it("内容变了 revision 也变", async () => {
		const root = await createProject();
		await writeFile(join(root, "a.txt"), "一\n", "utf8");
		const first = await readTextFile(root, "a.txt");
		await writeFile(join(root, "a.txt"), "二\n", "utf8");
		const second = await readTextFile(root, "a.txt");
		expect(first.kind === "text" && second.kind === "text" && first.revision !== second.revision).toBe(true);
	});

	it("含 NUL 的文件按二进制处理", async () => {
		const root = await createProject();
		await writeFile(join(root, "blob.bin"), Buffer.from([1, 0, 2]));
		expect(await readTextFile(root, "blob.bin")).toMatchObject({ kind: "binary", size: 3 });
	});

	it("超过上限的文件只给大小", async () => {
		const root = await createProject();
		await writeFile(join(root, "big.txt"), Buffer.alloc(1024 * 1024 + 1, 97));
		expect(await readTextFile(root, "big.txt")).toMatchObject({ kind: "tooLarge" });
	});

	it("不是文件时报错", async () => {
		const root = await createProject();
		await mkdir(join(root, "src"));
		await expectCode(readTextFile(root, "src"), "not_a_file");
	});

	it("不存在时报错", async () => {
		const root = await createProject();
		await expectCode(readTextFile(root, "nope.txt"), "file_not_found");
	});

	it("拒绝跳出项目的路径", async () => {
		const root = await createProject();
		await expectCode(readTextFile(root, "../outside.txt"), "outside_project");
	});
});
