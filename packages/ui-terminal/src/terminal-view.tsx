/**
 * xterm 视图。
 *
 * 一个组件对应一个终端：挂载时取回滚写进去，之后主机推来的输出直接写；键盘输入按字符流
 * 送回主机；容器尺寸变化时重新 fit 并把新尺寸同步过去。切到别的终端时整个组件卸载，
 * 回来重新挂载并重取回滚，避免为每个标签各留一个 xterm 实例。
 *
 * 挂载后把焦点交给终端：打开面板或切标签都是重新挂载，键盘输入因此不用再点一次。
 */

import type { TerminalClient } from "@facet/client-core";
import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useImperativeHandle, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

/** 构造 xterm 6 主题配置：透出底层面板背景，并将 overviewRuler 描边设为透明避免右缘出现常驻白线。 */
export function buildXtermTheme(appearance: TerminalAppearance): ITheme {
	return {
		background: "rgba(0,0,0,0)",
		foreground: appearance.foreground,
		cursor: appearance.cursor,
		cursorAccent: appearance.cursorAccent,
		selectionBackground: appearance.selection,
		// overviewRuler 启用宽度后默认用 #ffffff 画 1px 左边线，显式置透明避免右缘出现常驻白线
		overviewRulerBorder: "rgba(0,0,0,0)",
		// xterm 把滑块色写进自己注入的样式表，因此这里只接受解析得出的具体颜色
		scrollbarSliderBackground: appearance.scrollbarThumb,
		scrollbarSliderHoverBackground: appearance.scrollbarThumbHover,
		scrollbarSliderActiveBackground: appearance.scrollbarThumbHover,
	};
}

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
	/** 前景色 */
	foreground: string;
	/** 光标色 */
	cursor: string;
	/** 光标内部字符的前景色 */
	cursorAccent?: string;
	/** 选区底色 */
	selection: string;
	/** 滚动条占的宽度，像素 */
	scrollbarWidth: number;
	/** 滚动条滑块的颜色 */
	scrollbarThumb: string;
	/** 指针落在滚动条或拖动时的颜色 */
	scrollbarThumbHover: string;
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
	/** 上层拿这个 ref 把焦点要回去：点已经选中的标签时用 */
	ref?: React.Ref<TerminalViewHandle>;
}

/** 上层能对终端做的事。 */
export interface TerminalViewHandle {
	/** 把焦点交给终端，让键盘输入直接落到 shell 上 */
	focus(): void;
}

export function TerminalView({
	terminalId,
	client,
	appearance,
	onExit,
	onClosed,
	ref,
}: TerminalViewProps): React.JSX.Element {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const callbacksRef = useRef({ onExit, onClosed });
	callbacksRef.current = { onExit, onClosed };

	useImperativeHandle(
		ref,
		() => ({
			focus: () => {
				termRef.current?.focus();
			},
		}),
		[],
	);

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
			// 终端不铺自己的底色，透出界面背景；xterm 只有打开透明选项才接受透明主题
			allowTransparency: true,
			/*
			 * xterm 自己画滚动条（`.xterm-scrollable-element` 里的 `.slider`），宽度取自
			 * `overviewRuler.width`，缺省 14px——比界面那套 8px 宽，所以这里按界面的宽度给，
			 * 颜色也换成界面用的两个变量，两处观感才一致。原生 `::-webkit-scrollbar` 对它无效。
			 */
			overviewRuler: { width: appearance.scrollbarWidth },
			theme: buildXtermTheme(appearance),
			allowProposedApi: true,
			convertEol: false,
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(container);
		termRef.current = terminal;
		fitRef.current = fit;
		fit.fit();
		// 挂载即聚焦：打开面板与切标签都会走到这里
		terminal.focus();

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
		terminal.options.overviewRuler = { width: appearance.scrollbarWidth };
		terminal.options.theme = buildXtermTheme(appearance);
		try {
			fitRef.current?.fit();
		} catch {
			// 尺寸没变时 fit 会抛，忽略
		}
	}, [appearance]);

	// 窗口 zoom 改变时字符网格的物理宽度会变，显式再 fit 一次并同步主机的行列数
	useEffect(() => {
		const onZoom = (): void => {
			const terminal = termRef.current;
			if (terminal === null) return;
			try {
				fitRef.current?.fit();
				client.resize(terminalId, terminal.cols, terminal.rows);
			} catch {
				// 容器暂时没有尺寸时等下一次事件或 ResizeObserver
			}
		};
		window.addEventListener("facet:zoom-changed", onZoom);
		return () => window.removeEventListener("facet:zoom-changed", onZoom);
	}, [client, terminalId]);

	return <div className="term-surface" ref={containerRef} />;
}
