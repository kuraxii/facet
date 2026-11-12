/**
 * 主机切换。
 *
 * 页脚一个服务器图标按钮，点开是主机清单：本机永远在最上面，下面是用户添加过的远程主机；
 * 每行显示状态点、名字与地址，当前连着的那台高亮。清单底部是「添加主机」，展开一个填名字与
 * 地址的小表单；再往下是本机主机的两个开关：关掉窗口后是否继续运行、结束主机。
 */
import { Plus, Server, Settings2 } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { endpointLabel, type SavedHost } from "./host-list.ts";

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

export interface HostSwitcherProps {
	/** 本机的端点 */
	localEndpoint: string;
	/** 本机的显示名 */
	localName: string;
	/** 当前连着的端点 */
	activeEndpoint: string;
	/** 已保存的远程主机 */
	hosts: readonly SavedHost[];
	/** 当前连接是否就绪 */
	isOnline: boolean;
	/** 连到某个端点 */
	onConnect: (endpoint: string) => void;
	/** 添加一台主机；端点重复时返回原因 */
	onAddHost: (name: string, endpoint: string) => string | undefined;
	/** 删除一台远程主机 */
	onRemoveHost: (id: string) => void;
	/** 关掉窗口后本机主机是否继续运行 */
	keepOnClose: boolean;
	/** 改「关掉窗口后继续运行」 */
	onToggleKeepOnClose: (next: boolean) => void;
	/** 结束本机主机；失败时返回原因 */
	onShutdownHost: () => Promise<string | undefined>;
}

export function HostSwitcher({
	localEndpoint,
	localName,
	activeEndpoint,
	hosts,
	isOnline,
	onConnect,
	onAddHost,
	onRemoveHost,
	keepOnClose,
	onToggleKeepOnClose,
	onShutdownHost,
}: HostSwitcherProps): ReactNode {
	const [isOpen, setIsOpen] = useState(false);
	const [isAdding, setIsAdding] = useState(false);
	/** 结束主机要先确认一次，避免点错把运行中的任务带走 */
	const [isConfirming, setIsConfirming] = useState(false);
	/** 结束主机失败的原因 */
	const [shutdownError, setShutdownError] = useState<string | undefined>(undefined);
	const [name, setName] = useState("");
	const [address, setAddress] = useState("");
	const [error, setError] = useState<string | undefined>(undefined);
	/** 地址输入框，展开「添加主机」时把焦点送过去 */
	const addressRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (isAdding) {
			addressRef.current?.focus();
		}
	}, [isAdding]);

	const wrap = useDismiss(isOpen, () => {
		setIsOpen(false);
		setIsAdding(false);
		setIsConfirming(false);
		setError(undefined);
		setShutdownError(undefined);
	});

	/** 提交新增：成功后收起表单，失败把原因留在表单里。 */
	const submit = useCallback(
		(event: FormEvent<HTMLFormElement>): void => {
			event.preventDefault();
			const failure = onAddHost(name.trim().length === 0 ? endpointLabel(address) : name.trim(), address);
			if (failure !== undefined) {
				setError(failure);
				return;
			}
			setName("");
			setAddress("");
			setError(undefined);
			setIsAdding(false);
		},
		[address, name, onAddHost],
	);

	return (
		<div className="host-switch" ref={wrap}>
			<button
				type="button"
				className="sb-foot-btn is-icon"
				aria-label="主机"
				title="主机"
				aria-expanded={isOpen}
				onClick={() => {
					setIsOpen((open) => !open);
					setIsAdding(false);
				}}
			>
				<Server size={14} strokeWidth={1.5} />
			</button>
			{isOpen ? (
				<div className="host-pop" role="dialog" aria-label="主机清单">
					<ul className="host-list">
						<li className={activeEndpoint === localEndpoint ? "host-row is-on" : "host-row"}>
							<button type="button" className="host-main" onClick={() => onConnect(localEndpoint)}>
								<i className={activeEndpoint === localEndpoint && isOnline ? "dot" : "dot is-off"} />
								<span className="host-name">{localName}</span>
								<span className="host-addr mono">{endpointLabel(localEndpoint)}</span>
							</button>
						</li>
						{hosts.map((host) => (
							<li key={host.id} className={activeEndpoint === host.endpoint ? "host-row is-on" : "host-row"}>
								<button type="button" className="host-main" onClick={() => onConnect(host.endpoint)}>
									<i className={activeEndpoint === host.endpoint && isOnline ? "dot" : "dot is-off"} />
									<span className="host-name">{host.name}</span>
									<span className="host-addr mono">{endpointLabel(host.endpoint)}</span>
								</button>
								<button
									type="button"
									className="host-remove"
									aria-label={`删除主机 ${host.name}`}
									title="从清单里删除"
									onClick={() => onRemoveHost(host.id)}
								>
									<Settings2 size={12} strokeWidth={1.5} />
								</button>
							</li>
						))}
					</ul>
					{isAdding ? (
						<form className="host-form" onSubmit={submit}>
							<input
								className="set-input"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="名字，留空取地址"
								aria-label="主机名字"
							/>
							<input
								className="set-input mono"
								value={address}
								onChange={(event) => setAddress(event.target.value)}
								placeholder="user@host 或 host:port"
								aria-label="主机地址"
								ref={addressRef}
							/>
							{error === undefined ? null : <p className="host-error">{error}</p>}
							<div className="host-form-actions">
								<button type="submit" className="set-save">
									添加
								</button>
								<button
									type="button"
									className="set-reset"
									onClick={() => {
										setIsAdding(false);
										setError(undefined);
									}}
								>
									取消
								</button>
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
							<Plus size={13} strokeWidth={1.5} />
							添加主机
						</button>
					)}
					<div className="host-foot">
						<label className="host-check">
							<input
								type="checkbox"
								checked={keepOnClose}
								onChange={(event) => onToggleKeepOnClose(event.target.checked)}
							/>
							关掉窗口后继续运行
						</label>
						{isConfirming ? (
							<div className="host-confirm">
								<span>结束主机会停掉上面正在跑的任务。</span>
								<div className="host-confirm-actions">
									<button
										type="button"
										className="host-danger"
										onClick={() => {
											setIsConfirming(false);
											setShutdownError(undefined);
											void onShutdownHost().then((failure) => setShutdownError(failure));
										}}
									>
										确认结束
									</button>
									<button type="button" className="set-reset" onClick={() => setIsConfirming(false)}>
										取消
									</button>
								</div>
							</div>
						) : (
							<button
								type="button"
								className="host-shutdown"
								disabled={!isOnline}
								onClick={() => {
									setIsConfirming(true);
									setShutdownError(undefined);
								}}
							>
								结束主机
							</button>
						)}
						{shutdownError === undefined ? null : <p className="host-error">{shutdownError}</p>}
					</div>
				</div>
			) : null}
		</div>
	);
}
