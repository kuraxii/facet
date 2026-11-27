/**
 * 侧栏的数据模型。
 *
 * 侧栏由项目过滤器与按时间分组的会话队列组成。过滤器决定队列的范围与新建会话的目录，
 * 队列按「进行中 / 今天 / 昨天 / 更早」分组。这里只做纯函数变换，组件负责渲染。
 */

import type { SupportedLanguage } from "@facet/i18n";
import type { ProjectInfo, SessionStatus, SessionSummary } from "@facet/protocol";
import { deriveBucket, type SessionStatusBucket } from "./session-status.ts";

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
	/** 行尾的相对时间文案，分组定下来之后由 buildSidebar 填好 */
	timeText: string;
	/** 是否正在运行，用于「进行中」分组 */
	isRunning: boolean;
	/** 行首状态点，由主机状态与已读水位推出来 */
	bucket: SessionStatusBucket;
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
	/** 各会话此刻的状态，按会话文件路径索引，缺省都按空闲算 */
	statuses?: ReadonlyMap<string, SessionStatus> | undefined;
	/** 队列的范围：给出时只列该目录的会话，缺省列出全部 */
	projectCwd?: string | undefined;
	/** 会话标题关键词，空串表示不过滤 */
	keyword?: string | undefined;
	/** 当前时间，缺省取系统时间 */
	now?: number;
	/** 没有标题时的占位名 */
	untitled?: string;
	/** 相对时间用哪种语言，缺省英文 */
	locale?: SupportedLanguage;
	/**
	 * 上一帧「进行中」组的会话路径，按当时显示的顺序。
	 *
	 * 运行中的会话每轮结束都会刷新摘要时间，照着时间排会让几条同时在跑的会话互相挤；
	 * 给出这份记忆后，运行期间只按进入先后排：新开跑的排在组首，已经在跑的位置不动。
	 */
	runningOrder?: readonly string[] | undefined;
}

/**
 * 会话搜索：标题匹配关键词，最近改动的在前，最多返回 `limit` 条。
 *
 * 队列的过滤与搜索是两件事，搜索浮窗单独用这个函数取一份结果，不参与侧栏分组。
 */
export function searchSessions(input: SidebarInput & { limit?: number }): SidebarSession[] {
	const groups = buildSidebar(input).groups;
	const flat = groups.flatMap((group) => group.sessions);
	return input.limit === undefined ? flat : flat.slice(0, input.limit);
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
	running: "Running",
	today: "Today",
	yesterday: "Yesterday",
	earlier: "Earlier",
};

/** 取路径末段作名称（兼容 `/` 与 `\`），末段为空时回退成原值。 */
export function baseName(path: string): string {
	const segments = path.split(/[/\\]/).filter((segment) => segment.length > 0);
	return segments[segments.length - 1] ?? path;
}

/** 目录的比较键，忽略末尾斜杠（兼容 `/` 与 `\`）。 */
function pathKey(path: string): string {
	return path.replace(/[/\\]+$/, "");
}

/** 两个目录是否指向同一处,忽略末尾斜杠。 */
export function samePath(left: string, right: string): boolean {
	return pathKey(left) === pathKey(right);
}

/** 首条消息生成的标题上限；显示宽度交给 CSS 省略，不在数据层按窄列表硬截断。 */
const MAX_TITLE_LENGTH = 50;

/** 去掉截断后残留的标点，避免标题以顿号或冒号结尾。 */
function trimTitlePunctuation(text: string): string {
	return text.replace(/[、，,：:；;]+$/u, "").trim();
}

/** 会话标题：优先会话名，其次首条消息摘要，都为空时给占位名。 */
export function sessionTitle(
	name: string | undefined,
	firstMessage: string,
	untitled = "Untitled session",
): string {
	const trimmed = name?.trim() ?? "";
	if (trimmed.length > 0) {
		return trimmed;
	}
	const first = firstMessage.trim();
	if (first.length === 0) {
		return untitled;
	}
	return trimTitlePunctuation(first.length > MAX_TITLE_LENGTH ? first.slice(0, MAX_TITLE_LENGTH) : first);
}

