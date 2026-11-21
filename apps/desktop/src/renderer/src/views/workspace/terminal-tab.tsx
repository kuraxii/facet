/**
 * 终端标签。
 *
 * **唯一**靠显隐保活的标签：切走时它只是不占位置，域名里的 `TerminalView` 一直挂着，
 * PTY 会话与回滚都留着；只有关掉标签才真的卸载（外壳在那一刻同时结束终端）。
 */
import { TerminalView, type TerminalViewHandle } from "@facet/ui-terminal";
import { type ReactNode, useEffect, useRef } from "react";
import type { TerminalPanel } from "../../hooks/useTerminalPanel.ts";
import { useHostTerminalClient } from "../../host-context.tsx";

/** 终端标签的参数。 */
export interface TerminalTabProps {
	/** 终端域 */
	terminal: TerminalPanel;
	/** 要显示的那个终端；主机上没有终端时为空 */
	terminalId: string | undefined;
	/** 是不是当前激活的标签 */
	isActive: boolean;
}

/** 终端标签。 */
export function TerminalTab({ terminal, terminalId, isActive }: TerminalTabProps): ReactNode {
	const terminalClient = useHostTerminalClient();
	const view = useRef<TerminalViewHandle | null>(null);

	/*
	 * 切回终端就把焦点交给它。
	 *
	 * 终端是保活的，切走再切回来不会重新挂载，`TerminalView` 挂载时那次聚焦也就不会发生；
	 * 面板宽度变化同理，尺寸由它自己的 `ResizeObserver` 重算，这里只管焦点。
	 */
	useEffect(() => {
		if (isActive) {
			view.current?.focus();
		}
	}, [isActive]);

	if (terminalId === undefined) {
		return null;
	}
	return (
		<div className="workspace-term">
			<TerminalView
				key={terminalId}
				ref={view}
				terminalId={terminalId}
				client={terminalClient}
				appearance={terminal.appearance}
			/>
		</div>
	);
}
