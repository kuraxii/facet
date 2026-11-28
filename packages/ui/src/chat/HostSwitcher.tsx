/**
 * 主机节点连接管理器。
 *
 * 页脚一个服务器图标按钮，点开是全部主机节点的连接状态面板：本机常驻在线（无断开按钮），
 * 下面列出已保存的远程主机；每行以四态状态点区分「已连就绪 / 连接或认证中 / 失败 / 未连接」，
 * 并在行内承接 SSH 密码输入、失败重试、启动自动连接、改名与删除，不阻断主工作区。
 */
import { Check, Pencil, Plus, Power, RotateCw, Server, Trash2, X, Zap } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../common/Button.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { endpointLabel, type SavedHost } from "./host-list.ts";

/** 单个主机节点的连接阶段。 */
export type HostNodePhase = "idle" | "connecting" | "ready" | "failed" | "auth";

/** 单个主机节点的实时状态快照。 */
export interface HostNodeState {
	/** 当前连接阶段 */
	phase: HostNodePhase;
	/** 链路是否就绪 */
	isOnline: boolean;
	/** 是否正在退避重连 */
	isReconnecting: boolean;
	/** 最近一次失败的事实说明 */
	failure?: string | undefined;
	/** 需要行内输入的 SSH 认证请求 */
	sshAuthPrompt?: { host: string; isRetry: boolean } | undefined;
}

/** 点浮层外面时关掉。 */
function useDismiss(isOpen: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			const node = ref.current;
			if (node !== null && event.target instanceof Node && node.contains(event.target)) {
				return;
			}
			close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen, close]);
	return ref;
}

function dotClassOf(state: HostNodeState | undefined): string {
	if (state === undefined || state.phase === "idle") {
		return "dot is-off";
	}
	if (state.phase === "failed") {
		return "dot is-err";
	}
	if (state.phase === "auth" || state.phase === "connecting" || state.isReconnecting) {
		return "dot is-warn is-pulse";
	}
	return state.isOnline ? "dot is-run" : "dot is-warn";
}

function triggerBadgeClass(
	hosts: readonly SavedHost[],
	statuses: ReadonlyMap<string, HostNodeState>,
): string | undefined {
	let hasWarn = false;
	for (const host of hosts) {
		const state = statuses.get(host.endpoint);
		if (state === undefined) {
			continue;
		}
		if (state.phase === "failed") {
			return "host-trigger-dot is-err";
		}
		if (state.phase === "auth" || state.isReconnecting) {
			hasWarn = true;
		}
	}
	return hasWarn ? "host-trigger-dot is-warn" : undefined;
}

export interface HostSwitcherProps {
	/** 本机的端点 */
	localEndpoint: string;
	/** 本机的显示名 */
	localName: string;
	/** 已保存的远程主机 */
	hosts: readonly SavedHost[];
	/** 各端点对应的实时状态 */
	statuses: ReadonlyMap<string, HostNodeState>;
	/** 在后台连接某台主机 */
	onConnect: (endpoint: string) => void;
	/** 断掉一台远程主机的连接 */
	onDisconnect: (endpoint: string) => void;
	/** 重连一台主机 */
	onReconnect: (endpoint: string) => void;
	/** 行内提交 SSH 密码 */
	onSubmitPassword: (endpoint: string, password: string) => void;
	/** 取消行内 SSH 认证 */
	onCancelAuth: (endpoint: string) => void;
	/** 添加一台主机；端点重复时返回原因 */
	onAddHost: (name: string, address: string, autoConnect?: boolean) => string | undefined;
	/** 删除一台远程主机 */
	onRemoveHost: (id: string) => void;
	/** 改一台远程主机的名字 */
	onRenameHost: (id: string, name: string) => void;
	/** 切换某台远程主机的启动自动连接 */
	onToggleAutoConnect: (id: string, autoConnect: boolean) => void;
}

