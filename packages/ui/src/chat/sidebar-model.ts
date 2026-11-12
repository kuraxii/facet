/**
 * 侧栏的数据模型。
 *
 * 侧栏由项目过滤器与按时间分组的会话队列组成。过滤器决定队列的范围与新建会话的目录，
 * 队列按「进行中 / 今天 / 昨天 / 更早」分组。这里只做纯函数变换，组件负责渲染。
 */
import type { ProjectInfo, SessionSummary } from "@facet/protocol";

/**
 * 会话行左侧的状态点。
 *
 * 设计稿上的完成与未读两态需要主机侧的未读标记与待应答信息，当前有运行、压缩与空闲三态，
 * 取值确定后才加入新值。
 */
export type SessionDot = "running" | "compacting" | "idle";

/** 队列分组的键，数组顺序即展示顺序。 */
export type GroupKey = "running" | "today" | "yesterday" | "earlier";

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
	/** 行首状态点 */
	dot: SessionDot;
	/** 所属项目名，队列过滤到单个项目时不重复显示 */
	project: string;
	/** 所属项目目录 */
	cwd: string;
	/** 所属主机名，本机为空 */
	host: string | undefined;
	/** 占位数据，接入真实来源前不可选中 */
	isPlaceholder?: boolean;
}

/** 队列里的一组会话。 */
export interface SidebarGroup {
	key: GroupKey;
	/** 组标题 */
	label: string;
	/** 组内会话，按修改时间倒序 */
	sessions: readonly SidebarSession[];
}

/** 项目下拉里的一项。 */
export interface SidebarProject {
	/** 用户添加的项目标识；只在会话目录里出现、没有添加过的目录为空 */
	id?: string;
	/** 项目目录，作为标识 */
	cwd: string;
	/** 项目名，用户设置过时用设置值，否则取目录末段 */
	name: string;
	/** 所属主机名，本机为空 */
	host: string | undefined;
	/** 该项目下的会话数 */
	sessionCount: number;
	/** 占位数据，接入远端读取前不可交互 */
	isPlaceholder?: boolean;
}

/** 组装侧栏所需的输入。 */
export interface SidebarInput {
	/** 当前主机的会话列表 */
	sessions: readonly SessionSummary[];
	/** 用户添加的项目 */
	projects: readonly ProjectInfo[];
	/** 正在运行的会话文件路径 */
	runningFile: string | undefined;
	/** 这个会话此刻的状态点，缺省按运行中显示 */
	runningDot?: SessionDot | undefined;
	/** 队列的范围：给出时只列该目录的会话，缺省列出全部 */
	projectCwd?: string | undefined;
	/** 会话标题关键词，空串表示不过滤 */
	keyword?: string | undefined;
	/** 当前时间，缺省取系统时间 */
	now?: number;
}

/** 侧栏的展示数据。 */
export interface SidebarData {
	/** 队列分组，空组不出现 */
	groups: readonly SidebarGroup[];
	/** 项目下拉的选项，按会话数倒序 */
	projects: readonly SidebarProject[];
	/** 全部会话数，供「全部项目」选项展示 */
	total: number;
}

/** 分组顺序与标题。 */
const GROUP_ORDER: readonly GroupKey[] = ["running", "today", "yesterday", "earlier"];
const GROUP_LABELS: Record<GroupKey, string> = {
	running: "进行中",
	today: "今天",
	yesterday: "昨天",
	earlier: "更早",
};

/** 取路径末段作名称，末段为空时回退成原值。 */
export function baseName(path: string): string {
	const segments = path.split("/").filter((segment) => segment.length > 0);
	return segments[segments.length - 1] ?? path;
}

/** 目录的比较键，忽略末尾斜杠。 */
function pathKey(path: string): string {
	return path.replace(/\/+$/, "");
}

