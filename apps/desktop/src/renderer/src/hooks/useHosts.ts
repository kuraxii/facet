/**
 * 一次渲染进程里的全部主机。
 *
 * 管三件事：清单里有哪些主机、前台是哪一台、哪几台的运行时还活着。切换只改「前台是谁」，
 * 后台那套连接照常收动作与重连；只有显式断开（或从清单里删掉）才拆掉运行时。
 *
 * 清单记在本地存储里，运行时只在内存里：窗口一关，通道随主进程一起回收。
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../bridge.ts";
import { LOCAL_TARGET } from "../host-connection.ts";
import { type HostRuntime, HostRuntimeRegistry } from "../host-runtime.ts";
import { appStorage } from "../local-storage.ts";

/** 主机的连接域，挂在一次渲染进程上。 */
export interface Hosts {
	/** 前台是哪个端点 */
	activeEndpoint: string;
	/** 前台主机的运行时；切主机时换成另一份，已有的那份仍然活着 */
	runtime: HostRuntime;
	/** 主机清单 */
	hostList: HostListState;
	/** 运行时还活着的端点，含后台连着的 */
	connectedEndpoints: readonly string[];
	/** 把某台主机换到前台；没有运行时就连一次 */
	selectHost: (endpoint: string) => void;
	/** 断开某台主机：拆掉运行时，回到本机之后它会重新连 */
	disconnectHost: (endpoint: string) => void;
	/** 添加一台远程主机，地址不合法或重复时返回原因 */
	addHost: (name: string, address: string) => string | undefined;
	/** 改一台远程主机的名字 */
	renameHost: (id: string, name: string) => void;
	/** 删除一台远程主机；删的是当前这台时回到本机 */
	removeHost: (id: string) => void;
}

export function useHosts(): Hosts {
	const { t } = useI18n();
	const registryRef = useRef<HostRuntimeRegistry | null>(null);
	if (registryRef.current === null) {
		registryRef.current = new HostRuntimeRegistry();
	}
	const registry = registryRef.current;

	/** 主机清单：本机之外用户添加的远程主机，以及当前连着的端点 */
	const [hostList, setHostList] = useState<HostListState>(() => {
		const saved = readHostList(appStorage, LOCAL_TARGET);
		// 外部给了 FACET_ENDPOINT 就以它为准：上一次连的远程主机不该盖过这次显式指定的地址
		return bridge.hostMode === "external" ? { ...saved, activeEndpoint: LOCAL_TARGET } : saved;
	});
	const [activeEndpoint, setActiveEndpoint] = useState(hostList.activeEndpoint);
	/** 运行时还活着的端点，含后台连着的；断开时从这里去掉 */
	const [connectedEndpoints, setConnectedEndpoints] = useState<readonly string[]>([]);
	/** 前台运行时被断开时要换一个新实例，靠它让下面那份 memo 重算 */
	const [runtimeEpoch, setRuntimeEpoch] = useState(0);

	// 外部指定了端点时，把记着的那台改回来，别让下次启动被旧地址带着走
	useEffect(() => {
		if (bridge.hostMode === "external" && appStorage.getItem("facet.hosts.active") !== LOCAL_TARGET) {
			writeHostList(appStorage, { ...hostList, activeEndpoint: LOCAL_TARGET });
		}
	}, [hostList]);

	const updateHostList = useCallback((next: HostListState) => {
		setHostList(next);
		writeHostList(appStorage, next);
	}, []);

	/** 前台主机的运行时。同一台主机建过一次就一直用那一个。 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: runtimeEpoch 不是输入，是「这台主机的运行时已经废了，重取一个」的开关
	const runtime = useMemo(
		() =>
			registry.ensure({
				bridge,
				endpoint: activeEndpoint,
				isLocal: activeEndpoint === LOCAL_TARGET,
			}),
		[registry, activeEndpoint, runtimeEpoch],
	);

	// 换到一台还没连过的主机就连一次；后台连着的不再重复握手
	useEffect(() => {
		setConnectedEndpoints((current) =>
			current.includes(activeEndpoint) ? current : [...current, activeEndpoint],
		);
		void runtime.connect();
	}, [activeEndpoint, runtime]);

	/** 换到另一台主机；旧的那台不断开，留在后台。 */
	const selectHost = useCallback(
		(endpoint: string) => {
			if (endpoint === activeEndpoint) {
				return;
			}
			setActiveEndpoint(endpoint);
			updateHostList({ ...hostList, activeEndpoint: endpoint });
		},
		[activeEndpoint, hostList, updateHostList],
	);

	/** 断开某台主机：拆掉运行时与它的工作区快照。断的是前台就回到本机。 */
	const disconnectHost = useCallback(
		(endpoint: string) => {
			if (endpoint === activeEndpoint && endpoint !== LOCAL_TARGET) {
				selectHost(LOCAL_TARGET);
			}
			void registry.dispose(endpoint);
			setConnectedEndpoints((current) => current.filter((item) => item !== endpoint));
			// 断开的正是前台时，原来那个运行时已经废了，下一次渲染要重新建一个
			if (endpoint === activeEndpoint) {
				setRuntimeEpoch((current) => current + 1);
			}
		},
		[activeEndpoint, registry, selectHost],
	);

	/** 添加一台主机：地址收成端点，重复的直接回原因。 */
	const addHost = useCallback(
		(name: string, address: string): string | undefined => {
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
			};
			updateHostList({ ...hostList, hosts: [...hostList.hosts, entry] });
			return undefined;
		},
		[hostList, t, updateHostList],
	);

	/** 改一台远程主机的名字，名字从清单里读，不改连接。 */
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

	/** 从清单里删掉一台远程主机：连同它的运行时一起收掉。 */
	const removeHost = useCallback(
		(id: string): void => {
			const target = hostList.hosts.find((entry) => entry.id === id);
			updateHostList({ ...hostList, hosts: hostList.hosts.filter((entry) => entry.id !== id) });
			if (target === undefined) {
				return;
			}
			if (target.endpoint === activeEndpoint) {
				selectHost(LOCAL_TARGET);
			}
			void registry.dispose(target.endpoint);
			setConnectedEndpoints((current) => current.filter((item) => item !== target.endpoint));
		},
		[activeEndpoint, hostList, registry, selectHost, updateHostList],
	);

	return useMemo(
		() => ({
			activeEndpoint,
			runtime,
			hostList,
			connectedEndpoints,
			selectHost,
			disconnectHost,
			addHost,
			renameHost,
			removeHost,
		}),
		[
			activeEndpoint,
			runtime,
			hostList,
			connectedEndpoints,
			selectHost,
			disconnectHost,
			addHost,
			renameHost,
			removeHost,
		],
	);
}