export function HostSwitcher({
	localEndpoint,
	localName,
	hosts,
	statuses,
	onConnect,
	onDisconnect,
	onReconnect,
	onSubmitPassword,
	onCancelAuth,
	onAddHost,
	onRemoveHost,
	onRenameHost,
	onToggleAutoConnect,
}: HostSwitcherProps): ReactNode {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [isOpen, setIsOpen] = useState(false);
	const [isAdding, setIsAdding] = useState(false);
	/** 正在改名的主机与草稿 */
	const [renaming, setRenaming] = useState<{ id: string; draft: string } | undefined>(undefined);
	const renameRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (renaming !== undefined) {
			renameRef.current?.focus();
			renameRef.current?.select();
		}
	}, [renaming]);

	/** 各远程端点对应的行内 SSH 密码草稿 */
	const [passwords, setPasswords] = useState<Readonly<Record<string, string>>>({});
	const [name, setName] = useState("");
	const [address, setAddress] = useState("");
	const [autoConnect, setAutoConnect] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const addressRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (isAdding) {
			addressRef.current?.focus();
		}
	}, [isAdding]);

	// 有任意远程主机需要输入 SSH 密码时自动展开连接器，无需阻塞整窗口
	const hasPendingAuth = hosts.some((host) => statuses.get(host.endpoint)?.sshAuthPrompt !== undefined);
	useEffect(() => {
		if (hasPendingAuth) {
			setIsOpen(true);
		}
	}, [hasPendingAuth]);

	const wrap = useDismiss(isOpen, () => {
		setIsOpen(false);
		setIsAdding(false);
		setError(undefined);
	});

	/** 提交新增：成功后收起表单，失败把原因留在表单里。 */
	const submit = useCallback(
		(event: FormEvent<HTMLFormElement>): void => {
			event.preventDefault();
			const failure = onAddHost(
				name.trim().length === 0 ? endpointLabel(address) : name.trim(),
				address,
				autoConnect,
			);
			if (failure !== undefined) {
				setError(failure);
				return;
			}
			setName("");
			setAddress("");
			setAutoConnect(false);
			setError(undefined);
			setIsAdding(false);
		},
		[address, autoConnect, name, onAddHost],
	);

	const localState = statuses.get(localEndpoint);
	const triggerDot = triggerBadgeClass(hosts, statuses);

	return (
		<div className="host-switch" ref={wrap}>
			<div className="host-trigger-wrap">
				<IconButton
					active={isOpen}
					aria-label={t("host.menu")}
					aria-expanded={isOpen}
					{...tip.handlers(t("host.menu"))}
					onClick={() => {
						setIsOpen((open) => !open);
						setIsAdding(false);
					}}
				>
					<Server size={ICON_SIZE.md} />
				</IconButton>
				{triggerDot === undefined ? null : <i className={triggerDot} aria-hidden="true" />}
			</div>
			{isOpen ? (
				// biome-ignore lint/a11y/useSemanticElements: 浮层里是主机连接面板，用不到 fieldset 的表单语义
				<div className="host-pop" role="group" aria-label={t("host.list")}>
					<ul className="host-list">
						<li className="host-row">
							<button
								type="button"
								className="host-main"
								onClick={() => {
									if (localState?.phase === "failed") {
										onReconnect(localEndpoint);
									}
								}}
							>
								<i className={dotClassOf(localState)} />
								<span className="host-name">{localName}</span>
							</button>
						</li>
						{hosts.map((host) => {
							const state = statuses.get(host.endpoint);
							const phase = state?.phase ?? "idle";
							const authPrompt = state?.sshAuthPrompt;
							const isActiveRuntime = phase !== "idle";
							if (renaming?.id === host.id) {
								return (
									<li key={host.id} className="host-row is-editing">
										<Input
											size="md"
											className="host-rename"
											aria-label={t("host.newName")}
											value={renaming.draft}
											ref={renameRef}
											onChange={(event) => setRenaming({ id: host.id, draft: event.target.value })}
											onKeyDown={(event) => {
												if (event.key === "Enter" && !isComposingKey(event)) {
													onRenameHost(host.id, renaming.draft);
													setRenaming(undefined);
												} else if (event.key === "Escape") {
													event.preventDefault();
													setRenaming(undefined);
												}
											}}
										/>
										<button
											type="button"
											className="host-remove"
											aria-label={t("host.saveName")}
											{...tip.handlers(t("common.save"))}
											onClick={() => {
												onRenameHost(host.id, renaming.draft);
												setRenaming(undefined);
											}}
										>
											<Check size={ICON_SIZE.sm} />
										</button>
										<button
											type="button"
											className="host-remove"
											aria-label={t("host.cancelRename")}
											{...tip.handlers(t("common.cancel"))}
											onClick={() => setRenaming(undefined)}
										>
											<X size={ICON_SIZE.sm} />
										</button>
									</li>
								);
							}
							return (
								<li key={host.id} className="host-item">
									<div className="host-row">
										<button
											type="button"
											className="host-main"
											onClick={() => {
												if (phase === "idle") {
													onConnect(host.endpoint);
												} else if (phase === "failed") {
													onReconnect(host.endpoint);
												}
											}}
										>
											<i className={dotClassOf(state)} />
											<span className="host-name">{host.name}</span>
											<span className="host-addr mono">{endpointLabel(host.endpoint)}</span>
										</button>
										<button
											type="button"
											className={host.autoConnect ? "host-remove is-on" : "host-remove"}
											aria-label={t("host.autoConnect")}
											aria-pressed={Boolean(host.autoConnect)}
											{...tip.handlers(t("host.autoConnect"))}
											onClick={() => onToggleAutoConnect(host.id, !host.autoConnect)}
										>
											<Zap size={ICON_SIZE.sm} />
										</button>
										{isActiveRuntime ? (
											<button
												type="button"
												className="host-remove"
												aria-label={t("host.disconnectLabel", { name: host.name })}
												{...tip.handlers(t("host.disconnect"))}
												onClick={() => onDisconnect(host.endpoint)}
											>
												<Power size={ICON_SIZE.sm} />
											</button>
										) : null}
										<button
											type="button"
											className="host-remove"
											aria-label={t("host.renameLabel", { name: host.name })}
											{...tip.handlers(t("host.rename"))}
											onClick={() => setRenaming({ id: host.id, draft: host.name })}
										>
											<Pencil size={ICON_SIZE.sm} />
										</button>
										<button
											type="button"
											className="host-remove"
											aria-label={t("host.removeLabel", { name: host.name })}
											{...tip.handlers(t("host.remove"))}
											onClick={() => onRemoveHost(host.id)}
										>
											<Trash2 size={ICON_SIZE.sm} />
										</button>
									</div>
									{authPrompt === undefined ? null : (
										<form
											className="host-inline"
											onSubmit={(event) => {
												event.preventDefault();
												const secret = passwords[host.endpoint] ?? "";
												if (secret.length === 0) {
													return;
												}
												onSubmitPassword(host.endpoint, secret);
												setPasswords((cur) => {
													const next = { ...cur };
													delete next[host.endpoint];
													return next;
												});
											}}
										>
											<Input
												type="password"
												size="md"
												className="host-rename"
												placeholder={t("host.passwordPlaceholder")}
												aria-label={t("host.passwordPlaceholder")}
												value={passwords[host.endpoint] ?? ""}
												onChange={(event) => {
													const val = event.target.value;
													setPasswords((cur) => ({ ...cur, [host.endpoint]: val }));
												}}
											/>
											<button
												type="submit"
												className="host-remove"
												aria-label={t("common.save")}
												{...tip.handlers(t("common.save"))}
											>
												<Check size={ICON_SIZE.sm} />
											</button>
											<button
												type="button"
												className="host-remove"
												aria-label={t("common.cancel")}
												{...tip.handlers(t("common.cancel"))}
												onClick={() => onCancelAuth(host.endpoint)}
											>
												<X size={ICON_SIZE.sm} />
											</button>
										</form>
									)}
									{phase === "failed" && state?.failure !== undefined ? (
										<div className="host-inline">
											<span className="host-inline-err">{state.failure}</span>
											<button
												type="button"
												className="host-remove"
												aria-label={t("common.retry")}
												{...tip.handlers(t("common.retry"))}
												onClick={() => onReconnect(host.endpoint)}
											>
												<RotateCw size={ICON_SIZE.sm} />
											</button>
										</div>
									) : null}
								</li>
							);
						})}
					</ul>
					{isAdding ? (
						<form className="host-form" onSubmit={submit}>
							<Input
								size="md"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder={t("host.namePlaceholder")}
								aria-label={t("host.name")}
							/>
							<Input
								size="md"
								className="mono"
								value={address}
								onChange={(event) => setAddress(event.target.value)}
								placeholder={t("host.addressPlaceholder")}
								aria-label={t("host.address")}
								ref={addressRef}
							/>
							<label className="host-auto">
								<input
									type="checkbox"
									checked={autoConnect}
									onChange={(event) => setAutoConnect(event.target.checked)}
								/>
								<span>{t("host.autoConnect")}</span>
							</label>
							{error === undefined ? null : <p className="host-error">{error}</p>}
							<div className="host-form-actions">
								<Button type="submit" variant="primary" size="md">
									{t("host.add")}
								</Button>
								<Button
									variant="ghost"
									size="md"
									onClick={() => {
										setIsAdding(false);
										setError(undefined);
									}}
								>
									{t("host.cancel")}
								</Button>
							</div>
						</form>
					) : (
						<button
							type="button"
							className="host-add"
							onClick={() => {
								setIsAdding(true);
								setError(undefined);
							}}
						>
							<Plus size={ICON_SIZE.md} />
							{t("host.addHost")}
						</button>
					)}
				</div>
			) : null}
			{tip.render()}
		</div>
	);
}
