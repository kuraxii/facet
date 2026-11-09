import type { SessionProject } from "@facet/agent";
import { describe, expect, it } from "vitest";
import { ProjectCatalog, type ProjectSource } from "./project-catalog.ts";

function project(cwd: string, lastUsed: number): SessionProject {
	return { id: `id:${cwd}`, cwd, sessionCount: 1, lastUsed };
}

/** 记录调用次数、可控制返回内容的来源。 */
function createSource(results: SessionProject[][]) {
	let calls = 0;
	const source: ProjectSource = {
		async scanProjects() {
			const result = results[Math.min(calls, results.length - 1)] ?? [];
			calls += 1;
			return result;
		},
	};
	return {
		source,
		get calls() {
			return calls;
		},
	};
}

describe("项目清单", () => {
	it("刷新后按最近使用倒序", async () => {
		const { source } = createSource([[project("/a", 100), project("/b", 300), project("/c", 200)]]);
		const catalog = new ProjectCatalog(source);
		const list = await catalog.refresh();
		expect(list.map((item) => item.cwd)).toEqual(["/b", "/c", "/a"]);
		expect(catalog.get("id:/c")?.cwd).toBe("/c");
	});

	it("再次刷新整体替换", async () => {
		const { source } = createSource([[project("/a", 100)], [project("/b", 200)]]);
		const catalog = new ProjectCatalog(source);
		await catalog.refresh();
		await catalog.refresh();
		expect(catalog.list().map((item) => item.cwd)).toEqual(["/b"]);
		expect(catalog.get("id:/a")).toBeUndefined();
	});

	it("并发刷新共用一次扫描", async () => {
		const created = createSource([[project("/a", 100)]]);
		const catalog = new ProjectCatalog(created.source);
		await Promise.all([catalog.refresh(), catalog.refresh()]);
		expect(created.calls).toBe(1);
	});

	it("刷新失败不丢已有清单", async () => {
		let calls = 0;
		const source: ProjectSource = {
			async scanProjects() {
				calls += 1;
				if (calls > 1) {
					throw new Error("读不了");
				}
				return [project("/a", 100)];
			},
		};
		const catalog = new ProjectCatalog(source);
		await catalog.refresh();
		await expect(catalog.refresh()).rejects.toThrow("读不了");
		expect(catalog.list().map((item) => item.cwd)).toEqual(["/a"]);
	});
});
