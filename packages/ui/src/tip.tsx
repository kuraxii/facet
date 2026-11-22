/**
 * 悬浮提示。
 *
 * 触发元素给出自己的矩形，浮层用 portal 挂到 `body` 上，`position: fixed` 定位：
 * 祖先的 `overflow` 与 `contain` 都裁不到它，行里、滚动容器里、弹窗里都能用同一份。
 *
 * 显示带延迟，指针扫过去不打扰；默认指针一离开就收，手停在哪里浮层就在哪里消失。
 * 只有「浮层里还有得看」的那一类（正文里工具调用的参数全文，能滚动）才留一段宽限，
 * 好让人把指针挪进浮层里接着看（WCAG 1.4.13 的 hoverable 与 persistent）。浮层贴到视口
 * 边缘时向右收、下边放不下就翻到触发元素上方。
 *
 * 浮层挂在 `body` 上，靠 `z-index` 压过普通浮层；原生 `<dialog>` 在顶部层里，`z-index`
 * 压不过它，所以弹层内部要用提示时，得把浮层挂进弹层自己的子树。
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VISUAL_PX } from "./styles/visual-contract.ts";

/** 指针在触发元素上停留这么久才显示，毫秒。 */
const TIP_DELAY_MS = 500;
/** 能滚动的提示：指针离开后留这么久再关，够把指针挪进浮层，毫秒。 */
const TIP_HOLD_MS = 300;
/** 浮层与触发元素之间的间隙，与 `--tool-tip-gap` 是同一个数。 */
const TIP_GAP = VISUAL_PX.popover.tipGap;
/** 浮层与视口边缘至少留的空白；没有同名变量，值就在契约里。 */
const TIP_EDGE = VISUAL_PX.popover.tipEdge;

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

/** 一份悬浮提示的参数。 */
export interface HoverTipOptions {
	/**
	 * 指针离开触发元素后先不关，留一段宽限再收。
	 *
	 * 只有浮层里还有得看的才需要（正文里工具调用的参数全文，在里面滚动）：不给这段
	 * 宽限，指针就永远挪不进浮层。只给一行说明的提示不要开，迟半拍收起像是没跟上手。
	 */
	holdOnLeave?: boolean;
	/**
	 * 浮层不垫外层内边距，留给内容自己决定（`.pop-tip.is-flush`）。
	 *
	 * 只给自带内边距与分隔线的分段卡片用：外层再垫一圈就是双层套壳，文字被推到离边缘
	 * 更远的地方，分隔线也顶不到边。纯文字提示不要开，那样文字会贴着边框。
	 */
	flush?: boolean;
}

/** 浮层的落点与两个指针事件。 */
interface TipBoxProps {
	anchor: TipAnchor;
	onEnter: () => void;
	onLeave: () => void;
	/** 浮层是否不垫外层内边距，见 `HoverTipOptions.flush` */
	flush: boolean;
	children: ReactNode;
}

/**
 * 浮层本体。
 *
 * 先按触发元素的落点摆好，挂载之后量一次自己的尺寸：超出视口右缘就往左收，下方放不下
 * 就翻到触发元素上方。量尺寸要等它进了 DOM，因此只在位置变化时再校正一次。
 */
function TipBox({ anchor, onEnter, onLeave, flush, children }: TipBoxProps): ReactNode {
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
			className={flush ? "pop-tip is-flush" : "pop-tip"}
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
export function useHoverTip({ holdOnLeave = false, flush = false }: HoverTipOptions = {}): HoverTip {
	const [shown, setShown] = useState<{ anchor: TipAnchor; label: ReactNode } | undefined>(undefined);
	const timer = useRef<number | undefined>(undefined);

	const clear = useCallback(() => window.clearTimeout(timer.current), []);

	const showSoon = useCallback((rect: DOMRect, label: ReactNode) => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			setShown({ anchor: { left: rect.left, top: rect.top, bottom: rect.bottom }, label });
		}, TIP_DELAY_MS);
	}, []);

	/** 关掉浮层：默认立刻收，`holdOnLeave` 的提示留一段宽限。 */
	const hide = useCallback(() => {
		window.clearTimeout(timer.current);
		if (!holdOnLeave) {
			setShown(undefined);
			return;
		}
		timer.current = window.setTimeout(() => setShown(undefined), TIP_HOLD_MS);
	}, [holdOnLeave]);

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
				onPointerLeave: hide,
			};
		},
		[showSoon, hide],
	);

	const render = useCallback((): ReactNode => {
		if (shown === undefined) {
			return null;
		}
		return (
			<TipBox anchor={shown.anchor} onEnter={clear} onLeave={hide} flush={flush}>
				{shown.label}
			</TipBox>
		);
	}, [shown, clear, hide, flush]);

	return { handlers, render };
}
