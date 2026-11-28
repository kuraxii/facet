/**
 * 一次渲染进程里的全部主机运行时。
 *
 * 原则：
 * 1. 本机 Host（`LOCAL_TARGET`）永远作为常驻底座随应用启动自动拉起，不因远端状态卸载工作区。
 * 2. 远程主机作为后台并发运行时挂载：`autoConnect === true` 的节点在启动时自动并行建连，
 *    其余节点由用户按需触发连接；切走会话不断开，只有显式断开或删除才拆掉运行时。
 */
import {
	type HostListState,
	hasEndpoint,
	normalizeEndpoint,
	readHostList,
	type SavedHost,
	useI18n,
	writeHostList,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { bridge } from "../bridge.ts";
import { LOCAL_TARGET } from "../host-connection.ts";
import { type HostRuntime, HostRuntimeRegistry, type HostRuntimeState } from "../host-runtime.ts";
import { appStorage } from "../local-storage.ts";

/** 全局主机注册表与连接管理域。 */
export interface Hosts {
	/** 全部主机运行时注册表 */
	registry: HostRuntimeRegistry;
	/** 注册表及任意运行时状态变更版本号 */
	registryVersion: number;
	/** 本机常驻运行时 */
	localRuntime: HostRuntime;
	/** 按端点取运行时，缺省或未连接时回退本机运行时 */
	getRuntime: (endpoint: string | undefined) => HostRuntime;
	/** 已连接（或正在连）的主机实时状态快照 */
	hostStates: ReadonlyMap<string, HostRuntimeState>;
	/** 主机清单 */
	hostList: HostListState;
	/** 运行时还活着的端点（含本机与后台远程主机） */
	connectedEndpoints: readonly string[];
	/** 在后台发起/复用与某台主机的连接 */
	connectHost: (endpoint: string) => HostRuntime;
	/** 断开某台远程主机（本机常驻不断开） */
	disconnectHost: (endpoint: string) => void;
	/** 重连某台主机 */
	reconnectHost: (endpoint: string) => void;
	/** 向指定主机提交 SSH 密码并重试 */
	submitSshPassword: (endpoint: string, password: string) => void;
	/** 取消指定主机的 SSH 密码输入 */
	cancelSshAuth: (endpoint: string) => void;
	/** 设置远程主机是否随启动自动连接 */
	setHostAutoConnect: (id: string, autoConnect: boolean) => void;
	/** 兼容旧切换接口：触发目标主机连接 */
	selectHost: (endpoint: string) => void;
	/** 添加一台远程主机，地址不合法或重复时返回原因 */
	addHost: (name: string, address: string, autoConnect?: boolean) => string | undefined;
	/** 改一台远程主机的名字 */
	renameHost: (id: string, name: string) => void;
	/** 删除一台远程主机并拆掉其运行时 */
	removeHost: (id: string) => void;
}

export function useHosts(): Hosts {
	const { t } = useI18n();
	const registryRef = useRef<HostRuntimeRegistry | null>(null);
	if (registryRef.current === null) {
		registryRef.current = new HostRuntimeRegistry();
	}
	const registry = registryRef.current;

	const [hostList, setHostList] = useState<HostListState>(() => {
		const saved = readHostList(appStorage, LOCAL_TARGET);
		return { ...saved, activeEndpoint: LOCAL_TARGET };
	});

	const registryVersion = useSyncExternalStore(
		useCallback((listener) => registry.subscribe(listener), [registry]),
		() => registry.getVersion(),
	);

	// 本机运行时始终存在且在启动时立即发起连接
	const localRuntime = useMemo(
		() =>
			registry.ensure({
				bridge,
				endpoint: LOCAL_TARGET,
				isLocal: true,
			}),
		[registry],
	);

	const updateHostList = useCallback((next: HostListState) => {
		setHostList(next);
		writeHostList(appStorage, next);
	}, []);

	const connectHost = useCallback(
		(endpoint: string): HostRuntime => {
			const runtime = registry.ensure({
				bridge,
				endpoint,
				isLocal: endpoint === LOCAL_TARGET,
			});
			void runtime.connect();
			return runtime;
		},
		[registry],
	);

	// 启动时拉起本机 Host，并为开启了 autoConnect 的远端主机并行建连
	useEffect(() => {
		void localRuntime.connect();
		for (const entry of hostList.hosts) {
			if (entry.autoConnect) {
				connectHost(entry.endpoint);
			}
		}
	}, [connectHost, hostList.hosts, localRuntime]);

	const disconnectHost = useCallback(
		(endpoint: string) => {
			if (endpoint === LOCAL_TARGET) {
				return;
			}
			void registry.dispose(endpoint);
		},
		[registry],
	);

	const reconnectHost = useCallback(
		(endpoint: string) => {
			const existing = registry.get(endpoint);
			if (existing !== undefined) {
				existing.reconnectNow();
				return;
			}
			connectHost(endpoint);
		},
		[connectHost, registry],
	);

	const submitSshPassword = useCallback(
		(endpoint: string, password: string) => {
			registry.get(endpoint)?.submitPassword(password);
		},
		[registry],
	);

	const cancelSshAuth = useCallback(
		(endpoint: string) => {
			registry.get(endpoint)?.cancelPasswordPrompt();
		},
		[registry],
	);

	const getRuntime = useCallback(
		(endpoint: string | undefined): HostRuntime => {
			if (endpoint === undefined || endpoint === LOCAL_TARGET) {
				return localRuntime;
			}
			return registry.get(endpoint) ?? localRuntime;
		},
		[localRuntime, registry],
	);

	const addHost = useCallback(
		(name: string, address: string, autoConnect = false): string | undefined => {
			const normalized = normalizeEndpoint(address);
			if (normalized === undefined) {
				return t("app.invalidAddress");
			}
			if (hasEndpoint(hostList, normalized, LOCAL_TARGET)) {
				return t("app.duplicateHost");
			}
			const entry: SavedHost = {
				id: `${Date.now().toString(36)}-${hostList.hosts.length}`,
				name,
				endpoint: normalized,
				...(autoConnect ? { autoConnect: true } : {}),
			};
			updateHostList({ ...hostList, hosts: [...hostList.hosts, entry] });
			if (autoConnect) {
				connectHost(normalized);
			}
			return undefined;
		},
		[connectHost, hostList, t, updateHostList],
	);

	const renameHost = useCallback(
		(id: string, name: string): void => {
			const trimmed = name.trim();
			if (trimmed.length === 0) {
				return;
			}
			updateHostList({
				...hostList,
				hosts: hostList.hosts.map((entry) => (entry.id === id ? { ...entry, name: trimmed } : entry)),
			});
		},
		[hostList, updateHostList],
	);

	const setHostAutoConnect = useCallback(
		(id: string, autoConnect: boolean): void => {
			let matchedEndpoint: string | undefined;
			const nextHosts = hostList.hosts.map((entry) => {
				if (entry.id !== id) {
					return entry;
				}
				matchedEndpoint = entry.endpoint;
				return autoConnect
					? { ...entry, autoConnect: true }
					: { id: entry.id, name: entry.name, endpoint: entry.endpoint };
			});
			updateHostList({ ...hostList, hosts: nextHosts });
			if (autoConnect && matchedEndpoint !== undefined) {
				connectHost(matchedEndpoint);
			}
		},
		[connectHost, hostList, updateHostList],
	);

	const removeHost = useCallback(
		(id: string): void => {
			const target = hostList.hosts.find((entry) => entry.id === id);
			updateHostList({ ...hostList, hosts: hostList.hosts.filter((entry) => entry.id !== id) });
			if (target !== undefined) {
				void registry.dispose(target.endpoint);
			}
		},
		[hostList, registry, updateHostList],
	);

	// registryVersion 变化时重建活跃快照表与端点列表，供多主机 UI 消费
	const { connectedEndpoints, hostStates } = useMemo(() => {
		void registryVersion;
		const states = new Map<string, HostRuntimeState>();
		for (const [endpoint, runtime] of registry.entries()) {
			states.set(endpoint, runtime.getSnapshot());
		}
		return {
			connectedEndpoints: registry.endpoints(),
			hostStates: states as ReadonlyMap<string, HostRuntimeState>,
		};
	}, [registry, registryVersion]);

	return useMemo(
		() => ({
			registry,
			registryVersion,
			localRuntime,
			getRuntime,
			hostStates,
			hostList,
			connectedEndpoints,
			connectHost,
			disconnectHost,
			reconnectHost,
			submitSshPassword,
			cancelSshAuth,
			setHostAutoConnect,
			selectHost: (endpoint: string) => {
				connectHost(endpoint);
			},
			addHost,
			renameHost,
			removeHost,
		}),
		[
			registry,
			registryVersion,
			localRuntime,
			getRuntime,
			hostStates,
			hostList,
			connectedEndpoints,
			connectHost,
			disconnectHost,
			reconnectHost,
			submitSshPassword,
			cancelSshAuth,
			setHostAutoConnect,
			addHost,
			renameHost,
			removeHost,
		],
	);
}
