/**
 * 主机切换。
 *
 * 页脚一个服务器图标按钮，点开是主机清单：本机永远在最上面，下面是用户添加过的远程主机；
 * 每行显示状态点、名字与地址，当前连着的那台高亮。清单底部是「添加主机」，展开一个填名字与
 * 地址的小表单。
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
}: HostSwitcherProps): ReactNode {
	const [isOpen, setIsOpen] = useState(false);
	const [isAdding, setIsAdding] = useState(false);
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
								placeholder="host:port 或 ws://host:port/endpoint"
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