/** 两个目录是否指向同一处,忽略末尾斜杠。 */
export function samePath(left: string, right: string): boolean {
	return pathKey(left) === pathKey(right);
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

/** 本地时区当天零点的时间戳，分组边界按本地日期划分。 */
function startOfDay(now: number): number {
	const date = new Date(now);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

/** 相对某天零点平移若干天，跨月由日期运算处理。 */
function shiftDay(dayStart: number, days: number): number {
	const date = new Date(dayStart);
	date.setDate(date.getDate() + days);
	return date.getTime();
}

/**
 * 一条会话的展示数据。
 *
 * 只有当前打开的会话才有运行态:主机上的会话只有被打开时才可能跑一轮,其余都按空闲显示。
 */
function toSession(
	summary: SessionSummary,
	runningFile: string | undefined,
	phase: SessionDot | undefined,
): SidebarSession {
	const isRunning = summary.path === runningFile;
	return {
		path: summary.path,
		title: sessionTitle(summary.name, summary.firstMessage),
		modified: summary.modified,
		messageCount: summary.messageCount,
		isRunning,
		dot: isRunning ? (phase ?? "running") : "idle",
		project: baseName(summary.cwd),
		cwd: summary.cwd,
		host: undefined,
	};
}

/** 按时间分组。运行中的会话单独成组，其余按本地日期落进今天、昨天、更早。 */
export function groupSessions(sessions: readonly SidebarSession[], now: number): SidebarGroup[] {
	const today = startOfDay(now);
	const yesterday = shiftDay(today, -1);
	const buckets: Record<GroupKey, SidebarSession[]> = {
		running: [],
		today: [],
		yesterday: [],
		earlier: [],
	};
	for (const session of sessions) {
		if (session.isRunning) {
			buckets.running.push(session);
		} else if (session.modified >= today) {
			buckets.today.push(session);
		} else if (session.modified >= yesterday) {
			buckets.yesterday.push(session);
		} else {
			buckets.earlier.push(session);
		}
	}
	const groups: SidebarGroup[] = [];
	for (const key of GROUP_ORDER) {
		const items = buckets[key];
		if (items.length === 0) {
			continue;
		}
		groups.push({ key, label: GROUP_LABELS[key], sessions: items });
	}
	return groups;
}

/**
 * 项目下拉的选项。
 *
 * 用户添加的项目排在前面，会话目录里出现但没添加过的目录补在后面，这样启动目录里的
 * 历史会话不必先添加就能过滤到。
 */
function listProjects(added: readonly ProjectInfo[], sessions: readonly SessionSummary[]): SidebarProject[] {
	const counts = new Map<string, { cwd: string; count: number }>();
	for (const session of sessions) {
		const key = pathKey(session.cwd);
		const entry = counts.get(key);
		if (entry) {
			entry.count += 1;
		} else {
			counts.set(key, { cwd: session.cwd, count: 1 });
		}
	}

	const options: SidebarProject[] = [];
	const claimed = new Set<string>();
	for (const project of added) {
		const key = pathKey(project.cwd);
		claimed.add(key);
		options.push({
			id: project.id,
			cwd: project.cwd,
			name: project.name ?? baseName(project.cwd),
			host: undefined,
			sessionCount: counts.get(key)?.count ?? 0,
		});
	}
	for (const [key, entry] of counts) {
		if (claimed.has(key)) {
			continue;
		}
		options.push({
			cwd: entry.cwd,
			name: baseName(entry.cwd),
			host: undefined,
			sessionCount: entry.count,
		});
	}

	return options.sort((left, right) => {
		if (right.sessionCount !== left.sessionCount) {
			return right.sessionCount - left.sessionCount;
		}
		return left.name.localeCompare(right.name);
	});
}

/**
 * 组装侧栏数据。
 *
 * 先按项目范围与关键词筛出一份会话，再分组；项目选项与主机条始终按全部会话统计，
 * 切换范围时下拉里的数字不会跟着变小。
 */
export function buildSidebar(input: SidebarInput): SidebarData {
	const now = input.now ?? Date.now();
	const keyword = (input.keyword ?? "").trim().toLowerCase();
	const all = input.sessions
		.map((summary) => toSession(summary, input.runningFile, input.runningDot))
		.sort((left, right) => right.modified - left.modified);

	const inScope =
		input.projectCwd === undefined
			? all
			: all.filter((session) => samePath(session.cwd, input.projectCwd as string));
	const matched =
		keyword.length === 0
			? inScope
			: inScope.filter((session) => session.title.toLowerCase().includes(keyword));

	return {
		groups: groupSessions(matched, now),
		projects: listProjects(input.projects, input.sessions),
		total: all.length,
	};
}
