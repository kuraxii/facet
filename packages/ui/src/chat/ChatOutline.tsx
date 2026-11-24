/**
 * 对话导航的竖轨。
 *
 * 贴在主区右缘，每条用户消息一根短条。当前轮次加长、颜色提亮；指针附近的几根按距离
 * 放大，悬浮时在左侧给出那一条的开头，点一下跳到那一条。
 *
 * 只在"没有可跳的条目"时不画（见 `outlineIsActive`）：位置由三列网格的右轨
 * （`--outline-slot`）保证，与窗口宽度无关，窄屏也不隐藏、不与正文重叠。
 *
 * 位置与跳转都走面板给的定位接口（`TranscriptViewport`）：正文按行虚拟化之后，绝大多数
 * 用户消息根本没有挂载，量不到 DOM；接口能给出每一行的虚拟坐标，跳转也交给它去做。
 */

import type { TranscriptItem } from "@facet/client-core";
import type { CSSProperties, RefObject } from "react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import type { TranscriptViewport } from "../transcript/use-virtual-transcript.ts";
import {
	ACTIVE_OFFSET,
	activeOutlineIndex,
	createOutlineHoverIntent,
	OUTLINE_MAGNIFY_RADIUS,
	outlineIsActive,
	outlinePrompts,
	outlineTickMagnification,
} from "./chat-outline.ts";

export interface ChatOutlineProps {
	/** 渲染单元，只取其中的用户消息 */
	items: readonly TranscriptItem[];
	/** 正文所在的滚动容器：只用来听滚动与尺寸变化 */
	container: HTMLElement | null;
	/** 面板的定位接口：给每一行的位置，也接手跳转 */
	viewport: RefObject<TranscriptViewport | null>;
}

export function ChatOutline({ items, container, viewport }: ChatOutlineProps) {
	const { t } = useI18n();
	const prompts = useMemo(
		() => outlinePrompts(items, (index) => t("outline.fallback", { index })),
		[items, t],
	);
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const [attentionIndex, setAttentionIndex] = useState<number | null>(null);

	/** 按滚动位置算出当前读到的轮次。 */
	const measure = useCallback(() => {
		const api = viewport.current;
		if (api === null || prompts.length === 0) {
			setActiveIndex(null);
			return;
		}
		// 行没挂载也能拿到位置：接口按虚拟坐标给，不在视口里的行同样是准的
		const tops = prompts.map((prompt) => api.offsetOf(prompt.key) ?? Number.POSITIVE_INFINITY);
		setActiveIndex(activeOutlineIndex(tops, ACTIVE_OFFSET));
	}, [prompts, viewport]);

	/*
	 * 滚动与尺寸变化时重算当前轮次。逐帧测量比按滚动事件直接算重一点，用 rAF 收一收。
	 * 首次测量走 `useLayoutEffect`：换会话时面板整份重挂，若等绘制完再量，第一帧会先画成
	 * "没有高亮"或上一轮的旧位置，看着就是从上面闪一下再落到下面。
	 */
	useLayoutEffect(() => {
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

	/** 跳到一条消息：交给面板的定位接口，留白由它按同一份口径给。 */
	const jumpTo = useCallback(
		(key: string) => {
			viewport.current?.jumpTo(key);
		},
		[viewport],
	);

	// 唯一的隐藏条件：没有可跳的条目。宽度由网格兜着，不参与判断
	if (!outlineIsActive(prompts)) {
		return null;
	}

	return (
		<div className="outline">
			<div
				className="outline-rail"
				role="tablist"
				aria-label={t("outline.nav")}
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
								aria-label={t("outline.item", {
									index: index + 1,
									count: prompts.length,
									preview: prompt.preview,
								})}
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
