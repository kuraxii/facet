/**
 * 会话侧栏的列表推导。
 *
 * 侧栏里凡是「只跟数据有关」的判断都放这里：项目过滤器的范围与标题、按关键字筛项目、
 * 菜单指向的那一条、以及「进行中」分组在两次渲染之间保持的顺序。全是纯函数，脱离 React
 * 就能断言——组件那边只负责把它们拼起来。
 */
import {
	baseName,
	type SidebarGroup,
	type SidebarProject,
	type SidebarSession,
	samePath,
} from "./sidebar-model.ts";

/** 过滤器此刻的范围：选过的目录、全部项目，或者跟随当前会话。 */
export interface SidebarScopeInput {
	/** 过滤器是否切到全部项目 */
	showsAll: boolean;
	/** 用户在过滤器里选过的目录 */
	pickedCwd: string | undefined;
	/** 当前会话所在的目录 */
	activeCwd: string | undefined;
}

/**
 * 解出这一刻的范围目录。
 *
 * 用户选过就听用户的；没选过就跟着当前会话走（切会话时列表自动跟过去）。`undefined` 表示
 * 不过滤、全部项目。
 */
export function resolveScopeCwd(input: SidebarScopeInput): string | undefined {
	if (input.showsAll) {
		return undefined;
	}
	return input.pickedCwd ?? input.activeCwd;
}

/** 按关键字筛项目：名字或目录包含它即命中，空关键字返回全部。 */
export function filterProjects(
	projects: readonly SidebarProject[],
	keyword: string,
): readonly SidebarProject[] {
	const query = keyword.trim().toLowerCase();
	if (query.length === 0) {
		return projects;
	}
	return projects.filter(
		(project) => project.name.toLowerCase().includes(query) || project.cwd.toLowerCase().includes(query),
	);
}

/**
 * 过滤器按钮上那一行标题。
 *
 * 选中的目录正好是一个已知项目时用项目名，否则用目录末段；不过滤时用「全部项目」的文案。
 */
export function scopeLabel(
	projects: readonly SidebarProject[],
	scopeCwd: string | undefined,
	allProjectsLabel: string,
): string {
	if (scopeCwd === undefined) {
		return allProjectsLabel;
	}
	return projectOf(projects, scopeCwd)?.name ?? baseName(scopeCwd);
}

/** 按目录找项目；目录对不上时为空。 */
export function projectOf(
	projects: readonly SidebarProject[],
	cwd: string | undefined,
): SidebarProject | undefined {
	if (cwd === undefined) {
		return undefined;
	}
	return projects.find((project) => samePath(project.cwd, cwd));
}

/** 按标识找项目。 */
export function projectById(
	projects: readonly SidebarProject[],
	id: string | undefined,
): SidebarProject | undefined {
	if (id === undefined) {
		return undefined;
	}
	return projects.find((project) => project.id === id);
}

/** 按会话文件路径在分组里找那一条。 */
export function findSession(
	groups: readonly SidebarGroup[],
	path: string | undefined,
): SidebarSession | undefined {
	if (path === undefined) {
		return undefined;
	}
	for (const group of groups) {
		const found = group.sessions.find((session) => session.path === path);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

/**
 * 下一帧「进行中」组的顺序。
 *
 * 几条会话同时在跑时，按上一帧的顺序排，谁先跑起来就一直在前头——直接按时间排会让它们每
 * 一次刷新互相挤。同样的输入算两遍结果相同，重复渲染不会错位。
 */
export function runningOrderOf(groups: readonly SidebarGroup[]): readonly string[] {
	return groups.find((group) => group.key === "running")?.sessions.map((session) => session.path) ?? [];
}
