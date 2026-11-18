/**
 * 终端面板。
 *
 * 持有主机上的终端清单、开与关的动作、以及 xterm 需要的那份外观；标签本身留在主区域
 * 那一层，这里只通过传进来的标签动作推动，不反向依赖它。
 */
import type { TerminalClient } from "@facet/client-core";
import type { TerminalInfo } from "@facet/protocol";
import type { TerminalAppearance } from "@facet/ui-terminal";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * 读一份终端外观。
 *
 * 字体与字号是 CSS 变量，xterm 只吃具体值，所以每次外观变化都要重新读一次计算样式；
 * 主题切换时前景、光标与选区色也跟着变，一并重读。
 */
function readTerminalAppearance(): TerminalAppearance {
	const styles = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
	/**
	 * 把变量解析成具体颜色。
	 *
	 * 滚动条的颜色变量本身是 `color-mix(...)` 或 `var(...)`，xterm 只接受能解析的颜色，
	 * 所以借一个隐藏元素让浏览器先算一遍，再读计算值。
	 */
	const resolve = (value: string): string => {
		const probe = document.createElement("span");
		probe.style.color = value;
		probe.style.display = "none";
		document.body.appendChild(probe);
		const resolved = getComputedStyle(probe).color;
		probe.remove();
		return resolved;
	};
	return {
		fontFamily: read("--font-terminal", "ui-monospace, monospace"),
		fontSize: Number.parseFloat(read("--terminal-size", "12.5")),
		lineHeight: 1.35,
		cursorBlink: true,
		scrollback: 5000,
		foreground: read("--t1", "#1a1a1e"),
		cursor: read("--acc", "#239956"),
		selection: read("--surface3", "#e4e4e7"),
		// 与界面其它滚动容器同一份宽度与配色
		scrollbarWidth: Number.parseFloat(read("--scrollbar-width", "8")),
		scrollbarThumb: resolve(read("--scrollbar-thumb-color", "rgba(161,161,170,0.4)")),
		scrollbarThumbHover: resolve(read("--scrollbar-thumb-color-hover", "#71717a")),
	};
}

export interface TerminalPanelOptions {
	/** 终端客户端 */
	client: TerminalClient;
	/** 主机有没有终端能力 */
	canUseTerminal: boolean;
	/** 新建终端的启动目录 */
	cwd: string | undefined;
	/** 第几次连接就绪；变化时重取清单 */
	connectEpoch: number;
}

export interface TerminalPanel {
	/** 主机上的终端清单，含已结束的 */
	terminals: readonly TerminalInfo[];
	/** 本端关掉的终端，避免清单还没刷新时又补回标签 */
	closedTerminalIds: RefObject<Set<string>>;
	/** 开终端失败的原因 */
	terminalError: string | undefined;
	/** 终端外观，跟着界面配色与等宽字体走 */
	appearance: TerminalAppearance;
	/** 在当前目录开一个终端，成功时返回它的信息 */
	openTerminal: () => Promise<TerminalInfo | undefined>;
	/** 关掉一个终端，进程与清单一起收尾 */
	closeTerminal: (terminalId: string) => Promise<void>;
	/** 重新取终端清单 */
	refreshTerminals: () => Promise<readonly TerminalInfo[]>;
	/** 清掉开终端失败的原因 */
	clearError: () => void;
}

export function useTerminalPanel(options: TerminalPanelOptions): TerminalPanel {
	const { client, canUseTerminal, cwd, connectEpoch } = options;
	const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
	const [terminalError, setTerminalError] = useState<string | undefined>(undefined);
	const [appearance, setAppearance] = useState<TerminalAppearance>(readTerminalAppearance);
	const closedTerminalIds = useRef(new Set<string>());

	/** 重新取终端清单。连不上或主机没有终端能力时按空处理。 */
	const refreshTerminals = useCallback(async (): Promise<readonly TerminalInfo[]> => {
		try {
			const list = await client.list();
			setTerminals(list);
			return list;
		} catch {
			setTerminals([]);
			return [];
		}
	}, [client]);

	// 每次连上都重取一次：清单属于主机，换连接之后旧的不算数
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在连接就绪时重取，刷新函数不必列入
	useEffect(() => {
		if (connectEpoch === 0) {
			return;
		}
		closedTerminalIds.current.clear();
		void refreshTerminals();
	}, [connectEpoch]);

	// 首次渲染时外观变量可能还没写到根节点上，挂载后补读一次
	useEffect(() => {
		setAppearance(readTerminalAppearance());
	}, []);

	// 外观变化（含设置页里的预览）后重读终端那份计算样式
	useEffect(() => {
		const onAppearance = (): void => setAppearance(readTerminalAppearance());
		window.addEventListener("facet:appearance-changed", onAppearance);
		return () => window.removeEventListener("facet:appearance-changed", onAppearance);
	}, []);

	/** 在当前目录开一个终端；成功时把它的信息交回去，由上层摆标签。 */
	const openTerminal = useCallback(async (): Promise<TerminalInfo | undefined> => {
		if (!canUseTerminal) {
			return undefined;
		}
		setTerminalError(undefined);
		try {
			// 尺寸先给一个常用值，视图挂上之后 fit 出来的真实尺寸会再报一次
			const info = await client.create(cwd, 100, 24);
			await refreshTerminals();
			return info;
		} catch (error) {
			setTerminalError(error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}, [canUseTerminal, client, cwd, refreshTerminals]);

	/** 关掉一个终端，进程与清单一起收尾。 */
	const closeTerminal = useCallback(
		async (terminalId: string): Promise<void> => {
			closedTerminalIds.current.add(terminalId);
			try {
				await client.kill(terminalId);
			} catch {
				// 已经结束的终端再关一次没有影响
			}
			await refreshTerminals();
		},
		[client, refreshTerminals],
	);

	const clearError = useCallback(() => setTerminalError(undefined), []);

	return {
		terminals,
		closedTerminalIds,
		terminalError,
		appearance,
		openTerminal,
		closeTerminal,
		refreshTerminals,
		clearError,
	};
}
