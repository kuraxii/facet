/**
 * xterm 视图。
 *
 * 一个组件对应一个终端：挂载时取回滚写进去，之后主机推来的输出直接写；键盘输入按字符流
 * 送回主机；容器尺寸变化时重新 fit 并把新尺寸同步过去。切到别的终端时整个组件卸载，
 * 回来重新挂载并重取回滚，避免为每个标签各留一个 xterm 实例。
 */

import type { TerminalClient } from "@facet/client-core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

/** 终端外观。跟着界面配色与设置走。 */
export interface TerminalAppearance {
	/** 字体族 */
	fontFamily: string;
	/** 字号 */
	fontSize: number;
	/** 行高倍数 */
	lineHeight: number;
	/** 光标是否闪烁 */
	cursorBlink: boolean;
	/** 回滚行数 */
	scrollback: number;
	/** 背景色 */
	background: string;
	/** 前景色 */
	foreground: string;
	/** 光标色 */
	cursor: string;
	/** 选区底色 */
	selection: string;
}

export interface TerminalViewProps {
	/** 终端标识 */
	terminalId: string;
	/** 终端客户端 */
	client: TerminalClient;
	/** 外观 */
	appearance: TerminalAppearance;
	/** 进程结束后要不要留在面板里；由宿主决定收起还是提示 */
	onExit?: (code: number) => void;
	/** 终端被别的端关掉 */
	onClosed?: () => void;
}

export function TerminalView({
	terminalId,
	client,
	appearance,
	onExit,
	onClosed,
}: TerminalViewProps): React.JSX.Element {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const callbacksRef = useRef({ onExit, onClosed });
	callbacksRef.current = { onExit, onClosed };

	// 实例只在换终端时重建：字体与配色改了就地更新，不动已有内容
	// biome-ignore lint/correctness/useExhaustiveDependencies: 外观走单独的 effect，重建实例会丢掉回滚
	useEffect(() => {
		const container = containerRef.current;
		if (container === null) {
			return;
		}
		const terminal = new Terminal({
			fontFamily: appearance.fontFamily,
			fontSize: appearance.fontSize,
			lineHeight: appearance.lineHeight,
			cursorBlink: appearance.cursorBlink,
			scrollback: appearance.scrollback,
			theme: {
				background: appearance.background,
				foreground: appearance.foreground,
				cursor: appearance.cursor,
				selectionBackground: appearance.selection,
			},
			allowProposedApi: true,
			convertEol: false,
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(container);
		termRef.current = terminal;
		fitRef.current = fit;
		fit.fit();

		let disposed = false;
		const input = terminal.onData((data) => {
			client.write(terminalId, data);
		});
		// 挂载：先取回滚再收增量，两段之间到达的输出落在增量里，不丢不重
		void client
			.attach(terminalId, {
				onData: (text) => {
					terminal.write(text);
				},
				onExit: (exit) => {
					terminal.write(`\r\n\x1b[2m[进程已退出，退出码 ${exit.exitCode}]\x1b[0m\r\n`);
					callbacksRef.current.onExit?.(exit.exitCode);
				},
				onResized: (cols, rows) => {
					if (cols !== terminal.cols || rows !== terminal.rows) {
						terminal.resize(cols, rows);
					}
				},
				onClosed: () => {
					callbacksRef.current.onClosed?.();
				},
			})
			.then((attached) => {
				if (disposed) {
					return;
				}
				if (attached.text.length > 0) {
					terminal.write(attached.text);
				}
				// 把界面这边 fit 出来的尺寸报给主机，让 shell 的窗口大小跟面板一致
				client.resize(terminalId, terminal.cols, terminal.rows);
			})
			.catch((error: unknown) => {
				terminal.write(
					`\r\n\x1b[31m终端挂载失败：${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`,
				);
			});

		const observer = new ResizeObserver(() => {
			try {
				fit.fit();
			} catch {
				// 容器暂时没有尺寸时 fit 会抛，等下一次观察再试
				return;
			}
			client.resize(terminalId, terminal.cols, terminal.rows);
		});
		observer.observe(container);

		return () => {
			disposed = true;
			observer.disconnect();
			input.dispose();
			void client.detach(terminalId).catch(() => undefined);
			terminal.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, [terminalId, client]);

	// 外观就地更新，不动已有内容
	useEffect(() => {
		const terminal = termRef.current;
		if (terminal === null) {
			return;
		}
		terminal.options.fontFamily = appearance.fontFamily;
		terminal.options.fontSize = appearance.fontSize;
		terminal.options.lineHeight = appearance.lineHeight;
		terminal.options.cursorBlink = appearance.cursorBlink;
		terminal.options.theme = {
			background: appearance.background,
			foreground: appearance.foreground,
			cursor: appearance.cursor,
			selectionBackground: appearance.selection,
		};
		try {
			fitRef.current?.fit();
		} catch {
			// 尺寸没变时 fit 会抛，忽略
		}
	}, [appearance]);

	return <div className="term-surface" ref={containerRef} />;
}
