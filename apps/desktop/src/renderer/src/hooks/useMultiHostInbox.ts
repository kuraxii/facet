/**
 * 跨主机 Task Inbox 聚合与手动 Settle 控制器。
 *
 * 监听 `HostRuntimeRegistry` 中所有主机的会话流与项目表（不限于当前活跃目标主机），
 * 合并 `SettleStore` 与远端离线快照，产出左侧栏所需的 `activeCards` 与 `settledItems`。
 */
import type { ProjectInfo, SessionStatus, SessionSummary } from "@facet/protocol";
import {
	buildInbox,
	type CachedOfflineTask,
	type HostSessionFeed,
	type SidebarSettledItem,
	type SidebarTaskCard,
	useI18n,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LOCAL_TARGET } from "../host-connection.ts";
import type { HostRuntime } from "../host-runtime.ts";
import {
	purgeOfflineEndpoint,
	readOfflineCache,
	readSettledMap,
	syncOfflineEndpoint,
	writeOfflineCache,
	writeSettledMap,
} from "../inbox-store.ts";
import { appStorage } from "../local-storage.ts";
import type { SessionKey } from "../session-target.ts";
import type { Hosts } from "./useHosts.ts";

export interface MultiHostInbox {
	/** 活跃任务卡片（跨主机平铺） */
	activeCards: readonly SidebarTaskCard[];
	/** 已手动归档条目 */
	settledItems: readonly SidebarSettledItem[];
	/** 全部已连主机的实时 feed（供搜索跨主机检索） */
	feeds: readonly HostSessionFeed[];
	/** 缓存的离线任务快照 */
	offlineTasks: readonly CachedOfflineTask[];
	/** 手动归档指定任务 */
	settle: (key: SessionKey) => void;
	/** 从归档中恢复 */
	reopen: (key: SessionKey) => void;
	/** 指定任务是否已归档 */
	isSettled: (key: SessionKey) => boolean;
	/** 显式断开或移除远程主机时清除其离线缓存 */
	clearEndpointOffline: (endpoint: string) => void;
}

function statusesOf(runtime: HostRuntime): ReadonlyMap<string, SessionStatus> {
	return new Map(runtime.client.store.sessionList().map((entry) => [entry.summary.path, entry.status]));
}

