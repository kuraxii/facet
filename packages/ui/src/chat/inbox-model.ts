/**
 * 跨主机 Task Inbox 与手动 Settle 归档的纯数据模型。
 *
 * 把多台主机各自的会话摘要、项目列表、实时运行态，与桌面端记录的 Settle 归档表及
 * 离线缓存合并成两个扁平列表：活跃任务卡（`active`）与已归档单行（`settled`）。
 */

import type { SupportedLanguage } from "@facet/i18n";
import type { ProjectInfo, SessionStatus, SessionSummary } from "@facet/protocol";
import { deriveBucket, type SessionStatusBucket } from "./session-status.ts";
import { baseName, sessionTitle, shortTime } from "./sidebar-model.ts";

/** 联合会话键：`<endpoint>::<file>`。 */
export type SessionKey = `${string}::${string}`;

/** 构造联合会话键。 */
export function sessionKeyOf(endpoint: string, file: string): SessionKey {
	return `${endpoint}::${file}`;
}

/** 任务的关注状态（仅靠样式点与动效表达）。 */
export type TaskAttentionState = "needs_approval" | "running" | "unread" | "idle";

/** 单台主机贡献给 Inbox 的实时数据源。 */
export interface HostSessionFeed {
	/** 主机端点 */
	endpoint: string;
	/** 展示名（本机为 `This computer`） */
	hostLabel: string;
	/** 是否为本机 */
	isLocal: boolean;
	/** 当前主机是否在线就绪 */
	isOnline: boolean;
	/** 该主机的会话清单 */
	sessions: readonly SessionSummary[];
	/** 该主机上的项目清单 */
	projects: readonly ProjectInfo[];
	/** 该主机各会话的实时状态 */
	statuses: ReadonlyMap<string, SessionStatus>;
}

/** 远端主机意外断线时保留在本地的未解决任务快照。 */
export interface CachedOfflineTask {
	key: SessionKey;
	endpoint: string;
	file: string;
	hostLabel: string;
	projectName: string;
	cwd: string;
	title: string;
	agentId: string;
	updatedAt: number;
}

/** Task Inbox 里的 3 行活跃任务卡片。 */
export interface SidebarTaskCard {
	key: SessionKey;
	endpoint: string;
	file: string;
	hostLabel: string;
	isLocal: boolean;
	hostOnline: boolean;
	/** 仅目录末段名（如 `facet`），无项目时为空串 */
	projectName: string;
	/** 2 字符项目缩写徽标，如 `FA` */
	projectMonogram: string;
	cwd: string;
	title: string;
	agentId: string;
	attention: TaskAttentionState;
	/** 原版会话行状态分档（用于渲染 SessionStatusMark） */
	bucket: SessionStatusBucket;
	updatedAt: number;
	timeText: string;
}

/** Settled 抽屉里的单行已归档项。 */
export interface SidebarSettledItem {
	key: SessionKey;
	endpoint: string;
	file: string;
	hostLabel: string;
	isLocal: boolean;
	hostOnline: boolean;
	projectName: string;
	projectMonogram: string;
	cwd: string;
	title: string;
	agentId: string;
	settledAt: number;
	timeText: string;
}

/** `buildInbox` 的入参。 */
export interface InboxBuildInput {
	feeds: readonly HostSessionFeed[];
	/** 已归档记录：`SessionKey -> settledAt(ms)` */
	settled: Readonly<Record<string, number>>;
	/** 离线主机保留的活跃任务快照 */
	offlineCache?: readonly CachedOfflineTask[];
	/** 占位标题 */
	untitled?: string;
	/** 语言 */
	locale?: SupportedLanguage;
	/** 当前时间，Unix 毫秒 */
	now?: number;
	/** 用于判定无项目归类：属于 scratch 目录的 cwd 视为无项目 */
	isScratchCwd?: (cwd: string) => boolean;
}

/** `buildInbox` 产出的侧栏数据。 */
export interface InboxData {
	active: readonly SidebarTaskCard[];
	settled: readonly SidebarSettledItem[];
}

/** 项目徽标可用的配色分档数量。 */
export const PROJECT_BADGE_TONE_COUNT = 5;

