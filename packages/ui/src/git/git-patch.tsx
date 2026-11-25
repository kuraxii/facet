/**
 * 补丁正文。
 *
 * 变更页、提交详情与单文件补丁视图共用这一份：行号加一截内容，纵向按行铺开，横向默认不
 * 折行（走全仓的 `.scroll-x`，长代码行自己滚）。三处各写一遍的话，行号宽度与增删行配色
 * 迟早会分岔。
 *
 * 行按需挂载：滚动容器是外层那个统一滚动区（`changes-document` 的 `.docScroll`），本组件把
 * 自己的顶部偏移报给 `@tanstack/react-virtual` 作为 `scrollMargin`，于是八个文件共用一条滚动
 * 轴、每个文件只挂自己视口附近的那几十行。四千行的补丁从两万个元素降到几百个——拖分隔条
 * 改列宽时，样式重算与布局才不用扫过整棵树。
 *
 * 两条硬约束：
 * - **不**绑 `measureElement`：行高恒定，纯算术定位，零 ResizeObserver；
 * - 横向滚动条靠"最长行实测像素宽"撑画布：行绝对定位脱离文档流之后，`width: max-content`
 *   不再随子行变宽，画布得自己给出宽度。
 */

import type { GitDiff } from "@facet/protocol";
import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { lineClass, type PatchLine, patchBodyLines } from "../transcript/diff-lines.ts";
import styles from "./git.module.css";
import { type PinnedSpan, widestLineTexts, withPinnedSpan } from "./patch-virtual.ts";

/** 补丁正文的参数。 */
export interface GitPatchProps {
	/** 主机算好的补丁 */
	diff: GitDiff;
	/** 外层统一滚动容器；不给时按最近的 `.scroll-y` 祖先找 */
	scrollElement?: HTMLElement | null;
	/**
	 * 布局修订号。
	 *
	 * 上面某个文件展开/折叠、补丁懒加载完成之后，本补丁的顶部偏移就变了；由外层递增一次，
	 * 这里跟着重量一次 `scrollMargin`。
	 */
	layoutVersion?: number;
	/** 本补丁的高度变了（懒加载完成）时通知外层 */
	onLayoutChange?: () => void;
}

/** 视口外的预渲染行数：160Hz 快速滚轮也不至于先看到空白再来内容 */
const OVERSCAN = 16;

/** 拖选最多钉住多少行；再长（几万行全选）就只保两端，否则钉住等于放弃虚拟化 */
const PIN_CAP = 3000;

/** 量行高与最长行宽用的临时节点标识 */
const MEASURE_ATTR = "data-patch-measure";

/** 文本宽度测量用的离屏 Canvas，整页共用一份 */
let measureContext: CanvasRenderingContext2D | null = null;

/** 用当前字体量一段文本的像素宽。 */
function textWidth(text: string, font: string): number {
	if (measureContext === null) {
		measureContext = document.createElement("canvas").getContext("2d");
	}
	if (measureContext === null) {
		return 0;
	}
	measureContext.font = font;
	return measureContext.measureText(text).width;
}

/** 一行的四个格子。行号列与记号列不参与选择，复制出来的只有正文。 */
function LineCells({ line }: { line: PatchLine }): ReactNode {
	return (
		<>
			{/* 四列固定：旧行号、新行号、记号、正文。增删行缺的那一格留空，但列宽不塌 */}
			<span className={styles.lineNumber}>{line.oldNumber}</span>
			<span className={styles.lineNumber}>{line.newNumber}</span>
			<span className={styles.lineSign}>{line.sign}</span>
			<span className={styles.lineText}>{line.text}</span>
		</>
	);
}

