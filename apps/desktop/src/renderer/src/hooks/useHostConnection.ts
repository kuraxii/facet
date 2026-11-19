/**
 * 一台主机的连接域。
 *
 * 连接本身（退避重连、续订、握手）在运行时的连接链路里，切到别的主机也不会停；这里只把
 * 运行时的状态翻成界面直接用的形状，并把主机清单的切换入口一并交出去。
 *
 * 没有「换主机」这个动作：换主机是换一份运行时，这个 Hook 重新挂一次即可。
 */
import type { HostHandshake } from "@facet/client-core";
import type { FacetSettings } from "@facet/protocol";
import type { HostListState } from "@facet/ui";
import { useI18n } from "@facet/ui";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { HostRuntime, ProviderCatalog, SshAuthPrompt } from "../host-runtime.ts";
import type { Hosts } from "./useHosts.ts";

/** 连接屏显示哪一屏。ready 表示主机已经可以收发。 */
export type Phase = "connecting" | "ready" | "failed";

/** 一台主机的连接域，给界面用的形状。 */
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
	/** 换一台主机；已经连着的直接切过去，不断开原来那台 */
	selectHost: (endpoint: string) => void;
	/** 断开某台主机 */
	disconnectHost: (endpoint: string) => void;
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
	/** 删掉一台远程主机；删的是当前这台时回到本机 */
	removeHost: (id: string) => void;
	/** 设置页保存之后回填 */
	applySettings: (next: FacetSettings) => void;
	/** 重取模型目录与凭证状态 */
	refreshCatalog: () => Promise<void>;
}

export interface HostConnectionOptions {
	/** 这台主机的运行时 */
	runtime: HostRuntime;
	/** 主机清单与切换动作 */
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
			isOnline: state.link.status === "ready",
			isReconnecting: state.link.status === "reconnecting",
			connectEpoch: state.connectEpoch,
			settings: state.settings,
			catalog: state.catalog,
			sshAuthPrompt: state.sshAuthPrompt,
			connectedEndpoints: hosts.connectedEndpoints,
			selectHost: hosts.selectHost,
			disconnectHost: hosts.disconnectHost,
			submitSshPassword: (password: string) => runtime.submitPassword(password),
			cancelSshAuth: () => runtime.cancelPasswordPrompt(),
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
