/**
 * 对话导航的竖轨。
 *
 * 贴在主区域左缘，每条用户消息一根短条。当前轮次加长、颜色提亮；指针附近的几根按距离
 * 放大，悬浮时在旁边给出那一条的开头，点一下跳到那一条。条数太少或主区域太窄时不显示。
 */

import type { TranscriptItem } from "@facet/client-core";
import type { CSSProperties } from "react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	activeOutlineIndex,
	createOutlineHoverIntent,
	OUTLINE_MAGNIFY_RADIUS,
	outlinePrompts,
	outlineTickMagnification,
} from "./chat-outline.ts";

/**
 * 竖轨的最小可用宽度。
 *
 * 正文列最宽 780px，居中之后左右各留 (宽 - 780) / 2；这段留白要放得下竖轨的间距加轨宽，
 * 短条才不会压到正文上：780 + 2 × (10 + 36) = 872，向上取整到 880。
 */
const MIN_HOST_WIDTH = 880;

/** 跳转后这条消息距视口上沿留多少像素，避免贴着顶部。 */
const JUMP_OFFSET = 12;

/** 判断当前轮次时，视口上沿再往下算多少像素。 */
const ACTIVE_OFFSET = 32;

export interface ChatOutlineProps {
	/** 渲染单元，只取其中的用户消息 */
	items: readonly TranscriptItem[];
	/** 正文所在的滚动容器，用来定位与跳转 */
	container: HTMLElement | null;
}

/** 量一个锚点相对滚动容器上沿的偏移。 */
function offsetInContainer(element: Element, container: HTMLElement): number {
	return element.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

export function ChatOutline({ items, container }: ChatOutlineProps) {
	const prompts = useMemo(() => outlinePrompts(items), [items]);
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const [attentionIndex, setAttentionIndex] = useState<number | null>(null);
	const [isNarrow, setIsNarrow] = useState(false);
	const railRef = useRef<HTMLDivElement>(null);

	/** 取一条消息对应的正文行。 */
	const anchorOf = useCallback(
		(key: string): Element | null =>
			container === null ? null : container.querySelector(`[data-outline-key="${CSS.escape(key)}"]`),
		[container],
	);

	/** 按滚动位置算出当前读到的轮次。 */
	const measure = useCallback(() => {
		if (container === null || prompts.length === 0) {
			setActiveIndex(null);
			return;
		}
		const tops = prompts.map((prompt) => {
			const anchor = anchorOf(prompt.key);
			return anchor === null ? Number.POSITIVE_INFINITY : offsetInContainer(anchor, container);
		});
		setActiveIndex(activeOutlineIndex(tops, ACTIVE_OFFSET));
	}, [anchorOf, container, prompts]);

	// 滚动与尺寸变化时重算当前轮次。逐帧测量比按滚动事件直接算重一点，用 rAF 收一收。
	useEffect(() => {
		if (container === null) {
			return;
		}
		let frame = 0;
		const schedule = (): void => {
			if (frame !== 0) {
				return;
			}
			frame = requestAnimationFrame(() => {
				frame = 0;
				measure();
			});
		};
		measure();
		container.addEventListener("scroll", schedule, { passive: true });
		const observer = new ResizeObserver(schedule);
		observer.observe(container);
		const content = container.firstElementChild;
		if (content !== null) {
			observer.observe(content);
		}
		return () => {
			if (frame !== 0) {
				cancelAnimationFrame(frame);
			}
			container.removeEventListener("scroll", schedule);
			observer.disconnect();
		};
	}, [container, measure]);

	// 主区域太窄时不显示：居中正文两侧没有留白，竖轨会压到正文上
	useEffect(() => {
		const host = railRef.current?.parentElement;
		if (host === null || host === undefined) {
			return;
		}
		const observer = new ResizeObserver(() => setIsNarrow(host.clientWidth < MIN_HOST_WIDTH));
		observer.observe(host);
		setIsNarrow(host.clientWidth < MIN_HOST_WIDTH);
		return () => observer.disconnect();
	}, []);

	const hoverIntent = useMemo(
		() =>
			createOutlineHoverIntent({
				activate: setAttentionIndex,
				schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
				cancel: (timerId) => window.clearTimeout(timerId),
			}),
		[],
	);
	useEffect(() => () => hoverIntent.dispose(), [hoverIntent]);

	const handleRailEnter = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			hoverIntent.enter({ x: event.clientX, y: event.clientY });
		},
		[hoverIntent],
	);
	const handleRailMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			hoverIntent.move({ x: event.clientX, y: event.clientY });
		},
		[hoverIntent],
	);
	const handleRailLeave = useCallback(() => hoverIntent.leave(), [hoverIntent]);

	/** 跳到一条消息：滚到它的顶部，留一点空隙。 */
	const jumpTo = useCallback(
		(key: string) => {
			const anchor = anchorOf(key);
			const scroll = container;
			if (anchor === null || scroll === null) {
				return;
			}
			scroll.scrollTo({
				top: scroll.scrollTop + offsetInContainer(anchor, scroll) - JUMP_OFFSET,
				behavior: "smooth",
			});
		},
		[anchorOf, container],
	);

	if (prompts.length < 2 || isNarrow) {
		return null;
	}

	return (
		<div className="outline" ref={railRef}>
			<div
				className="outline-rail"
				role="tablist"
				aria-label="对话导航"
				aria-orientation="vertical"
				onPointerEnter={handleRailEnter}
				onPointerMove={handleRailMove}
				onPointerLeave={handleRailLeave}
			>
				{prompts.map((prompt, index) => {
					const isActive = index === activeIndex;
					const hasAttention = index === attentionIndex;
					const magnification =
						attentionIndex === null ? 0 : outlineTickMagnification(index - attentionIndex);
					return (
						<div className="outline-slot" key={prompt.key}>
							<button
								type="button"
								className="outline-tick"
								role="tab"
								aria-selected={isActive}
								aria-label={`第 ${index + 1} 条，共 ${prompts.length} 条：${prompt.preview}`}
								data-magnify={magnification.toFixed(3)}
								onPointerEnter={() => hoverIntent.pointAt(index)}
								onFocus={() => setAttentionIndex(index)}
								onBlur={() => setAttentionIndex((current) => (current === index ? null : current))}
								onClick={() => jumpTo(prompt.key)}
							>
								<i
									className={
										hasAttention
											? "outline-pill is-attention"
											: isActive
												? "outline-pill is-active"
												: "outline-pill"
									}
									style={
										// 放大只改短条的宽高，槽位尺寸不动，指针不会把目标推走；
										// 基准宽度、加宽倍数与放大步长都在样式表的变量里
										{ "--outline-grow": magnification.toFixed(3) } as CSSProperties
									}
								/>
							</button>
							{hasAttention ? (
								<div className="outline-preview" aria-hidden="true">
									<p className="outline-preview-text">{prompt.preview}</p>
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

export type { OutlinePrompt } from "./chat-outline.ts";
export { OUTLINE_MAGNIFY_RADIUS };
