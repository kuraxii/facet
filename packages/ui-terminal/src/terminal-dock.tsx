/**
 * 底部终端面板。
 *
 * 只挂载当前标签的 xterm 视图：切到别的终端时卸载它并重新挂载，回滚由主机重新给一份。
 * 头一行是标签与操作，上缘一条分隔条拖动改高度，收起时不占位置。
 */
import type { TerminalClient } from "@facet/client-core";
import type { TerminalInfo } from "@facet/protocol";
import { Plus, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { clampDockHeight } from "./dock-state.ts";
import { type TerminalAppearance, TerminalView } from "./terminal-view.tsx";

export interface TerminalDockProps {
	/** 是否展开 */
	isOpen: boolean;
	/** 面板高度，单位 px */
	height: number;
	/** 主机上的终端清单，含已结束的 */
	terminals: TerminalInfo[];
	/** 当前标签 */
	activeId: string | undefined;
	/** 新建终端时的启动目录，为空时由主机用用户主目录 */
	cwd: string | undefined;
	/** 终端客户端 */
	client: TerminalClient;
	/** 外观 */
	appearance: TerminalAppearance;
	/** 收不起时给的说明，例如连的是只读档 */
	disabledReason?: string;
	onHeightChange: (height: number) => void;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onKill: (id: string) => void;
	onClose: () => void;
}

/** 标签上的名字：取启动目录的最后一段，同一台机器上开多个 shell 时好分辨。 */
function tabLabel(terminal: TerminalInfo): string {
	const parts = terminal.cwd.split("/").filter((part) => part.length > 0);
	return parts.at(-1) ?? terminal.shell;
}

/** 打开着的终端。已结束的留在标签里，方便回看输出。 */
function openTerminals(terminals: TerminalInfo[]): TerminalInfo[] {
	return terminals.filter((terminal) => !terminal.restored);
}

export function TerminalDock({
	isOpen,
	height,
	terminals,
	activeId,
	cwd,
	client,
	appearance,
	disabledReason,
	onHeightChange,
	onSelect,
	onCreate,
	onKill,
	onClose,
}: TerminalDockProps): React.JSX.Element | null {
	const tabs = openTerminals(terminals);
	const active = tabs.find((terminal) => terminal.id === activeId) ?? tabs[0];

	// 拖动上缘分隔条改高度
	const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			dragRef.current = { startY: event.clientY, startHeight: height };
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[height],
	);
	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			if (drag === null) {
				return;
			}
			// 往上拖变高，向下拖变矮
			onHeightChange(clampDockHeight(drag.startHeight + (drag.startY - event.clientY), window.innerHeight));
		},
		[onHeightChange],
	);
	const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		dragRef.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
	}, []);

	// 标签被别的端关掉之后，当前标签回到第一个
	useEffect(() => {
		if (active !== undefined && active.id !== activeId) {
			onSelect(active.id);
		}
	}, [active, activeId, onSelect]);

	if (!isOpen) {
		return null;
	}

	return (
		<section className="term-dock" style={{ height }} aria-label="终端面板">
			<hr
				className="term-dock-grip"
				aria-label="拖动调整终端高度"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			/>
			<header className="term-dock-head">
				<div className="term-dock-tabs" role="tablist">
					{tabs.map((terminal) => (
						<div key={terminal.id} className={terminal.id === active?.id ? "term-tab is-active" : "term-tab"}>
							<button
								type="button"
								role="tab"
								aria-selected={terminal.id === active?.id}
								className="term-tab-main"
								title={`${terminal.shell} · ${terminal.cwd}`}
								onClick={() => onSelect(terminal.id)}
							>
								<SquareTerminal size={13} strokeWidth={1.5} />
								<span className="term-tab-name">{tabLabel(terminal)}</span>
								{terminal.exit === null ? null : (
									<span className="term-tab-exit">{terminal.exit.exitCode}</span>
								)}
							</button>
							<button
								type="button"
								className="term-tab-close"
								aria-label={`关掉 ${tabLabel(terminal)}`}
								onClick={() => onKill(terminal.id)}
							>
								<X size={11} strokeWidth={1.6} />
							</button>
						</div>
					))}
				</div>
				<div className="term-dock-actions">
					<button
						type="button"
						className="term-tool"
						aria-label="新建终端"
						title={disabledReason ?? (cwd === undefined ? "在主机的主目录新建终端" : `在 ${cwd} 新建终端`)}
						disabled={disabledReason !== undefined}
						onClick={onCreate}
					>
						<Plus size={14} strokeWidth={1.6} />
					</button>
					<button type="button" className="term-tool" aria-label="收起终端" onClick={onClose}>
						<X size={14} strokeWidth={1.6} />
					</button>
				</div>
			</header>
			<div className="term-dock-body">
				{active === undefined ? (
					<p className="term-empty">{disabledReason ?? "还没有终端，点右上角的加号在当前目录开一个。"}</p>
				) : (
					<TerminalView key={active.id} terminalId={active.id} client={client} appearance={appearance} />
				)}
			</div>
		</section>
	);
}
