/**
 * 主机切换。
 *
 * 页脚一个服务器图标按钮，点开是主机清单：本机永远在最上面，下面是用户添加过的远程主机；
 * 每行显示状态点、名字与地址，当前连着的那台高亮；清单底部是「添加主机」，展开一个填名字与
 * 地址的小表单。
 */
import { Check, Pencil, Plus, Server, Settings2, X } from "lucide-react";
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
	/** 是否正在自动重连 */
	isReconnecting: boolean;
	/** 连到某个端点 */
	onConnect: (endpoint: string) => void;
	/** 添加一台主机；端点重复时返回原因 */
	onAddHost: (name: string, endpoint: string) => string | undefined;
	/** 删除一台远程主机 */
	onRemoveHost: (id: string) => void;
	/** 改一台远程主机的名字 */
	onRenameHost: (id: string, name: string) => void;
}

export function HostSwitcher({
	localEndpoint,
	localName,
	activeEndpoint,
	hosts,
	isOnline,
	isReconnecting,
	onConnect,
	onAddHost,
	onRemoveHost,
	onRenameHost,
}: HostSwitcherProps): ReactNode {
	const [isOpen, setIsOpen] = useState(false);
	const [isAdding, setIsAdding] = useState(false);
	/** 正在改名的主机与草稿 */
	const [renaming, setRenaming] = useState<{ id: string; draft: string } | undefined>(undefined);
	/** 改名输入框，展开时把焦点送过去 */
	const renameRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (renaming !== undefined) {
			renameRef.current?.focus();
			renameRef.current?.select();
		}
	}, [renaming]);
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
		setError(undefined);
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
								<span className="host-addr mono">
									{activeEndpoint === localEndpoint && isReconnecting
										? "重连中"
										: endpointLabel(localEndpoint)}
								</span>
							</button>
						</li>
						{hosts.map((host) =>
							renaming?.id === host.id ? (
								<li key={host.id} className="host-row is-editing">
									<input
										className="set-input host-rename"
										aria-label="新的主机名字"
										value={renaming.draft}
										ref={renameRef}
										onChange={(event) => setRenaming({ id: host.id, draft: event.target.value })}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												onRenameHost(host.id, renaming.draft);
												setRenaming(undefined);
											} else if (event.key === "Escape") {
												setRenaming(undefined);
											}
										}}
									/>
									<button
										type="button"
										className="host-remove"
										aria-label="保存名字"
										title="保存"
										onClick={() => {
											onRenameHost(host.id, renaming.draft);
											setRenaming(undefined);
										}}
									>
										<Check size={12} strokeWidth={1.5} />
									</button>
									<button
										type="button"
										className="host-remove"
										aria-label="取消改名"
										title="取消"
										onClick={() => setRenaming(undefined)}
									>
										<X size={12} strokeWidth={1.5} />
									</button>
								</li>
							) : (
								<li
									key={host.id}
									className={activeEndpoint === host.endpoint ? "host-row is-on" : "host-row"}
								>
									<button type="button" className="host-main" onClick={() => onConnect(host.endpoint)}>
										<i className={activeEndpoint === host.endpoint && isOnline ? "dot" : "dot is-off"} />
										<span className="host-name">{host.name}</span>
										<span className="host-addr mono">
											{activeEndpoint === host.endpoint && isReconnecting
												? "重连中"
												: endpointLabel(host.endpoint)}
										</span>
									</button>
									<button
										type="button"
										className="host-remove"
										aria-label={`给主机 ${host.name} 改名`}
										title="改名"
										onClick={() => setRenaming({ id: host.id, draft: host.name })}
									>
										<Pencil size={12} strokeWidth={1.5} />
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
							),
						)}
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
				</div>
			) : null}
		</div>
	);
}
