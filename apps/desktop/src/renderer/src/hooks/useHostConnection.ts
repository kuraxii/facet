/**
 * 单台目标主机的连接视图。
 *
 * 把目标 `HostRuntime` 的连接状态、模型目录与设置翻成界面直接用的形状，同时透传
 * `Hosts` 上的多主机连接管理入口。
 */
import type { HostHandshake } from "@facet/client-core";
import type { FacetSettings } from "@facet/protocol";
import type { HostListState } from "@facet/ui";
import { useI18n } from "@facet/ui";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { HostRuntime, HostRuntimeState, ProviderCatalog, SshAuthPrompt } from "../host-runtime.ts";
import type { Hosts } from "./useHosts.ts";

/** 连接屏显示哪一屏。ready 表示主机已经可以收发。 */
export type Phase = "connecting" | "ready" | "failed";

/** 当前目标主机的连接域，给界面用的形状。 */
export interface HostConnection {
	/** 连接屏显示哪一屏 */
	phase: Phase;
	/** 这台主机的端点 */
	endpoint: string;
	/** 连不上时的说明 */
	failure: string | undefined;
	/** 握手结果，连上之前为空 */
	host: HostHandshake | undefined;
	/** 主机清单 */
	hostList: HostListState;
	/** 全部已创建运行时的主机实时状态 */
	hostStates: ReadonlyMap<string, HostRuntimeState>;
	/** 连接是否可用 */
	isOnline: boolean;
	/** 是否正在退避重连 */
	isReconnecting: boolean;
	/** 这台主机连上过的次数，变一次上层就把属于主机的数据重取一遍 */
	connectEpoch: number;
	/** 主机上的偏好设置 */
	settings: FacetSettings;
	/** 模型目录与凭证状态 */
	catalog: ProviderCatalog;
	/** 要问 SSH 密码的那台主机 */
	sshAuthPrompt: SshAuthPrompt | undefined;
	/** 运行时还活着的端点，含后台连着的 */
	connectedEndpoints: readonly string[];
	/** 在后台连接某台主机 */
	connectHost: (endpoint: string) => void;
	/** 兼容旧切换接口：触发主机连接 */
	selectHost: (endpoint: string) => void;
	/** 断开某台远程主机 */
	disconnectHost: (endpoint: string) => void;
	/** 重连指定主机 */
	reconnectHost: (endpoint: string) => void;
	/** 提交当前目标主机的密码 */
	submitSshPassword: (password: string) => void;
	/** 关掉当前目标主机的密码框 */
	cancelSshAuth: () => void;
	/** 向指定主机提交密码 */
	submitSshPasswordFor: (endpoint: string, password: string) => void;
	/** 取消指定主机的密码框 */
	cancelSshAuthFor: (endpoint: string) => void;
	/** 设置启动时自动连接 */
	setHostAutoConnect: (id: string, autoConnect: boolean) => void;
	/** 立刻重连，取消等待中的退避 */
	reconnectNow: () => void;
	/** 添加一台远程主机，地址不合法或重复时返回原因 */
	addHost: (name: string, address: string, autoConnect?: boolean) => string | undefined;
	/** 改一台远程主机的名字 */
	renameHost: (id: string, name: string) => void;
	/** 删掉一台远程主机 */
	removeHost: (id: string) => void;
	/** 设置页保存之后回填 */
	applySettings: (next: FacetSettings) => void;
	/** 重取模型目录与凭证状态 */
	refreshCatalog: () => Promise<void>;
}

export interface HostConnectionOptions {
	/** 目标主机的运行时 */
	runtime: HostRuntime;
	/** 全局主机清单与连接管理动作 */
	hosts: Hosts;
}

export function useHostConnection(options: HostConnectionOptions): HostConnection {
	const { runtime, hosts } = options;
	const { t } = useI18n();
	const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
	const state = useSyncExternalStore(subscribe, () => runtime.getSnapshot());

	const failure =
		state.failure === undefined
			? undefined
			: state.failure.code === "need_password"
				? t("app.passwordRequired")
				: state.failure.message;

	return useMemo(
		() => ({
			phase: state.phase,
			endpoint: runtime.endpoint,
			failure,
			host: state.handshake,
			hostList: hosts.hostList,
			hostStates: hosts.hostStates,
			isOnline: state.link.status === "ready",
			isReconnecting: state.link.status === "reconnecting",
			connectEpoch: state.connectEpoch,
			settings: state.settings,
			catalog: state.catalog,
			sshAuthPrompt: state.sshAuthPrompt,
			connectedEndpoints: hosts.connectedEndpoints,
			connectHost: (endpoint: string) => {
				hosts.connectHost(endpoint);
			},
			selectHost: hosts.selectHost,
			disconnectHost: hosts.disconnectHost,
			reconnectHost: hosts.reconnectHost,
			submitSshPassword: (password: string) => runtime.submitPassword(password),
			cancelSshAuth: () => runtime.cancelPasswordPrompt(),
			submitSshPasswordFor: hosts.submitSshPassword,
			cancelSshAuthFor: hosts.cancelSshAuth,
			setHostAutoConnect: hosts.setHostAutoConnect,
			reconnectNow: () => runtime.reconnectNow(),
			addHost: hosts.addHost,
			renameHost: hosts.renameHost,
			removeHost: hosts.removeHost,
			applySettings: (next: FacetSettings) => runtime.applySettings(next),
			refreshCatalog: () => runtime.refreshCatalog(),
		}),
		[failure, hosts, runtime, state],
	);
}
