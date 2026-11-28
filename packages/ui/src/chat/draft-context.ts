/**
 * 新建会话引导页的上下文记忆与最近组合（纯逻辑，不依赖 React 或 DOM）。
 *
 * 按主机端点记住上次使用的项目目录、Agent 与模型参数，并在引导页顶部提供最多 3 条
 * 最近上下文快捷入口，切主机或重启后仍可一键恢复。
 */
import type { ThinkingLevel } from "@facet/protocol";

const DRAFT_CONTEXT_KEY = "facet.draftContext.v1";
const RECENT_LIMIT = 3;

/** 单台主机记住的新建会话参数。 */
export interface DraftContextMemory {
	/** 项目目录（空串或未设表示未关联项目） */
	cwd?: string;
	/** Agent 标识 */
	agentId?: string;
	/** Pi 模型提供方 */
	modelProvider?: string;
	/** Pi 模型标识 */
	modelId?: string;
	/** Pi 思考档位 */
	thinkingLevel?: ThinkingLevel;
}

/** 引导页快捷恢复的最近上下文条目。 */
export interface RecentDraftContext {
	/** 目标主机端点 */
	endpoint: string;
	/** 目标主机展示名 */
	hostLabel: string;
	/** 项目目录（缺省表示无项目） */
	cwd?: string;
	/** Agent 标识 */
	agentId: string;
	/** 最近使用时间（Unix 毫秒） */
	updatedAt: number;
}

/** 持久化的新建会话上下文仓库。 */
export interface DraftContextStore {
	/** 各端点最后一次选择的上下文 */
	byEndpoint: Record<string, DraftContextMemory>;
	/** 最近使用过的上下文组合（最多 3 条） */
	recent: RecentDraftContext[];
}

/** 最小存储契约。 */
export interface DraftContextStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** 从本地存储读取新建上下文仓库，损坏时回退为空白仓库。 */
export function readDraftContextStore(storage: DraftContextStorage): DraftContextStore {
	try {
		const raw = storage.getItem(DRAFT_CONTEXT_KEY);
		if (raw === null) {
			return { byEndpoint: {}, recent: [] };
		}
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) {
			return { byEndpoint: {}, recent: [] };
		}
		const obj = parsed as { byEndpoint?: unknown; recent?: unknown };
		const byEndpoint: Record<string, DraftContextMemory> = {};
		if (typeof obj.byEndpoint === "object" && obj.byEndpoint !== null) {
			for (const [k, v] of Object.entries(obj.byEndpoint as Record<string, unknown>)) {
				if (typeof v === "object" && v !== null) {
					byEndpoint[k] = { ...(v as DraftContextMemory) };
				}
			}
		}
		const recent: RecentDraftContext[] = Array.isArray(obj.recent)
			? obj.recent.filter(
					(item): item is RecentDraftContext =>
						typeof item === "object" &&
						item !== null &&
						typeof (item as RecentDraftContext).endpoint === "string" &&
						typeof (item as RecentDraftContext).hostLabel === "string" &&
						typeof (item as RecentDraftContext).agentId === "string" &&
						typeof (item as RecentDraftContext).updatedAt === "number",
				)
			: [];
		return { byEndpoint, recent: recent.slice(0, RECENT_LIMIT) };
	} catch {
		return { byEndpoint: {}, recent: [] };
	}
}

/** 将新建上下文仓库落盘。 */
export function writeDraftContextStore(storage: DraftContextStorage, store: DraftContextStore): void {
	storage.setItem(DRAFT_CONTEXT_KEY, JSON.stringify(store));
}

/** 更新某台主机的记住参数（返回新对象）。 */
export function updateEndpointDraftMemory(
	store: DraftContextStore,
	endpoint: string,
	patch: Partial<DraftContextMemory>,
): DraftContextStore {
	const current = store.byEndpoint[endpoint] ?? {};
	const nextEntry: DraftContextMemory = { ...current, ...patch };
	return {
		...store,
		byEndpoint: {
			...store.byEndpoint,
			[endpoint]: nextEntry,
		},
	};
}

/** 将本次实际发起或选定的上下文压入最近列表，按 `(endpoint, cwd, agentId)` 去重并保留 3 条。 */
export function pushRecentDraftContext(
	store: DraftContextStore,
	item: RecentDraftContext,
): DraftContextStore {
	const normalizedCwd = item.cwd ?? "";
	const deduped = store.recent.filter(
		(entry) =>
			!(
				entry.endpoint === item.endpoint &&
				(entry.cwd ?? "") === normalizedCwd &&
				entry.agentId === item.agentId
			),
	);
	return {
		...store,
		recent: [item, ...deduped].slice(0, RECENT_LIMIT),
	};
}