/** 补丁正文；二进制、没有改动与过长三种情况由这里给出说明。 */
export function GitPatch({
	diff,
	scrollElement,
	layoutVersion = 0,
	onLayoutChange,
}: GitPatchProps): ReactNode {
	const { t } = useI18n();
	// 解析跟着补丁文本走：父组件重渲不该把整段补丁重新拆一遍
	const lines = useMemo(() => patchBodyLines(diff.patch), [diff.patch]);
	const bodyRef = useRef<HTMLDivElement | null>(null);
	const hostRef = useRef<HTMLDivElement | null>(null);
	/** 外层滚动元素；宿主还没挂上时是 null，挂上后由 layout effect 补 */
	const [scroller, setScroller] = useState<HTMLElement | null>(scrollElement ?? null);
	/** 实测行高：正文不折行，行高恒定，定位是纯算术 */
	const [lineHeight, setLineHeight] = useState(0);
	/** 本补丁顶部相对滚动内容顶部的偏移 */
	const [scrollMargin, setScrollMargin] = useState(0);
	/** 画布的最小宽度：最长行实测像素 + 行号槽 + 右侧留白 */
	const [canvasWidth, setCanvasWidth] = useState(0);
	/** 拖选跨过的行，钉住不卸载 */
	const [pin, setPin] = useState<PinnedSpan | null>(null);
	const empty = lines.length === 0;

	// 外层没给滚动元素时按最近的 `.scroll-y` 祖先找；提交详情等单文件场景也就不用再传
	useLayoutEffect(() => {
		if (scrollElement !== undefined) {
			setScroller(scrollElement);
			return;
		}
		setScroller(hostRef.current?.closest<HTMLElement>(".scroll-y") ?? null);
	}, [scrollElement]);

	/*
	 * 量一次行高与最长行宽。
	 *
	 * 行高从样式里读（不写死魔数）：界面缩放、`--leading-code-block` 调档之后都跟着变。最长
	 * 行不用逐行 `measureText`，先按视觉列宽挑几个候选再实测——五千行全量量一遍要几万次调用。
	 */
	useLayoutEffect(() => {
		const body = bodyRef.current;
		if (body === null || empty) {
			return;
		}
		const style = getComputedStyle(body);
		const probe = document.createElement("div");
		probe.className = styles.diffLine ?? "";
		probe.setAttribute(MEASURE_ATTR, "");
		probe.style.position = "absolute";
		probe.style.visibility = "hidden";
		probe.style.width = "max-content";
		const cell = document.createElement("span");
		cell.className = styles.lineText ?? "";
		cell.textContent = "0";
		probe.append(cell);
		body.append(probe);
		const measured = probe.getBoundingClientRect().height;
		probe.remove();
		if (measured > 0) {
			setLineHeight((current) => (current === measured ? current : measured));
		}
		const gutter =
			Number.parseFloat(style.getPropertyValue("--diff-gutter-old")) +
			Number.parseFloat(style.getPropertyValue("--diff-gutter-new")) +
			Number.parseFloat(style.getPropertyValue("--diff-gutter-sign"));
		const tabSize = Number.parseFloat(style.tabSize) || 4;
		const candidates = widestLineTexts(lines, 3, tabSize);
		let widest = 0;
		for (const text of candidates) {
			widest = Math.max(widest, textWidth(text, style.font));
		}
		// 右侧那一格留白由 `.lineText` 的内边距给，量正文时补回来，长行滚到头才不贴边
		const padding = Number.parseFloat(style.getPropertyValue("--space-5")) || 0;
		const next = Math.ceil(widest + gutter + padding);
		setCanvasWidth((current) => (current === next ? current : next));
	}, [empty, lines]);

	/*
	 * 刷新顶部偏移与滚动元素。
	 *
	 * 只在挂载、`layoutVersion` 变化时量一次：滚动期间一帧都不碰 DOM，否则每帧一次
	 * `getBoundingClientRect` 足够把滚轮拖进 longtask。
	 */
	useLayoutEffect(() => {
		void layoutVersion;
		const body = bodyRef.current;
		if (body === null || scroller === null) {
			return;
		}
		const next = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
		setScrollMargin((current) => (current === next ? current : next));
	}, [layoutVersion, scroller]);

	// 补丁懒加载完成时告诉外层：下面的文件偏移都变了
	const loaded = useRef(false);
	useLayoutEffect(() => {
		if (empty || loaded.current) {
			return;
		}
		loaded.current = true;
		onLayoutChange?.();
	}, [empty, onLayoutChange]);

	/*
	 * 拖选钉行。
	 *
	 * 只认落在本补丁里的选区：选区伸到别的文件去时两端凑不齐，谁也不钉。
	 */
	useLayoutEffect(() => {
		const body = bodyRef.current;
		if (body === null) {
			return;
		}
		const indexOf = (node: Node | null): number | undefined => {
			if (node === null) {
				return undefined;
			}
			const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
			if (element === null || !body.contains(element)) {
				return undefined;
			}
			const value = element.closest<HTMLElement>("[data-patch-index]")?.dataset.patchIndex;
			return value === undefined ? undefined : Number(value);
		};
		const update = (): void => {
			const selection = document.getSelection();
			if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
				setPin(null);
				return;
			}
			const start = indexOf(selection.anchorNode);
			const end = indexOf(selection.focusNode);
			setPin(start === undefined || end === undefined || start === end ? null : { start, end });
		};
		document.addEventListener("selectionchange", update);
		return () => document.removeEventListener("selectionchange", update);
	}, []);

	const pinRef = useRef(pin);
	pinRef.current = pin;

	/** 钉住拖选覆盖的行：把它们并进这一帧要渲染的下标里 */
	const rangeExtractor = useCallback((range: Range): number[] => {
		return [...withPinnedSpan(defaultRangeExtractor(range), pinRef.current, PIN_CAP)];
	}, []);

	const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
		count: lines.length,
		getScrollElement: () => scroller,
		overscan: OVERSCAN,
		scrollMargin,
		estimateSize: () => lineHeight,
		// 正文不折行，行高恒定：不绑 measureElement，也就没有逐行的 ResizeObserver
		rangeExtractor,
	});

	const items = virtualizer.getVirtualItems();
	const total = Math.max(0, virtualizer.getTotalSize() - scrollMargin);

	if (diff.binary) {
		return <p className={styles.note}>{t("panel.binaryDiff")}</p>;
	}
	if (empty) {
		return <p className={styles.note}>{t("panel.noDiff")}</p>;
	}

	return (
		<div className={`scroll-x ${styles.diffBody}`} ref={hostRef}>
			<div
				className={styles.diffCanvas}
				ref={bodyRef}
				style={{
					height: total,
					minWidth: canvasWidth,
				}}
			>
				{items.map((item) => {
					const line = lines[item.index];
					if (line === undefined) {
						return null;
					}
					return (
						<div
							key={line.key}
							className={`${styles.diffLine ?? ""} ${lineClass(line.line)}`}
							data-sign={line.sign}
							data-patch-index={item.index}
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								transform: `translateY(${item.start - scrollMargin}px)`,
							}}
						>
							<LineCells line={line} />
						</div>
					);
				})}
			</div>
		</div>
	);
}
