/**
 * 主机连接与 SSH 鉴权。
 *
 * 管三件事：当前连的是哪台主机、连接处在什么状态、缺密码时问一次。退避重连与续订在
 * `client-core` 的连接链路里，这里只把链路的状态翻成界面能用的形状，并在换主机的瞬间
 * 抬一次号，让上层各自清掉跟主机绑定的状态。
 */
import type { HostHandshake } from "@facet/client-core";
import { DEFAULT_SETTINGS, type FacetSettings, type ModelInfo } from "@facet/protocol";
import {
	endpointLabel,
	type HostListState,
	hasEndpoint,
	normalizeEndpoint,
	readHostList,
	type SavedHost,
	useI18n,
	writeHostList,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LOCAL_TARGET } from "../host-connection.ts";
import {
	bridge,
	client,
	connection,
	currentSshPassword,
	linkHooks,
	type Phase,
	setHostTarget,
	setSshPassword,
	terminalClient,
} from "../runtime.ts";

/** 主机的模型目录与各提供方的凭证状态。 */
export interface ProviderCatalog {
	/** 可选的模型，只列已经配好凭证的提供方 */
	readonly models: readonly ModelInfo[];
	/** 提供方标识到是否可用，用来标注当前模型 */
	readonly auth: Record<string, boolean>;
}

/** 要问 SSH 密码的那台主机。 */
export interface SshAuthPrompt {
	/** 连接目标，提交密码时原样带上 */
	readonly target: string;
	/** 弹窗里显示的主机名 */
	readonly host: string;
	/** 上一次是不是已经用密码试过，弹窗据此提示重输 */
	readonly isRetry: boolean;
}

/** 主机清单：本机之外用户添加的远程主机，以及当前连着的端点。 */

export interface HostConnectionOptions {
	/** 会话续订失败时通知上层，典型情形是会话文件已经不在了 */
	onSessionLost?: () => void;
}

export interface HostConnection {
	/** 连接屏显示哪一屏 */
	phase: Phase;
	/** 当前连的主机端点 */
	endpoint: string;
	/** 连不上时的说明 */
	failure: string | undefined;
	/** 握手结果，连上之前为空 */
	host: HostHandshake | undefined;
	/** 主机清单 */
	hostList: HostListState;
	/** 连接是否可用 */
	isOnline: boolean;
	/** 是否正在退避重连 */
	isReconnecting: boolean;
	/** 每次连接就绪递增，上层据此补齐数据 */
	connectEpoch: number;
	/** 每次换主机递增，上层据此丢掉属于上一台主机的状态 */
	hostEpoch: number;
	/** 主机上的偏好设置 */
	settings: FacetSettings;
	/** 模型目录与凭证状态 */
	catalog: ProviderCatalog;
	/** 要问 SSH 密码的那台主机 */
	sshAuthPrompt: SshAuthPrompt | undefined;
	/** 换一台主机；同端点带了新密码视为重试 */
	selectHost: (endpoint: string, password?: string) => Promise<void>;
	/** 提交密码框里填的密码 */
	submitSshPassword: (password: string) => void;
	/** 关掉密码框，回到连不上主机那一屏 */
	cancelSshAuth: () => void;
	/** 立刻重连，取消等待中的退避 */
	reconnectNow: () => void;
	/** 添加一台远程主机，地址不合法或重复时返回原因 */
	addHost: (name: string, address: string) => string | undefined;
	/** 改一台远程主机的名字 */
	renameHost: (id: string, name: string) => void;
	/** 删掉一台远程主机；删的是当前连接时回到本机 */
	removeHost: (id: string) => void;
	/** 设置页保存之后回填 */
	applySettings: (next: FacetSettings) => void;
	/** 重取模型目录与凭证状态 */
	refreshCatalog: () => Promise<void>;
}