export function useMultiHostInbox(hosts: Hosts): MultiHostInbox {
	const { t, i18n } = useI18n();
	const [settled, setSettled] = useState<Record<string, number>>(() => readSettledMap(appStorage));
	const [offlineCache, setOfflineCache] = useState<Record<string, CachedOfflineTask>>(() =>
		readOfflineCache(appStorage),
	);
	const [tick, setTick] = useState(0);
	const projectsRef = useRef(new Map<string, readonly ProjectInfo[]>());
	const fetchedEpochRef = useRef(new Map<string, number>());

	// 订阅全部存活的 HostRuntime 的会话 Store，并在主机每次连上就绪时拉取一次完整列表
	useEffect(() => {
		void hosts.registryVersion;
		const unsubs: Array<() => void> = [];
		for (const runtime of hosts.registry.all()) {
			const snap = runtime.getSnapshot();
			if (snap.phase === "ready" && fetchedEpochRef.current.get(runtime.endpoint) !== snap.connectEpoch) {
				fetchedEpochRef.current.set(runtime.endpoint, snap.connectEpoch);
				void Promise.all([
					runtime.client.refreshSessionList().catch(() => undefined),
					runtime.client
						.listProjects()
						.then((list) => {
							projectsRef.current.set(runtime.endpoint, list);
						})
						.catch(() => undefined),
				]).finally(() => setTick((c) => c + 1));
			}
			unsubs.push(
				runtime.client.store.subscribe(() => {
					setTick((c) => c + 1);
				}),
			);
		}
		return () => {
			for (const unsub of unsubs) {
				unsub();
			}
		};
	}, [hosts.registry, hosts.registryVersion]);

	const hostNameMap = useMemo(() => {
		const map = new Map<string, string>();
		map.set(LOCAL_TARGET, t("app.localHost"));
		for (const item of hosts.hostList.hosts) {
			map.set(item.endpoint, item.name);
		}
		return map;
	}, [hosts.hostList.hosts, t]);

	// 远程在线主机的未解决任务增量同步进离线快照，供意外断线时保留展示
	useEffect(() => {
		void tick;
		void hosts.registryVersion;
		let nextCache = offlineCache;
		let changed = false;
		for (const runtime of hosts.registry.all()) {
			if (runtime.isLocal) {
				continue;
			}
			const snap = runtime.getSnapshot();
			if (snap.phase !== "ready" || snap.link.status !== "ready") {
				continue;
			}
			const sessions: readonly SessionSummary[] = runtime.client.store
				.sessionList()
				.map((entry) => entry.summary);
			const hostLabel = hostNameMap.get(runtime.endpoint) ?? runtime.endpoint;
			const updated = syncOfflineEndpoint(nextCache, {
				endpoint: runtime.endpoint,
				hostLabel,
				sessions,
				settled,
				untitled: t("sidebar.untitled"),
			});
			if (JSON.stringify(updated) !== JSON.stringify(nextCache)) {
				nextCache = updated;
				changed = true;
			}
		}
		if (changed) {
			setOfflineCache(nextCache);
			writeOfflineCache(appStorage, nextCache);
		}
	}, [hostNameMap, hosts.registry, hosts.registryVersion, offlineCache, settled, t, tick]);

	const feeds = useMemo<readonly HostSessionFeed[]>(() => {
		void tick;
		void hosts.registryVersion;
		return hosts.registry.all().map((runtime) => {
			const snap = runtime.getSnapshot();
			return {
				endpoint: runtime.endpoint,
				hostLabel: hostNameMap.get(runtime.endpoint) ?? runtime.endpoint,
				isLocal: runtime.isLocal,
				isOnline: snap.phase === "ready" && snap.link.status === "ready",
				sessions: runtime.client.store.sessionList().map((entry) => entry.summary),
				projects: projectsRef.current.get(runtime.endpoint) ?? [],
				statuses: statusesOf(runtime),
			};
		});
	}, [hostNameMap, hosts.registry, hosts.registryVersion, tick]);

	const offlineTasks = useMemo(() => Object.values(offlineCache), [offlineCache]);

	const inbox = useMemo(
		() =>
			buildInbox({
				feeds,
				settled,
				offlineCache: offlineTasks,
				untitled: t("sidebar.untitled"),
				locale: i18n.language as "en" | "zh-CN",
			}),
		[feeds, i18n.language, offlineTasks, settled, t],
	);

	const settle = useCallback((key: SessionKey) => {
		setSettled((current) => {
			const next = { ...current, [key]: Date.now() };
			writeSettledMap(appStorage, next);
			return next;
		});
	}, []);

	const reopen = useCallback((key: SessionKey) => {
		setSettled((current) => {
			if (current[key] === undefined) {
				return current;
			}
			const next = { ...current };
			delete next[key];
			writeSettledMap(appStorage, next);
			return next;
		});
	}, []);

	const isSettled = useCallback((key: SessionKey) => settled[key] !== undefined, [settled]);

	const clearEndpointOffline = useCallback((endpoint: string) => {
		setOfflineCache((current) => {
			const next = purgeOfflineEndpoint(current, endpoint);
			writeOfflineCache(appStorage, next);
			return next;
		});
	}, []);

	return useMemo(
		() => ({
			activeCards: inbox.active,
			settledItems: inbox.settled,
			feeds,
			offlineTasks,
			settle,
			reopen,
			isSettled,
			clearEndpointOffline,
		}),
		[clearEndpointOffline, feeds, inbox.active, inbox.settled, isSettled, offlineTasks, reopen, settle],
	);
}
