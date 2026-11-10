import type { SessionSummary } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import {
	baseName,
	buildSidebar,
	filterProjects,
	type SidebarHost,
	samePath,
	sessionTitle,
	shortTime,
} from "./sidebar-model.ts";

function summary(overrides: Partial<SessionSummary> & Pick<SessionSummary, "id" | "path">): SessionSummary {
	return {
		cwd: "/work/facet",
		name: undefined,
		parentSessionPath: undefined,
		created: 0,
		modified: 1_700_000_000_000,
		messageCount: 3,
		firstMessage: "",
		...overrides,
	};
}

function host(overrides: Partial<SidebarHost> & Pick<SidebarHost, "id" | "name">): SidebarHost {
	return {
		detail: "",
		state: "connected",
		isLocal: false,
		projects: [],
		...overrides,
	};
}

describe("路径与标题", () => {
	it("取路径末段", () => {
		expect(baseName("/work/facet")).toBe("facet");
		expect(baseName("/work/facet/")).toBe("facet");
		expect(baseName("facet")).toBe("facet");
	});

	it("末尾斜杠不影响目录比较", () => {
		expect(samePath("/work/facet/", "/work/facet")).toBe(true);
		expect(samePath("/work/facet", "/work/linx-icp")).toBe(false);
	});

	it("标题回退顺序为会话名、首条消息、占位名", () => {
		expect(sessionTitle("  压测脚本调整 ", "首条消息")).toBe("压测脚本调整");
		expect(sessionTitle(undefined, "  修一下限流策略  ")).toBe("修一下限流策略");
		expect(sessionTitle(undefined, "   ")).toBe("未命名会话");
	});
});

describe("相对时间", () => {
	const now = new Date(2024, 10, 6, 15, 0, 0).getTime();

	it("按距离分档", () => {
		expect(shortTime(now - 30_000, now)).toBe("刚刚");
		expect(shortTime(now - 8 * 60_000, now)).toBe("8 分钟");
		expect(shortTime(now - 3 * 3_600_000, now)).toBe("3 小时");
		expect(shortTime(now - 30 * 3_600_000, now)).toBe("昨天");
		expect(shortTime(now - 2 * 86_400_000, now)).toBe("周一");
		expect(shortTime(new Date(2024, 9, 3).getTime(), now)).toBe("10月3日");
	});
});

describe("组装侧栏", () => {
	const sessions = [
		summary({ id: "a", path: "/s/a.jsonl", cwd: "/work/facet", modified: 300, name: "压测脚本调整" }),
		summary({ id: "b", path: "/s/b.jsonl", cwd: "/work/facet", modified: 100, firstMessage: "重构审批流程" }),
		summary({ id: "c", path: "/s/c.jsonl", cwd: "/work/linx-icp", modified: 200 }),
	];

	it("会话按目录归到项目下", () => {
		const data = buildSidebar({
			sessions,
			hosts: [host({ id: "local", name: "facet", isLocal: true })],
			projects: [
				{ id: "p1", cwd: "/work/facet", name: undefined, createdAt: 1 },
				{ id: "p2", cwd: "/work/linx-icp", name: "icp 项目", createdAt: 2 },
			],
			activeFile: "/s/a.jsonl",
			runningFile: "/s/a.jsonl",
		});
		expect(data.projects.map((project) => project.name)).toEqual(["facet", "icp 项目"]);
		expect(data.projects[0]?.sessions.map((session) => session.title)).toEqual([
			"压测脚本调整",
			"重构审批流程",
		]);
		expect(data.projects[0]?.sessions[0]?.isRunning).toBe(true);
		expect(data.recents.map((session) => session.path)).toEqual(["/s/a.jsonl", "/s/c.jsonl", "/s/b.jsonl"]);
		expect(data.remotes).toEqual([]);
	});

	it("未添加过的会话目录也成组，排在已添加项目之后", () => {
		const data = buildSidebar({
			sessions,
			hosts: [],
			projects: [{ id: "p1", cwd: "/work/docs-site", name: undefined, createdAt: 1 }],
			activeFile: undefined,
			runningFile: undefined,
		});
		expect(data.projects.map((project) => project.cwd)).toEqual([
			"/work/docs-site",
			"/work/facet",
			"/work/linx-icp",
		]);
		expect(data.projects[0]?.sessions).toEqual([]);
		expect(data.projects[1]?.sessions.map((session) => session.path)).toEqual(["/s/a.jsonl", "/s/b.jsonl"]);
		expect(data.recents).toHaveLength(3);
	});

	it("项目清单为空时启动目录的会话照样成组", () => {
		const data = buildSidebar({
			sessions,
			hosts: [],
			projects: [],
			activeFile: "/s/c.jsonl",
			runningFile: undefined,
		});
		expect(data.projects.map((project) => project.name)).toEqual(["facet", "linx-icp"]);
		expect(data.projects[1]?.sessions.map((session) => session.path)).toEqual(["/s/c.jsonl"]);
		expect(data.recents.map((session) => session.path)).toEqual(["/s/a.jsonl", "/s/c.jsonl", "/s/b.jsonl"]);
	});

	it("同一目录既已添加又有会话时只成一组", () => {
		const data = buildSidebar({
			sessions,
			hosts: [],
			projects: [{ id: "p1", cwd: "/work/facet/", name: "facet 主仓", createdAt: 1 }],
			activeFile: undefined,
			runningFile: undefined,
		});
		expect(data.projects.map((project) => project.name)).toEqual(["facet 主仓", "linx-icp"]);
		expect(data.projects[0]?.sessions).toHaveLength(2);
	});

	it("最近会话包含远端主机的会话，带主机名", () => {
		const remote = host({
			id: "dev-box",
			name: "dev-box",
			projects: [
				{
					cwd: "/srv/gateway",
					name: "gateway",
					sessions: [
						{
							path: "placeholder://gateway",
							title: "限流策略评审",
							modified: 400,
							messageCount: 12,
							isRunning: false,
							project: "gateway",
							host: "dev-box",
							isPlaceholder: true,
						},
					],
				},
			],
		});
		const data = buildSidebar({
			sessions,
			hosts: [host({ id: "local", name: "facet", isLocal: true }), remote],
			projects: [],
			activeFile: undefined,
			runningFile: undefined,
		});
		expect(data.remotes.map((item) => item.id)).toEqual(["dev-box"]);
		expect(data.recents[0]?.host).toBe("dev-box");
	});
});

describe("搜索", () => {
	const projects = [
		{
			cwd: "/work/facet",
			name: "facet",
			sessions: [
				{
					path: "/s/a.jsonl",
					title: "修复重连缺口",
					modified: 300,
					messageCount: 1,
					isRunning: false,
					project: "facet",
					host: undefined,
				},
			],
		},
		{
			cwd: "/work/linx-icp",
			name: "linx-icp",
			sessions: [
				{
					path: "/s/b.jsonl",
					title: "压测脚本调整",
					modified: 200,
					messageCount: 1,
					isRunning: false,
					project: "linx-icp",
					host: undefined,
				},
			],
		},
	];

	it("命中项目名保留整个项目", () => {
		expect(filterProjects(projects, "IC P".replace(" ", "")).map((project) => project.name)).toEqual([
			"linx-icp",
		]);
	});

	it("只命中会话标题时保留命中的会话", () => {
		const visible = filterProjects(projects, "重连");
		expect(visible).toHaveLength(1);
		expect(visible[0]?.sessions.map((session) => session.title)).toEqual(["修复重连缺口"]);
	});

	it("关键词为空时原样返回", () => {
		expect(filterProjects(projects, "   ")).toBe(projects);
	});
});