/** 昨天分组里的时间用具体时刻，便于区分不同时段。 */
function clockTime(date: Date): string {
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * 相对时间的短写法。
 *
 * 今天用相对时长，昨天用 HH:mm，更早用星期或日期；默认不带分组，保持旧行为。
 */
/**
 * 按 locale 与选项缓存 formatter。
 *
 * 侧栏每行每帧都要算一次时间，`new Intl.DateTimeFormat` 是整个调用里最贵的一步；
 * 同一台机器上 locale 与选项就那么几种，缓存之后它退化成一次查表。
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: SupportedLanguage, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale}:${JSON.stringify(options)}`;
	const cached = dateFormatters.get(key);
	if (cached !== undefined) {
		return cached;
	}
	const created = new Intl.DateTimeFormat(locale, options);
	dateFormatters.set(key, created);
	return created;
}

export function shortTime(
	value: number,
	now: number = Date.now(),
	group?: GroupKey,
	locale: SupportedLanguage = "en",
): string {
	const date = new Date(value);
	if (group === "yesterday") {
		return clockTime(date);
	}
	const diff = Math.max(0, now - value);
	const isChinese = locale === "zh-CN";
	if (diff < 60_000) {
		return isChinese ? "刚刚" : "now";
	}
	if (diff < 3_600_000) {
		const minutes = Math.floor(diff / 60_000);
		return isChinese ? `${minutes} 分钟` : `${minutes}m`;
	}
	if (date.toDateString() === new Date(now).toDateString()) {
		const hours = Math.floor(diff / 3_600_000);
		return isChinese ? `${hours} 小时` : `${hours}h`;
	}
	const yesterday = new Date(now - 86_400_000);
	if (date.toDateString() === yesterday.toDateString()) {
		return isChinese ? "昨天" : "Yesterday";
	}
	if (diff < 6 * 86_400_000) {
		return dateFormatter(locale, { weekday: "short" }).format(date);
	}
	return dateFormatter(locale, { month: "short", day: "numeric" }).format(date);
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

/** 清单里没有的会话按空闲算，与主机给的默认一致。 */
const IDLE_STATUS: SessionStatus = { activity: "idle", settle: undefined, pendingInput: 0, seenAt: 0 };

/**
 * 一条会话的展示数据。
 *
 * 状态只看主机推来的那一份：同一台主机上的会话可能有别的端在跑，本地只知道当前打开的
 * 那一个，按本地算会让切走之后的状态失真。
 */
function toSession(
	summary: SessionSummary,
	statuses: ReadonlyMap<string, SessionStatus> | undefined,
	untitled: string | undefined,
): SidebarSession {
	const status = statuses?.get(summary.path) ?? IDLE_STATUS;
	const bucket = deriveBucket(status);
	return {
		path: summary.path,
		title: sessionTitle(summary.name, summary.firstMessage, untitled),
		modified: summary.modified,
		timeText: "",
		// 等输入也算在跑：那一轮还没结束，只是卡在人身上
		isRunning: bucket === "running" || bucket === "needs_input",
		bucket,
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
			name: project.name !== undefined ? baseName(project.name) : baseName(project.cwd),
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
 * 把运行中的会话按记忆顺序提到前面。
 *
 * 会话在组里的位置只由「谁先开始跑」决定：记不住的新面孔排在组首，记得住的按上一帧的
 * 顺序跟着，于是摘要时间再怎么刷，已经在跑的几行都不会互相挤。非运行中的会话保持原顺序，
 * 落到日期组里仍然是时间倒序。
 */
function orderRunning(
	sessions: readonly SidebarSession[],
	runningOrder: readonly string[] | undefined,
): SidebarSession[] {
	if (runningOrder === undefined || runningOrder.length === 0) {
		return [...sessions];
	}
	const rank = new Map(runningOrder.map((path, index) => [path, index]));
	const running: SidebarSession[] = [];
	const rest: SidebarSession[] = [];
	for (const session of sessions) {
		if (session.isRunning) {
			running.push(session);
		} else {
			rest.push(session);
		}
	}
	if (running.length < 2) {
		return [...sessions];
	}
	const fresh: SidebarSession[] = [];
	const known: SidebarSession[] = [];
	for (const session of running) {
		if (rank.has(session.path)) {
			known.push(session);
		} else {
			fresh.push(session);
		}
	}
	known.sort((left, right) => (rank.get(left.path) ?? 0) - (rank.get(right.path) ?? 0));
	return [...fresh, ...known, ...rest];
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
		.map((summary) => toSession(summary, input.statuses, input.untitled))
		.sort((left, right) => right.modified - left.modified);

	const inScope =
		input.projectCwd === undefined
			? all
			: all.filter((session) => samePath(session.cwd, input.projectCwd as string));
	const matched =
		keyword.length === 0
			? inScope
			: inScope.filter((session) => session.title.toLowerCase().includes(keyword));

	const groups = groupSessions(orderRunning(matched, input.runningOrder), now).map((group) => ({
		...group,
		// 时间文案只取决于分组与分钟，放在这里算一次，行渲染不再各自调一遍
		sessions: group.sessions.map((session) => ({
			...session,
			timeText: shortTime(session.modified, now, group.key, input.locale ?? "en"),
		})),
	}));

	return {
		groups,
		projects: listProjects(input.projects, input.sessions),
		total: all.length,
	};
}