/** 由项目名映射稳定的项目徽标配色分档（`0` 到 `PROJECT_BADGE_TONE_COUNT - 1`）。 */
export function projectBadgeTone(projectName: string): number {
	let hash = 2166136261;
	for (let i = 0; i < projectName.length; i += 1) {
		hash ^= projectName.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % PROJECT_BADGE_TONE_COUNT;
}

/** 从目录名或项目名提炼 2 字符缩写徽标（纯大写 ASCII 或首字符）。 */
export function projectMonogram(projectName: string): string {
	const cleaned = projectName.trim();
	if (cleaned.length === 0) {
		return "--";
	}
	const parts = cleaned.split(/[-_.\s]+/).filter((p) => p.length > 0);
	if (parts.length >= 2) {
		const first = parts[0]?.[0] ?? "";
		const second = parts[1]?.[0] ?? "";
		return `${first}${second}`.toUpperCase();
	}
	return cleaned.slice(0, 2).toUpperCase();
}

/** 将底层会话状态归并成 Inbox 关注等级。 */
export function deriveAttention(status: SessionStatus | undefined): TaskAttentionState {
	if (status === undefined) {
		return "idle";
	}
	const bucket = deriveBucket(status);
	if (bucket === "needs_input" || bucket === "failed") {
		return "needs_approval";
	}
	if (bucket === "running") {
		return "running";
	}
	if (bucket === "attention") {
		return "unread";
	}
	return "idle";
}

function isEmptyIdle(summary: SessionSummary, attention: TaskAttentionState): boolean {
	if (summary.firstMessage.trim().length > 0 || (summary.name?.trim().length ?? 0) > 0) {
		return false;
	}
	return attention === "idle";
}

/** 从目录路径抽出项目显示名（仅末段目录名），scratch 目录返回空串。 */
function resolveProjectName(cwd: string, isScratchCwd?: (cwd: string) => boolean): string {
	if (cwd.length === 0 || isScratchCwd?.(cwd) === true) {
		return "";
	}
	return baseName(cwd) || cwd;
}

/** 聚合多台主机实时流与离线缓存，生成活跃卡片与已归档列表。 */
export function buildInbox(input: InboxBuildInput): InboxData {
	const now = input.now ?? Date.now();
	const locale = input.locale ?? "en";
	const active: SidebarTaskCard[] = [];
	const settled: SidebarSettledItem[] = [];
	const seenKeys = new Set<SessionKey>();

	for (const feed of input.feeds) {
		for (const summary of feed.sessions) {
			const status = feed.statuses.get(summary.path);
			const bucket: SessionStatusBucket =
				feed.isOnline && status !== undefined ? deriveBucket(status) : "done";
			const attention = deriveAttention(status);
			if (isEmptyIdle(summary, attention)) {
				continue;
			}
			const key = sessionKeyOf(feed.endpoint, summary.path);
			seenKeys.add(key);
			const projectName = resolveProjectName(summary.cwd, input.isScratchCwd);
			const monogram = projectMonogram(projectName);
			const title = sessionTitle(summary.name, summary.firstMessage, input.untitled);
			const agentId = summary.agentId ?? "pi";
			const settledAt = input.settled[key];
			if (settledAt !== undefined) {
				settled.push({
					key,
					endpoint: feed.endpoint,
					file: summary.path,
					hostLabel: feed.hostLabel,
					isLocal: feed.isLocal,
					hostOnline: feed.isOnline,
					projectName,
					projectMonogram: monogram,
					cwd: summary.cwd,
					title,
					agentId,
					settledAt,
					timeText: shortTime(settledAt, now, settledAt >= now - 86_400_000 ? "today" : "earlier", locale),
				});
				continue;
			}
			active.push({
				key,
				endpoint: feed.endpoint,
				file: summary.path,
				hostLabel: feed.hostLabel,
				isLocal: feed.isLocal,
				hostOnline: feed.isOnline,
				projectName,
				projectMonogram: monogram,
				cwd: summary.cwd,
				title,
				agentId,
				attention,
				bucket,
				updatedAt: summary.modified,
				timeText: shortTime(
					summary.modified,
					now,
					attention === "running" || attention === "needs_approval" ? "running" : "today",
					locale,
				),
			});
		}
	}

	// 在线列表里没出现的（例如远端短暂掉线）从离线缓存补全，已显式归档的落在 Settled
	const liveOnlineEndpoints = new Set(input.feeds.filter((f) => f.isOnline).map((f) => f.endpoint));
	for (const cached of input.offlineCache ?? []) {
		if (seenKeys.has(cached.key) || liveOnlineEndpoints.has(cached.endpoint)) {
			continue;
		}
		const monogram = projectMonogram(cached.projectName);
		const settledAt = input.settled[cached.key];
		if (settledAt !== undefined) {
			settled.push({
				key: cached.key,
				endpoint: cached.endpoint,
				file: cached.file,
				hostLabel: cached.hostLabel,
				isLocal: false,
				hostOnline: false,
				projectName: cached.projectName,
				projectMonogram: monogram,
				cwd: cached.cwd,
				title: cached.title,
				agentId: cached.agentId,
				settledAt,
				timeText: shortTime(settledAt, now, "earlier", locale),
			});
			continue;
		}
		active.push({
			key: cached.key,
			endpoint: cached.endpoint,
			file: cached.file,
			hostLabel: cached.hostLabel,
			isLocal: false,
			hostOnline: false,
			projectName: cached.projectName,
			projectMonogram: monogram,
			cwd: cached.cwd,
			title: cached.title,
			agentId: cached.agentId,
			attention: "idle",
			bucket: "done",
			updatedAt: cached.updatedAt,
			timeText: shortTime(cached.updatedAt, now, "earlier", locale),
		});
	}

	active.sort((left, right) => right.updatedAt - left.updatedAt);
	settled.sort((left, right) => right.settledAt - left.settledAt);

	return { active, settled };
}

/** 跨主机全局搜索条目（同时覆盖活跃卡片与已归档会话）。 */
export interface InboxSearchEntry {
	/** 联合标识 */
	key: SessionKey;
	/** 所属主机端点 */
	endpoint: string;
	/** 会话文件路径 */
	file: string;
	/** 主机展示名 */
	hostLabel: string;
	/** 所属项目名（无项目时为空串） */
	projectName: string;
	/** 项目双字母徽标 */
	projectMonogram: string;
	/** 关联目录 */
	cwd?: string;
	/** 标题 */
	title: string;
	/** 关注状态（settled 条目固定为 idle） */
	attention: TaskAttentionState;
	/** 原版会话行状态分档（settled 条目固定为 done） */
	bucket: SessionStatusBucket;
	/** 是否已归档 */
	settled: boolean;
	/** 相对时间文案 */
	timeText: string;
	/** 排序时间戳 */
	updatedAt: number;
}

/** 提取出现在活跃或归档任务中的去重项目列表（供搜索浮窗过滤）。 */
export function collectInboxProjects(
	activeCards: readonly SidebarTaskCard[],
	settledItems: readonly SidebarSettledItem[],
): Array<{ projectName: string; projectMonogram: string }> {
	const seen = new Map<string, string>();
	for (const card of activeCards) {
		if (card.projectName.length > 0 && !seen.has(card.projectName)) {
			seen.set(card.projectName, card.projectMonogram);
		}
	}
	for (const item of settledItems) {
		if (item.projectName.length > 0 && !seen.has(item.projectName)) {
			seen.set(item.projectName, item.projectMonogram);
		}
	}
	return [...seen.entries()]
		.map(([projectName, projectMonogram]) => ({ projectName, projectMonogram }))
		.sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export interface InboxSearchInput {
	/** 当前活跃卡片 */
	activeCards: readonly SidebarTaskCard[];
	/** 已归档列表 */
	settledItems: readonly SidebarSettledItem[];
	/** 关键词 */
	keyword: string;
	/** 指定项目名过滤（未传表示全部项目） */
	projectFilter?: string | undefined;
	/** 结果数量上限 */
	limit: number;
}

/** 按关键词与可选项目过滤全部主机下的活跃与已归档任务。 */
export function searchInboxEntries({
	activeCards,
	settledItems,
	keyword,
	projectFilter,
	limit,
}: InboxSearchInput): InboxSearchEntry[] {
	const query = keyword.trim().toLowerCase();
	const matches = (title: string, projectName: string, hostLabel: string): boolean => {
		if (projectFilter !== undefined && projectName !== projectFilter) {
			return false;
		}
		if (query.length === 0) {
			return true;
		}
		return (
			title.toLowerCase().includes(query) ||
			projectName.toLowerCase().includes(query) ||
			hostLabel.toLowerCase().includes(query)
		);
	};

	const results: InboxSearchEntry[] = [];
	for (const card of activeCards) {
		if (!matches(card.title, card.projectName, card.hostLabel)) {
			continue;
		}
		results.push({
			key: card.key,
			endpoint: card.endpoint,
			file: card.file,
			hostLabel: card.hostLabel,
			projectName: card.projectName,
			projectMonogram: card.projectMonogram,
			cwd: card.cwd,
			title: card.title,
			attention: card.attention,
			bucket: card.hostOnline ? card.bucket : "done",
			settled: false,
			timeText: card.timeText,
			updatedAt: card.updatedAt,
		});
		if (results.length >= limit) {
			return results;
		}
	}
	for (const item of settledItems) {
		if (!matches(item.title, item.projectName, item.hostLabel)) {
			continue;
		}
		results.push({
			key: item.key,
			endpoint: item.endpoint,
			file: item.file,
			hostLabel: item.hostLabel,
			projectName: item.projectName,
			projectMonogram: item.projectMonogram,
			cwd: item.cwd,
			title: item.title,
			attention: "idle",
			bucket: "done",
			settled: true,
			timeText: item.timeText,
			updatedAt: item.settledAt,
		});
		if (results.length >= limit) {
			return results;
		}
	}
	return results;
}
