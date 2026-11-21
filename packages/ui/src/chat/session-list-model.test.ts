/**
 * 侧栏列表推导的纯函数。
 *
 * 范围解析、项目过滤、标题、按标识找项目/会话、以及「进行中」组的顺序保持——都不碰 React
 * 也不碰 DOM。
 */
import { describe, expect, it } from "vitest";
import {
	filterProjects,
	findSession,
	projectById,
	projectOf,
	resolveScopeCwd,
	runningOrderOf,
	scopeLabel,
} from "./session-list-model.ts";
import type { SidebarGroup, SidebarProject, SidebarSession } from "./sidebar-model.ts";

/** 一个项目。 */
function project(id: string, cwd: string, name: string): SidebarProject {
	return { id, cwd, name, host: undefined, sessionCount: 0 };
}

/** 一条会话。 */
function session(path: string, cwd: string): SidebarSession {
	return {
		path,
		title: path,
		modified: 0,
		timeText: "",
		isRunning: false,
		bucket: "done",
		project: cwd,
		cwd,
		host: undefined,
	};
}

const PROJECTS = [project("p1", "/work/app", "App"), project("p2", "/work/lib", "Lib")] as const;

describe("过滤器范围", () => {
	it("选过目录就听用户的", () => {
		expect(resolveScopeCwd({ showsAll: false, pickedCwd: "/a", activeCwd: "/b" })).toBe("/a");
	});

	it("没选过就跟着当前会话", () => {
		expect(resolveScopeCwd({ showsAll: false, pickedCwd: undefined, activeCwd: "/b" })).toBe("/b");
	});

	it("切到全部项目时不过滤", () => {
		expect(resolveScopeCwd({ showsAll: true, pickedCwd: "/a", activeCwd: "/b" })).toBeUndefined();
	});
});

describe("按关键字筛项目", () => {
	it("空关键字给全部", () => {
		expect(filterProjects(PROJECTS, "  ")).toHaveLength(2);
	});

	it("名字或目录命中都算", () => {
		expect(filterProjects(PROJECTS, "app").map((item) => item.id)).toEqual(["p1"]);
		expect(filterProjects(PROJECTS, "work/lib").map((item) => item.id)).toEqual(["p2"]);
		expect(filterProjects(PROJECTS, "不存在的")).toEqual([]);
	});
});

describe("范围标题", () => {
	it("目录有对应项目时用项目名", () => {
		expect(scopeLabel(PROJECTS, "/work/app", "全部项目")).toBe("App");
	});

	it("目录没登记过时用末段", () => {
		expect(scopeLabel(PROJECTS, "/tmp/other", "全部项目")).toBe("other");
	});

	it("不过滤时用「全部项目」", () => {
		expect(scopeLabel(PROJECTS, undefined, "全部项目")).toBe("全部项目");
	});
});

describe("按标识找东西", () => {
	it("按目录找项目", () => {
		expect(projectOf(PROJECTS, "/work/lib")?.id).toBe("p2");
		expect(projectOf(PROJECTS, undefined)).toBeUndefined();
		expect(projectOf(PROJECTS, "/nope")).toBeUndefined();
	});

	it("按标识找项目", () => {
		expect(projectById(PROJECTS, "p1")?.name).toBe("App");
		expect(projectById(PROJECTS, undefined)).toBeUndefined();
	});

	it("跨分组找会话", () => {
		const groups: SidebarGroup[] = [
			{ key: "today", label: "今天", sessions: [session("/s/1", "/work/app")] },
			{ key: "earlier", label: "更早", sessions: [session("/s/2", "/work/lib")] },
		];
		expect(findSession(groups, "/s/2")?.cwd).toBe("/work/lib");
		expect(findSession(groups, "/s/3")).toBeUndefined();
		expect(findSession(groups, undefined)).toBeUndefined();
	});
});

describe("「进行中」组的顺序", () => {
	it("取出正在跑的会话顺序", () => {
		const groups: SidebarGroup[] = [
			{ key: "running", label: "进行中", sessions: [session("/s/1", "/w"), session("/s/2", "/w")] },
			{ key: "today", label: "今天", sessions: [session("/s/3", "/w")] },
		];
		expect(runningOrderOf(groups)).toEqual(["/s/1", "/s/2"]);
	});

	it("没有进行中的组时给空", () => {
		expect(runningOrderOf([{ key: "today", label: "今天", sessions: [] }])).toEqual([]);
	});
});
