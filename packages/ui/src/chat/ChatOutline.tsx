/**
 * 对话导航的竖轨。
 *
 * 贴在主区右缘，每条用户消息一根短条。当前轮次加长、颜色提亮；指针附近的几根按距离
 * 放大，悬浮时在左侧给出那一条的开头，点一下跳到那一条。
 *
 * 竖轨顶端另有一个「…」：滚到最上面，落定后补一页更早的历史。短条只管跳转，**补历史只有这一个
 * 入口**——滚到顶部本身不加载任何东西，所以跳转与滚动途中都不会冒出整页插入带来的长任务。
 *
 * 只在"没有可跳的条目"时不画（见 `outlineIsActive`）：位置由三列网格的右轨
 * （`--outline-slot`）保证，与窗口宽度无关，窄屏也不隐藏、不与正文重叠。
 */

import type { TranscriptItem } from "@facet/client-core";
import type { CSSProperties } from "react";
import {
	memo,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { measureStaleRows } from "../transcript/row-measure.ts";
import { markScrollSettling, whenScrollSettles } from "../transcript/scroll-settle.ts";
import {
	activeOutlineIndex,
	createOutlineHoverIntent,
	OUTLINE_MAGNIFY_RADIUS,
	type OutlinePrompt,
	outlineIsActive,
	outlinePrompts,
	outlineTickMagnification,
} from "./chat-outline.ts";

/** 跳转后这条消息距视口上沿留多少像素，避免贴着顶部。 */
const JUMP_OFFSET = 12;

/** 判断当前轮次时，视口上沿再往下算多少像素。 */
const ACTIVE_OFFSET = 32;

export interface ChatOutlineProps {
	/** 渲染单元，只取其中的用户消息 */
	items: readonly TranscriptItem[];
	/** 正文所在的滚动容器，用来定位与跳转 */
	container: HTMLElement | null;
	/** 还有没有更早的历史可补，决定顶端「…」是否可用 */
	canLoadOlder: boolean;
	/** 补一页更早的历史 */
	onLoadOlder: () => void;
}

/** 量一个锚点相对滚动容器上沿的偏移。 */
function offsetInContainer(element: Element, container: HTMLElement): number {
	return element.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

/** 一根短条要用到的东西：状态全是布尔与数字，回调由父层固定身份。 */
interface OutlineTickProps {
	/** 在整条竖轨里的序号，悬浮与聚焦回报的位置 */
	index: number;
	/** 这一条对应的导航键，点下去时交给定位接口 */
	promptKey: string;
	/** 无障碍名称，含序号、总数与预览文字 */
	label: string;
	/** 悬浮预览里显示的那一段开头 */
	preview: string;
	/** 当前读到的轮次 */
	isActive: boolean;
	/** 指针或焦点停在它上面 */
	hasAttention: boolean;
	/** 放大倍数，`outlineTickMagnification` 算出，不在半径内时为 0 */
	magnify: number;
	/** 点一下跳到这一条 */
	onSelect: (key: string) => void;
	/** 指针停在它上面 */
	onPointAt: (index: number) => void;
	onFocus: (index: number) => void;
	onBlur: (index: number) => void;
}

/**
 * 竖轨上的一根短条。
 *
 * 单独 `memo` 住：长会话里竖轨能有上百根，而滚动时 `activeIndex` 一直在变。不拆的话每次变化
 * 都要把整排重渲一遍；拆了之后一次只重渲旧激活项与新激活项（悬浮放大另算，只在半径内有变化）。
 */
const OutlineTick = memo(function OutlineTick({
	index,
	promptKey,
	label,
	preview,
	isActive,
	hasAttention,
	magnify,
	onSelect,
	onPointAt,
	onFocus,
	onBlur,
}: OutlineTickProps) {
	return (
		<div className="outline-slot">
			<button
				type="button"
				className="outline-tick"
				role="tab"
				aria-selected={isActive}
				aria-label={label}
				data-magnify={magnify.toFixed(3)}
				onPointerEnter={() => onPointAt(index)}
				onFocus={() => onFocus(index)}
				onBlur={() => onBlur(index)}
				onClick={() => onSelect(promptKey)}
			>
				<i
					className={
						hasAttention ? "outline-pill is-attention" : isActive ? "outline-pill is-active" : "outline-pill"
					}
					style={
						// 放大只改短条的宽高，槽位尺寸不动，指针不会把目标推走；
						// 基准宽度、加宽倍数与放大步长都在样式表的变量里
						{ "--outline-grow": magnify.toFixed(3) } as CSSProperties
					}
				/>
			</button>
			{hasAttention ? (
				<div className="outline-preview" aria-hidden="true">
					<p className="outline-preview-text">{preview}</p>
				</div>
			) : null}
		</div>
	);
});

export function ChatOutline({ items, container, canLoadOlder, onLoadOlder }: ChatOutlineProps) {
	const { t } = useI18n();
	const prompts = useMemo(
		() => outlinePrompts(items, (index) => t("outline.fallback", { index })),
		[items, t],
	);
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const [attentionIndex, setAttentionIndex] = useState<number | null>(null);

	/**
	 * 行元素缓存：导航键 → 正文行。
	 *
	 * 滚动里每帧都要按行量位置，逐帧 `querySelectorAll` 等于每帧把整棵正文树匹配一遍；条目只在
	 * 内容变了以后才会换，缓存住之后每帧只剩 O(1) 的查表。
	 */
	const anchorCache = useRef<{ prompts: readonly OutlinePrompt[]; byKey: Map<string, Element> }>({
		prompts: [],
		byKey: new Map(),
	});

	/** 重建缓存：一次 DOM 遍历，只在内容变了或查不到行时发生 */
	const rebuildAnchors = useCallback((): Map<string, Element> => {
		const byKey = new Map<string, Element>();
		if (container !== null) {
			for (const element of container.querySelectorAll("[data-outline-key]")) {
				const key = element.getAttribute("data-outline-key");
				if (key !== null) {
					byKey.set(key, element);
				}
			}
		}
		anchorCache.current = { prompts, byKey };
		return byKey;
	}, [container, prompts]);

	/**
	 * 取一条消息对应的正文行。
	 *
	 * 缓存没命中（行刚挂上、或换了一份内容）就重建一次再取；行已经脱离文档同样是失效的。
	 */
	const anchorOf = useCallback(
		(key: string): Element | null => {
			const cache = anchorCache.current;
			const hit = cache.prompts === prompts ? cache.byKey.get(key) : undefined;
			if (hit?.isConnected === true) {
				return hit;
			}
			return rebuildAnchors().get(key) ?? null;
		},
		[prompts, rebuildAnchors],
	);

	/** 按滚动位置算出当前读到的轮次。 */
	const measure = useCallback(() => {
		if (container === null || prompts.length === 0) {
			setActiveIndex(null);
			return;
		}
		/*
		 * 只读一次容器矩形，再按「行顶边随出现顺序单调递增」二分：每探一次才量一次。
		 * 原来是每条消息各做一次查询加两次矩形，20 条就是 20 次查询、40 次布局读，随会话长度线性增长。
		 */
		const containerTop = container.getBoundingClientRect().top;
		setActiveIndex(
			activeOutlineIndex(
				prompts.length,
				(index) => {
					const prompt = prompts[index];
					if (prompt === undefined) {
						return undefined;
					}
					const anchor = anchorOf(prompt.key);
					return anchor === null ? undefined : anchor.getBoundingClientRect().top - containerTop;
				},
				ACTIVE_OFFSET,
			),
		);
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
			/*
			 * 起跳前兜底量一次：宽度刚变过的话，之前写回的高度全是旧宽度的，落点会按错的文档高度
			 * 算。宽度没变时这里一行都不脏，只花一次查询的钱。
			 */
			measureStaleRows(scroll);
			// 平滑跳转要飞一段：这段时间里静默回收不该动手量视口
			markScrollSettling(scroll);
			scroll.scrollTo({
				top: scroll.scrollTop + offsetInContainer(anchor, scroll) - JUMP_OFFSET,
				behavior: "smooth",
			});
		},
		[anchorOf, container],
	);

	/** 等着补页的落定监听：再点一次或卸载时把上一次的撤掉，免得两次点击各补一页 */
	const cancelSettle = useRef<(() => void) | null>(null);
	useEffect(() => () => cancelSettle.current?.(), []);

	/**
	 * 到最顶部并补一页更早的历史。
	 *
	 * 先滚、落定后再插：插页是几十到两百毫秒的长任务，压在飞行轨迹上就是"跳着跳着卡一下"。
	 * 已经在顶部（没有可滚的距离，也就没有 `scrollend`）时直接补。
	 */
	const jumpToEarliest = useCallback(() => {
		const scroll = container;
		if (scroll === null) {
			return;
		}
		cancelSettle.current?.();
		if (scroll.scrollTop <= 0) {
			onLoadOlder();
			return;
		}
		// 平滑跳到顶部要飞一段：这段时间里静默回收不该动手量视口
		markScrollSettling(scroll);
		scroll.scrollTo({ top: 0, behavior: "smooth" });
		cancelSettle.current = whenScrollSettles(scroll, () => {
			cancelSettle.current = null;
			onLoadOlder();
		});
	}, [container, onLoadOlder]);

	/*
	 * 交给每根短条的回调都固定身份：短条是 `memo` 的，换成内联箭头会让整排每次渲染都白比一遍。
	 */
	const pointAtTick = useCallback(
		(index: number) => {
			hoverIntent.pointAt(index);
		},
		[hoverIntent],
	);
	const focusTick = useCallback((index: number) => {
		setAttentionIndex(index);
	}, []);
	const blurTick = useCallback((index: number) => {
		setAttentionIndex((current) => (current === index ? null : current));
	}, []);

	// 唯一的隐藏条件：没有可跳的条目。宽度由网格兜着，不参与判断
	if (!outlineIsActive(prompts)) {
		return null;
	}

	return (
		<div className="outline">
			<button
				type="button"
				className="outline-more"
				aria-label={t("outline.more")}
				disabled={!canLoadOlder}
				onClick={jumpToEarliest}
			>
				<span className="outline-more-dots" aria-hidden="true">
					<i />
					<i />
					<i />
				</span>
			</button>
			<div
				className="outline-rail"
				role="tablist"
				aria-label={t("outline.nav")}
				aria-orientation="vertical"
				onPointerEnter={handleRailEnter}
				onPointerMove={handleRailMove}
				onPointerLeave={handleRailLeave}
			>
				{prompts.map((prompt, index) => (
					<OutlineTick
						key={prompt.key}
						index={index}
						promptKey={prompt.key}
						label={t("outline.item", {
							index: index + 1,
							count: prompts.length,
							preview: prompt.preview,
						})}
						preview={prompt.preview}
						isActive={index === activeIndex}
						hasAttention={index === attentionIndex}
						magnify={attentionIndex === null ? 0 : outlineTickMagnification(index - attentionIndex)}
						onSelect={jumpTo}
						onPointAt={pointAtTick}
						onFocus={focusTick}
						onBlur={blurTick}
					/>
				))}
			</div>
		</div>
	);
}

export type { OutlinePrompt } from "./chat-outline.ts";
export { OUTLINE_MAGNIFY_RADIUS };
