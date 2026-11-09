/**
 * 侧栏的数据模型。
 *
 * 把会话列表与主机清单整理成展示用的分组与排序，组件只负责渲染。
 * 纯函数，不依赖 React，可单独测。
 */
import type { SessionSummary } from "@facet/protocol";

/** 主机的连接状态。 */
export type HostState = "connected" | "connecting" | "offline";

/** 一条会话在侧栏里的展示数据。 */
export interface SidebarSession {
	/** 会话文件路径，选中时原样回传 */
	path: string;
	/** 标题，会话名为空时取首条消息 */
	title: string;
	/** 最后活动时间，Unix 毫秒 */
	modified: number;
	/** 消息条数 */
	messageCount: number;
	/** 是否正在运行 */
	isRunning: boolean;
	/** 所属项目名，显示在会话标签里 */
	project: string;
	/** 所属主机名，本机为空 */
	host: string | undefined;
	/** 占位数据，接入真实来源前不可选中 */
	isPlaceholder?: boolean;
}

/** 一个工作目录分组。 */
export interface SidebarProject {
	/** 项目目录，作为分组标识 */
	cwd: string;
	/** 项目名，取目录末段 */
	name: string;
	/** 项目下的会话，按修改时间倒序 */
	sessions: readonly SidebarSession[];
	/** 占位数据，接入远端读取前不可交互 */
	isPlaceholder?: boolean;
}

/** 一台主机在侧栏里的展示数据。 */
export interface SidebarHost {
	/** 主机标识 */
	id: string;
	/** 主机名，显示在主机选择按钮上 */
	name: string;
	/** 连接地址，已连接时显示在主机行下方 */
	detail: string;
	/** 连接状态 */
	state: HostState;
	/** 是否为当前设备 */
	isLocal: boolean;
	/** 已测得的往返时延，单位毫秒 */
	latencyMs?: number;
	/** 断开主机的上次连接时间描述 */
	lastSeen?: string;
	/** 该主机上的项目 */
	projects: readonly SidebarProject[];
	/** 占位数据，接入多主机前不可交互 */
	isPlaceholder?: boolean;
}

/** 组装侧栏所需的输入。 */
export interface SidebarInput {
	/** 当前设备的会话列表 */
	sessions: readonly SessionSummary[];
	/** 当前设备之后的全部主机，第一项为本机 */
	hosts: readonly SidebarHost[];
	/** 当前会话的文件路径 */
	activeFile: string | undefined;
	/** 新建会话落在的目录 */
	activeCwd: string;
	/** 正在运行的会话文件路径 */
	runningFile: string | undefined;
}

/** 侧栏的展示数据。 */
export interface SidebarData {
	/** 跨项目的最近会话，按修改时间倒序 */
	recents: readonly SidebarSession[];
	/** 本机的项目分组 */
	projects: readonly SidebarProject[];
	/** 本机之外的主机 */
	remotes: readonly SidebarHost[];
}

/** 取路径末段作名称，末段为空时回退成原值。 */
export function baseName(path: string): string {
	const segments = path.split("/").filter((segment) => segment.length > 0);
	return segments[segments.length - 1] ?? path;
}

/** 会话标题：优先会话名，其次首条消息摘要，都为空时给占位名。 */
export function sessionTitle(name: string | undefined, firstMessage: string): string {
	const trimmed = name?.trim() ?? "";
	if (trimmed.length > 0) {
		return trimmed;
	}
	const first = firstMessage.trim();
	return first.length > 0 ? first.slice(0, 24) : "未命名会话";
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 相对时间的短写法，例：刚刚、8 分钟、3 小时、昨天、周一、11月3日。 */
export function shortTime(value: number, now: number = Date.now()): string {
	const diff = Math.max(0, now - value);
	if (diff < 60_000) {
		return "刚刚";
	}
	if (diff < 3_600_000) {
		return `${Math.floor(diff / 60_000)} 分钟`;
	}
	const date = new Date(value);
	if (date.toDateString() === new Date(now).toDateString()) {
		return `${Math.floor(diff / 3_600_000)} 小时`;
	}
	const yesterday = new Date(now - 86_400_000);
	if (date.toDateString() === yesterday.toDateString()) {
		return "昨天";
	}
	if (diff < 6 * 86_400_000) {
		return WEEKDAYS[date.getDay()] ?? "";
	}
	return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function newestFirst(sessions: readonly SidebarSession[]): SidebarSession[] {
	return [...sessions].sort((left, right) => right.modified - left.modified);
}

/** 一条会话来自某台主机的哪个项目。 */
function toSession(
	summary: SessionSummary,
	runningFile: string | undefined,
	hostName: string | undefined,
): SidebarSession {
	return {
		path: summary.path,
		title: sessionTitle(summary.name, summary.firstMessage),
		modified: summary.modified,
		messageCount: summary.messageCount,
		isRunning: summary.path === runningFile,
		project: baseName(summary.cwd),
		host: hostName,
	};
}

/** 组装侧栏数据：本机项目按目录分组，最近会话跨项目汇总。 */
export function buildSidebar(input: SidebarInput): SidebarData {
	const groups = new Map<string, SidebarSession[]>();
	for (const summary of input.sessions) {
		const entry = toSession(summary, input.runningFile, undefined);
		const bucket = groups.get(summary.cwd);
		if (bucket) {
			bucket.push(entry);
		} else {
			groups.set(summary.cwd, [entry]);
		}
	}
	// 当前目录即使还没有会话也列出来，新建的会话会落在它下面
	if (input.activeCwd.length > 0 && !groups.has(input.activeCwd)) {
		groups.set(input.activeCwd, []);
	}

	const projects: SidebarProject[] = [...groups].map(([cwd, sessions]) => ({
		cwd,
		name: baseName(cwd),
		sessions: newestFirst(sessions),
	}));
	projects.sort((left, right) => {
		if (left.cwd === input.activeCwd) {
			return -1;
		}
		if (right.cwd === input.activeCwd) {
			return 1;
		}
		const leftLatest = left.sessions[0]?.modified ?? 0;
		const rightLatest = right.sessions[0]?.modified ?? 0;
		return rightLatest - leftLatest;
	});

	const remotes = input.hosts.filter((host) => !host.isLocal);
	const recents = [
		...projects.flatMap((project) => project.sessions),
		...remotes.flatMap((host) => host.projects.flatMap((project) => project.sessions)),
	].sort((left, right) => right.modified - left.modified);

	return { recents, projects, remotes };
}

/** 按关键词筛选项目：命中项目名时保留整个项目，否则只留标题命中的会话。 */
export function filterProjects(
	projects: readonly SidebarProject[],
	keyword: string,
): readonly SidebarProject[] {
	const trimmed = keyword.trim().toLowerCase();
	if (trimmed.length === 0) {
		return projects;
	}
	const visible: SidebarProject[] = [];
	for (const project of projects) {
		const nameHit = project.name.toLowerCase().includes(trimmed);
		const sessions = nameHit
			? project.sessions
			: project.sessions.filter((session) => session.title.toLowerCase().includes(trimmed));
		if (nameHit || sessions.length > 0) {
			visible.push({ ...project, sessions });
		}
	}
	return visible;
}