export function useHostConnection(options: HostConnectionOptions = {}): HostConnection {
	const { onSessionLost } = options;
	const { t } = useI18n();
	const [phase, setPhase] = useState<Phase>("connecting");
	const [endpoint, setEndpoint] = useState(LOCAL_TARGET);
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [host, setHost] = useState<HostHandshake | undefined>(undefined);
	const [sshAuthPrompt, setSshAuthPrompt] = useState<SshAuthPrompt | undefined>(undefined);
	const [settings, setSettings] = useState<FacetSettings>(DEFAULT_SETTINGS);
	const [catalog, setCatalog] = useState<ProviderCatalog>({ models: [], auth: {} });
	const [connectEpoch, setConnectEpoch] = useState(0);
	/** 换主机的次数；同端点换个密码重来也算一次 */
	const [hostEpoch, setHostEpoch] = useState(0);
	const link = useSyncExternalStore(
		(onChange) => connection.subscribe(onChange),
		() => connection.snapshot,
	);
	/** 启动只做一次 */
	const started = useRef(false);
	/** 当前端点，供链路回调读取：回调不该随端点变化重新注册 */
	const endpointRef = useRef(endpoint);
	endpointRef.current = endpoint;

	/** 主机清单：本机之外用户添加的远程主机，以及当前连着的端点 */
	const [hostList, setHostList] = useState<HostListState>(() => {
		const saved = readHostList(localStorage, LOCAL_TARGET);
		// 外部给了 FACET_ENDPOINT 就以它为准：上一次连的远程主机不该盖过这次显式指定的地址
		return bridge.hostMode === "external" ? { ...saved, activeEndpoint: LOCAL_TARGET } : saved;
	});

	const updateHostList = useCallback((next: HostListState) => {
		setHostList(next);
		writeHostList(localStorage, next);
	}, []);

	// 外部指定了端点时，把记着的那台改回来，别让下次启动被旧地址带着走
	useEffect(() => {
		if (bridge.hostMode === "external" && localStorage.getItem("facet.hosts.active") !== LOCAL_TARGET) {
			writeHostList(localStorage, { ...hostList, activeEndpoint: LOCAL_TARGET });
		}
	}, [hostList]);

	/** 重取模型目录与各提供方的凭证状态。 */
	const refreshCatalog = useCallback(async (): Promise<void> => {
		const [models, providers] = await Promise.all([
			client.listAvailableModels().catch(() => []),
			client.listProviders().catch(() => []),
		]);
		setCatalog({
			models,
			auth: Object.fromEntries(providers.map((provider) => [provider.id, provider.authenticated])),
		});
	}, []);

	/** 连接失败：缺密码就把密码框摆出来，其余情况回到「连不上主机」。 */
	const handleConnectError = useCallback((error: unknown, target: string, hadPassword: boolean): void => {
		const code = (error as { code?: unknown } | undefined)?.code;
		if (code === "need_password") {
			setSshAuthPrompt({ target, host: endpointLabel(target), isRetry: hadPassword });
			setPhase("connecting");
			return;
		}
		setFailure(error instanceof Error ? error.message : String(error));
		setPhase("failed");
	}, []);

	/** 连上之后界面这一侧的动作；协议侧的握手由连接链路登记。 */
	const attachHost = useCallback((handshake: HostHandshake) => {
		terminalClient.start();
		setHost(handshake);
	}, []);

	/**
	 * 链路自己发起的重连：补齐终端订阅，记下续订结果，交给上层刷新数据。
	 *
	 * 刷新由上层看 `connectEpoch` 做——启动、换主机、重连三条路因此走同一段代码。
	 */
	useEffect(() => {
		linkHooks.onReady = (handshake, failed) => {
			attachHost(handshake);
			setPhase("ready");
			setConnectEpoch((current) => current + 1);
			if (failed) {
				// 会话回不来（例如文件已经不在了）时退回没有会话的状态，连接本身照常可用
				onSessionLost?.();
			}
		};
		linkHooks.onFailure = (error, willRetry) => {
			if (willRetry) {
				// 重连失败的原因留在控制台，便于排查连不上的问题
				console.log("[connection] Retry failed", error instanceof Error ? error.message : String(error));
				return;
			}
			handleConnectError(error, endpointRef.current, currentSshPassword() !== undefined);
		};
	}, [attachHost, handleConnectError, onSessionLost]);

	// 本机主机重新拉起后端口与令牌都会变：按新的发现记录再握手，会话由链路续订
	useEffect(
		() =>
			bridge.onLocalHostChanged(() => {
				setHostTarget(LOCAL_TARGET);
				setEndpoint(LOCAL_TARGET);
				// 会话还在屏幕上时不退回连接屏，只把状态换成「重连中」
				setPhase((current) => (current === "failed" ? "connecting" : current));
				void connection.reconnectNow();
			}),
		[],
	);

	/**
	 * 切到另一台主机。
	 *
	 * 先放掉当前会话并换目标，再握一次手：设置、模型目录、项目与会话都属于主机，换过去
	 * 之后由上层看 `connectEpoch` 整份重新取。连不上就停在「连不上主机」那一屏。
	 */
	const selectHost = useCallback(
		async (nextEndpoint: string, password?: string): Promise<void> => {
			// 同一台主机带密码重来是「密码填错了再试一次」，不能挡
			if (nextEndpoint === endpoint && password === undefined) {
				setSshAuthPrompt(undefined);
				return;
			}
			setSshPassword(password);
			updateHostList({ ...hostList, activeEndpoint: nextEndpoint });
			setEndpoint(nextEndpoint);
			setHostEpoch((current) => current + 1);
			setHostTarget(nextEndpoint);
			await client.release().catch(() => undefined);
			setPhase("connecting");
			// 换目标之前先把旧连接的退避与定时器收掉，再只握一次手
			connection.disconnect();
			try {
				const handshake = await connection.open();
				attachHost(handshake);
				setSettings(await client.getSettings().catch(() => DEFAULT_SETTINGS));
				await refreshCatalog();
				setConnectEpoch((current) => current + 1);
				setPhase("ready");
			} catch (error) {
				handleConnectError(error, nextEndpoint, password !== undefined);
			}
		},
		[endpoint, hostList, refreshCatalog, updateHostList, attachHost, handleConnectError],
	);

	/** 提交密码：带上它重连同一台主机。 */
	const submitSshPassword = useCallback(
		(password: string) => {
			const prompt = sshAuthPrompt;
			if (prompt === undefined) {
				return;
			}
			setSshAuthPrompt(undefined);
			void selectHost(prompt.target, password);
		},
		[selectHost, sshAuthPrompt],
	);

	/** 关掉密码框：缺密码就摆到连不上主机那一屏。 */
	const cancelSshAuth = useCallback(() => {
		setSshAuthPrompt(undefined);
		setFailure(t("app.passwordRequired"));
		setPhase("failed");
	}, [t]);

	const reconnectNow = useCallback(() => {
		void connection.reconnectNow();
	}, []);

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
		[hostList, updateHostList, t],
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

	/** 从清单里删掉一台远程主机；删的是当前连接时回到本机。 */
	const removeHost = useCallback(
		(id: string): void => {
			const target = hostList.hosts.find((entry) => entry.id === id);
			updateHostList({ ...hostList, hosts: hostList.hosts.filter((entry) => entry.id !== id) });
			if (target !== undefined && target.endpoint === endpoint) {
				void selectHost(LOCAL_TARGET);
			}
		},
		[endpoint, hostList, selectHost, updateHostList],
	);

	const applySettings = useCallback((next: FacetSettings) => setSettings(next), []);

	// 启动：上次连的是远程主机时直接连回去，连不上会落到「连不上主机」那一屏
	useEffect(() => {
		if (started.current) {
			return;
		}
		started.current = true;
		void (async () => {
			const startEndpoint = hostList.activeEndpoint;
			if (startEndpoint !== LOCAL_TARGET) {
				setHostTarget(startEndpoint);
				setEndpoint(startEndpoint);
			}
			const handshake = await connection.open();
			attachHost(handshake);
			// 设置读不到时用缺省值，界面照常可用
			setSettings(await client.getSettings().catch(() => DEFAULT_SETTINGS));
			// 模型选择器只列可用的模型（已配置凭证的提供方）
			await refreshCatalog();
			setConnectEpoch((current) => current + 1);
			setPhase("ready");
		})().catch((error: unknown) => {
			handleConnectError(error, hostList.activeEndpoint, false);
		});
	}, [attachHost, handleConnectError, hostList.activeEndpoint, refreshCatalog]);

	const isOnline = link.status === "ready";

	return useMemo(
		() => ({
			phase,
			endpoint,
			failure,
			host,
			hostList,
			isOnline,
			isReconnecting: link.status === "reconnecting",
			connectEpoch,
			hostEpoch,
			settings,
			catalog,
			sshAuthPrompt,
			selectHost,
			submitSshPassword,
			cancelSshAuth,
			reconnectNow,
			addHost,
			renameHost,
			removeHost,
			applySettings,
			refreshCatalog,
		}),
		[
			phase,
			endpoint,
			failure,
			host,
			hostList,
			isOnline,
			link.status,
			connectEpoch,
			hostEpoch,
			settings,
			catalog,
			sshAuthPrompt,
			selectHost,
			submitSshPassword,
			cancelSshAuth,
			reconnectNow,
			addHost,
			renameHost,
			removeHost,
			applySettings,
			refreshCatalog,
		],
	);
}
