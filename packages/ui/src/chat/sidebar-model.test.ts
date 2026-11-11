import type { SessionSummary } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import {
	baseName,
	buildSidebar,
	groupSessions,
	type SidebarHost,
	type SidebarSession,
	samePath,
	sessionTitle,
	shortTime,
} from "./sidebar-model.ts";

const NOW = new Date(2024, 10, 6, 15, 0, 0).getTime();

function summary(overrides: Partial<SessionSummary> & Pick<SessionSummary, "id" | "path">): SessionSummary {
	return {
		cwd: "/work/facet",
		name: undefined,
		parentSessionPath: undefined,
		created: 0,
		modified: NOW - 60_000,
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

/** 相对今天零点前移若干天的时间戳，小时取本地时区。 */
function dayBefore(days: number, hour = 10): number {
	const date = new Date(NOW);
	date.setDate(date.getDate() - days);
	date.setHours(hour, 0, 0, 0);
	return date.getTime();
}

function session(overrides: Partial<SidebarSession> & Pick<SidebarSession, "path">): SidebarSession {
	return {
		title: "会话",
		modified: NOW - 60_000,
		messageCount: 1,
		isRunning: false,
		dot: "idle",
		project: "facet",
		cwd: "/work/facet",
		host: undefined,
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
	it("按距离分档", () => {
		expect(shortTime(NOW - 30_000, NOW)).toBe("刚刚");
		expect(shortTime(NOW - 8 * 60_000, NOW)).toBe("8 分钟");
		expect(shortTime(NOW - 3 * 3_600_000, NOW)).toBe("3 小时");
		expect(shortTime(NOW - 30 * 3_600_000, NOW)).toBe("昨天");
		expect(shortTime(NOW - 2 * 86_400_000, NOW)).toBe("周一");
		expect(shortTime(new Date(2024, 9, 3).getTime(), NOW)).toBe("10月3日");
	});
});

describe("队列分组", () => {
	it("按进行中、今天、昨天、更早分组，并按时间倒序", () => {
		const groups = groupSessions(
			[
				session({ path: "/s/old.jsonl", modified: dayBefore(9) }),
				session({ path: "/s/run.jsonl", isRunning: true, modified: dayBefore(3) }),
				session({ path: "/s/today-a.jsonl", modified: NOW - 60_000 }),
				session({ path: "/s/yesterday.jsonl", modified: dayBefore(1) }),
				session({ path: "/s/today-b.jsonl", modified: NOW - 3_600_000 }),
			],
			NOW,
		);
		expect(groups.map((group) => group.key)).toEqual(["running", "today", "yesterday", "earlier"]);
		expect(groups.map((group) => group.label)).toEqual(["进行中", "今天", "昨天", "更早"]);
		expect(groups[1]?.sessions.map((item) => item.path)).toEqual(["/s/today-a.jsonl", "/s/today-b.jsonl"]);
	});

	it("空组不出现", () => {
		const groups = groupSessions([session({ path: "/s/today.jsonl" })], NOW);
		expect(groups.map((group) => group.key)).toEqual(["today"]);
	});
});

describe("组装侧栏", () => {
	const sessions = [
		summary({
			id: "a",
			path: "/s/a.jsonl",
			cwd: "/work/facet",
			modified: NOW - 60_000,
			name: "压测脚本调整",
		}),
		summary({
			id: "b",
			path: "/s/b.jsonl",
			cwd: "/work/facet",
			modified: NOW - 3_600_000,
			firstMessage: "修复重连缺口",
		}),
		summary({ id: "c", path: "/s/c.jsonl", cwd: "/work/linx-icp", modified: dayBefore(1) }),
		summary({ id: "d", path: "/s/d.jsonl", cwd: "/work/linx-icp", modified: dayBefore(9) }),
	];

	const base = {
		sessions,
		projects: [],
		runningFile: "/s/a.jsonl",
		now: NOW,
	};

	it("运行中的会话单独成组并带运行状态点", () => {
		const data = buildSidebar({ ...base, hosts: [] });
		expect(data.groups[0]?.sessions.map((item) => item.path)).toEqual(["/s/a.jsonl"]);
		expect(data.groups[0]?.sessions[0]?.dot).toBe("running");
		expect(data.groups[0]?.sessions[0]?.isRunning).toBe(true);
		expect(data.groups[1]?.sessions[0]?.dot).toBe("idle");
	});

	it("项目选项合并已添加的项目与会话目录，按会话数倒序", () => {
		const data = buildSidebar({
			...base,
			hosts: [],
			projects: [
				{ id: "p1", cwd: "/work/facet/", name: "facet 主仓", createdAt: 1 },
				{ id: "p2", cwd: "/work/docs-site", name: undefined, createdAt: 2 },
			],
		});
		expect(data.projects.map((project) => [project.name, project.sessionCount])).toEqual([
			["facet 主仓", 2],
			["linx-icp", 2],
			["docs-site", 0],
		]);
	});

	it("限定项目时只列该目录的会话，项目选项数字按全部会话统计", () => {
		const data = buildSidebar({ ...base, hosts: [], projectCwd: "/work/facet/" });
		expect(data.total).toBe(4);
		expect(data.groups.flatMap((group) => group.sessions).map((item) => item.path)).toEqual([
			"/s/a.jsonl",
			"/s/b.jsonl",
		]);
		expect(data.projects.map((project) => project.sessionCount)).toEqual([2, 2]);
	});

	it("关键词过滤会话标题", () => {
		const data = buildSidebar({ ...base, hosts: [], keyword: "重连" });
		expect(data.groups.flatMap((group) => group.sessions).map((item) => item.path)).toEqual(["/s/b.jsonl"]);
	});

	it("设备条按全部会话统计，未知数量留空", () => {
		const data = buildSidebar({
			...base,
			hosts: [
				host({ id: "local", name: "facet", isLocal: true }),
				host({
					id: "dev-box",
					name: "dev-box",
					projects: [{ cwd: "/srv/gateway", name: "gateway", host: "dev-box", sessionCount: 3 }],
				}),
				host({ id: "staging", name: "staging", state: "connecting" }),
			],
		});
		expect(data.devices.map((device) => [device.id, device.sessionCount])).toEqual([
			["local", 4],
			["dev-box", 3],
			["staging", undefined],
		]);
		expect(data.devices[0]?.isLocal).toBe(true);
	});
});

describe("状态点", () => {
	const summary = (path: string): SessionSummary => ({
		id: path,
		path,
		cwd: "/work/a",
		name: undefined,
		parentSessionPath: undefined,
		created: 1,
		modified: 2,
		messageCount: 1,
		firstMessage: "你好",
	});

	it("只有当前会话带运行态,其余按空闲", () => {
		const data = buildSidebar({
			sessions: [summary("/s1.jsonl"), summary("/s2.jsonl")],
			hosts: [{ id: "h", name: "本机", detail: "", state: "connected", isLocal: true, projects: [] }],
			projects: [],
			runningFile: "/s1.jsonl",
			runningDot: "compacting",
		});
		const dots = data.groups.flatMap((group) => group.sessions).map((session) => [session.path, session.dot]);
		expect(dots).toEqual([
			["/s1.jsonl", "compacting"],
			["/s2.jsonl", "idle"],
		]);
	});

	it("没给状态点时按运行中显示", () => {
		const data = buildSidebar({
			sessions: [summary("/s1.jsonl")],
			hosts: [],
			projects: [],
			runningFile: "/s1.jsonl",
		});
		expect(data.groups[0]?.sessions[0]?.dot).toBe("running");
	});
});
