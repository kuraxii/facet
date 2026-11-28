/**
 * Task Inbox 的 Settle 归档与远端离线快照持久化。
 *
 * 复用 `appStorage` 落盘到 `<FACET_HOME>/config/desktop.json`，不依赖渲染进程裸缓存，
 * 后续若 Host 协议原生支持 `settled` 元数据可直接平替。
 */

import type { SessionSummary } from "@facet/protocol";
import { baseName, type CachedOfflineTask, type SessionKey, sessionKeyOf, sessionTitle } from "@facet/ui";
import type { ScopedStorage } from "./local-storage.ts";

const SETTLED_KEY = "facet.inbox.settled";
const OFFLINE_CACHE_KEY = "facet.inbox.offline";

/** 读出已归档映射：`SessionKey -> settledAt(ms)`。 */
export function readSettledMap(storage: ScopedStorage): Record<string, number> {
	const raw = storage.getItem(SETTLED_KEY);
	if (raw === null) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return {};
		}
		const result: Record<string, number> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "number" && Number.isFinite(value)) {
				result[key] = value;
			}
		}
		return result;
	} catch {
		return {};
	}
}

/** 写回已归档映射。 */
export function writeSettledMap(storage: ScopedStorage, settled: Readonly<Record<string, number>>): void {
	storage.setItem(SETTLED_KEY, JSON.stringify(settled));
}

/** 读出远端断线前保留的未解决任务快照。 */
export function readOfflineCache(storage: ScopedStorage): Record<string, CachedOfflineTask> {
	const raw = storage.getItem(OFFLINE_CACHE_KEY);
	if (raw === null) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return {};
		}
		const result: Record<string, CachedOfflineTask> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value !== "object" || value === null) {
				continue;
			}
			const item = value as Partial<CachedOfflineTask>;
			if (
				typeof item.endpoint === "string" &&
				typeof item.file === "string" &&
				typeof item.hostLabel === "string" &&
				typeof item.title === "string" &&
				typeof item.updatedAt === "number"
			) {
				result[key] = {
					key: (item.key as SessionKey) ?? sessionKeyOf(item.endpoint, item.file),
					endpoint: item.endpoint,
					file: item.file,
					hostLabel: item.hostLabel,
					projectName: typeof item.projectName === "string" ? item.projectName : "",
					cwd: typeof item.cwd === "string" ? item.cwd : "",
					title: item.title,
					agentId: typeof item.agentId === "string" ? item.agentId : "pi",
					updatedAt: item.updatedAt,
				};
			}
		}
		return result;
	} catch {
		return {};
	}
}

/** 写回离线任务快照。 */
export function writeOfflineCache(
	storage: ScopedStorage,
	cache: Readonly<Record<string, CachedOfflineTask>>,
): void {
	storage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(cache));
}

/** 显式断开或移除主机时清理该端点的离线任务快照。 */
export function purgeOfflineEndpoint(
	cache: Readonly<Record<string, CachedOfflineTask>>,
	endpoint: string,
): Record<string, CachedOfflineTask> {
	const next: Record<string, CachedOfflineTask> = {};
	for (const [key, value] of Object.entries(cache)) {
		if (value.endpoint !== endpoint) {
			next[key] = value;
		}
	}
	return next;
}

/** 远端主机在线时刷新其活跃任务快照，供意外断线时保留显示。 */
export function syncOfflineEndpoint(
	cache: Readonly<Record<string, CachedOfflineTask>>,
	input: {
		endpoint: string;
		hostLabel: string;
		sessions: readonly SessionSummary[];
		settled: Readonly<Record<string, number>>;
		untitled: string;
		isScratchCwd?: (cwd: string) => boolean;
	},
): Record<string, CachedOfflineTask> {
	const next = purgeOfflineEndpoint(cache, input.endpoint);
	for (const summary of input.sessions) {
		if (summary.firstMessage.trim().length === 0 && (summary.name?.trim().length ?? 0) === 0) {
			continue;
		}
		const key = sessionKeyOf(input.endpoint, summary.path);
		if (input.settled[key] !== undefined) {
			continue;
		}
		const isScratch = input.isScratchCwd?.(summary.cwd) === true;
		next[key] = {
			key,
			endpoint: input.endpoint,
			file: summary.path,
			hostLabel: input.hostLabel,
			projectName: !isScratch && summary.cwd.length > 0 ? baseName(summary.cwd) || summary.cwd : "",
			cwd: summary.cwd,
			title: sessionTitle(summary.name, summary.firstMessage, input.untitled),
			agentId: summary.agentId ?? "pi",
			updatedAt: summary.modified,
		};
	}
	return next;
}
