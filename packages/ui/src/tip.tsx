/**
 * 悬浮提示。
 *
 * 触发元素给出自己的矩形，浮层用 portal 挂到 `body` 上，`position: fixed` 定位：
 * 祖先的 `overflow` 与 `contain` 都裁不到它，行里、滚动容器里、弹窗里都能用同一份。
 *
 * 显示带延迟，指针扫过去不打扰；指针离开后又留一个宽限再关，好让人把指针挪进浮层里
 * 滚动查看（WCAG 1.4.13 的 hoverable 与 persistent）。浮层贴到视口边缘时向右收、
 * 下边放不下就翻到触发元素上方。
 *
 * 浮层挂在 `body` 上，靠 `z-index` 压过普通浮层；原生 `<dialog>` 在顶部层里，`z-index`
 * 压不过它，所以弹层内部要用提示时，得把浮层挂进弹层自己的子树。
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 指针在触发元素上停留这么久才显示，毫秒。 */
const TIP_DELAY_MS = 500;
/** 指针离开后留这么久再关，够把指针挪进浮层，毫秒。 */
const TIP_HIDE_DELAY_MS = 300;
/** 浮层与触发元素之间的间隙，与 `--tool-tip-gap` 一致。 */
const TIP_GAP = 6;
/** 浮层与视口边缘至少留的空白。 */
const TIP_EDGE = 8;

/** 触发元素给出的落点：左右取触发元素的左边，上下取它的上下边。 */
interface TipAnchor {
	left: number;
	top: number;
	bottom: number;
}

/** 绑到触发元素上的指针事件。没有内容时给空对象，元素上不多挂监听。 */
export interface TipHandlers {
	onPointerEnter?: (event: React.PointerEvent<HTMLElement>) => void;
	onPointerLeave?: () => void;
}

/** 一份悬浮提示。 */
export interface HoverTip {
	/**
	 * 绑到触发元素上；`label` 为空时返回空对象，元素上不多挂监听。
	 *
	 * 文案在指针进入时取一次：悬停期间数据变了也不跟着改，与原生 `title` 的行为一致，
	 * 下一次悬停才拿新的。
	 */
	handlers(label: ReactNode): TipHandlers;
	/** 浮层本身，放在组件返回值里即可；还没到显示时机时返回 null。 */
	render(): ReactNode;
}

/** 浮层的落点、内容与两个指针事件。 */
interface TipBoxProps {
	anchor: TipAnchor;
	onEnter: () => void;
	onLeave: () => void;
	children: ReactNode;
}

/**
 * 浮层本体。
 *
 * 先按触发元素的落点摆好，挂载之后量一次自己的尺寸：超出视口右缘就往左收，下方放不下
 * 就翻到触发元素上方。量尺寸要等它进了 DOM，因此只在位置变化时再校正一次。
 */
function TipBox({ anchor, onEnter, onLeave, children }: TipBoxProps): ReactNode {
	const ref = useRef<HTMLDivElement>(null);
	const [place, setPlace] = useState({ left: anchor.left, top: anchor.bottom + TIP_GAP });

	useEffect(() => {
		const node = ref.current;
		if (node === null) {
			return;
		}
		const { offsetWidth: width, offsetHeight: height } = node;
		const left = Math.max(TIP_EDGE, Math.min(anchor.left, window.innerWidth - width - TIP_EDGE));
		// 下方放不下时翻到上方；上方也放不下就贴着视口底部
		const below = anchor.bottom + TIP_GAP;
		const above = anchor.top - height - TIP_GAP;
		const top = below + height <= window.innerHeight - TIP_EDGE ? below : Math.max(TIP_EDGE, above);
		setPlace((current) => (current.left === left && current.top === top ? current : { left, top }));
	}, [anchor.left, anchor.top, anchor.bottom]);

	return createPortal(
		<div
			ref={ref}
			className="pop-tip"
			style={{ left: place.left, top: place.top }}
			onPointerEnter={onEnter}
			onPointerLeave={onLeave}
		>
			{children}
		</div>,
		document.body,
	);
}

/** 一份悬浮提示的状态机。一个组件里只用一份，多处触发元素共用它。 */
export function useHoverTip(): HoverTip {
	const [shown, setShown] = useState<{ anchor: TipAnchor; label: ReactNode } | undefined>(undefined);
	const timer = useRef<number | undefined>(undefined);

	const clear = useCallback(() => window.clearTimeout(timer.current), []);

	const showSoon = useCallback((rect: DOMRect, label: ReactNode) => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			setShown({ anchor: { left: rect.left, top: rect.top, bottom: rect.bottom }, label });
		}, TIP_DELAY_MS);
	}, []);

	const hideSoon = useCallback(() => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setShown(undefined), TIP_HIDE_DELAY_MS);
	}, []);

	// 组件卸载时未到点的定时器不能再弹
	useEffect(() => clear, [clear]);

	const handlers = useCallback(
		(label: ReactNode): TipHandlers => {
			// 空文案等于没有提示：挂上空监听只会让元素多两条无用的回调
			if (label === null || label === undefined || label === "") {
				return {};
			}
			return {
				onPointerEnter: (event) => showSoon(event.currentTarget.getBoundingClientRect(), label),
				onPointerLeave: hideSoon,
			};
		},
		[showSoon, hideSoon],
	);

	const render = useCallback((): ReactNode => {
		if (shown === undefined) {
			return null;
		}
		return (
			<TipBox anchor={shown.anchor} onEnter={clear} onLeave={hideSoon}>
				{shown.label}
			</TipBox>
		);
	}, [shown, clear, hideSoon]);

	return { handlers, render };
}
