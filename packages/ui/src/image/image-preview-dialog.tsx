/**
 * 图片预览浮层。
 *
 * 原生 `<dialog>` 走 Top Layer（`Modal` 已经包好 `showModal()`、`Esc`、点遮罩关闭与焦点归还），
 * 整层铺满窗口：图片按**原始像素**画在中间，默认 100%，超出窗口的部分裁掉，拖拽可以看到四周。
 *
 * 控件只有两簇（见 `image-preview-controls.tsx`）：右上角下载与关闭，底部居中缩放。其余走键位与
 * 手势——双击在 100% 与适应窗口之间切、滚轮以指针为中心缩放、超出窗口后拖拽平移、`←` / `→` 在
 * 同一组图片之间翻（多张时不额外摆箭头，控制条上不再添项）。点图片以外的空白也关掉它。
 */
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Modal } from "../modal.tsx";
import { downloadImage } from "./image-preview-clipboard.ts";
import { ImagePreviewActions, ImagePreviewZoom } from "./image-preview-controls.tsx";
import {
	clampScale,
	downloadFileName,
	fitScale,
	hasOverflow,
	type Point,
	PREVIEW_ZOOM_STEP,
	type Size,
	scalePercent,
	stepIndex,
	toggleZoom,
	zoomAround,
} from "./image-preview-state.ts";
import type { ImagePreviewItem } from "./image-preview-types.ts";

/** 平移量：相对舞台中心的像素位移。 */
type Pan = Point;

const NO_PAN: Pan = { x: 0, y: 0 };
const NO_SIZE: Size = { width: 0, height: 0 };

/** 预览层的参数。 */
export interface ImagePreviewDialogProps {
	/** 这一组图片 */
	readonly items: readonly ImagePreviewItem[];
	/** 打开时停在哪一张 */
	readonly initialIndex: number;
	/** 关闭请求：`Esc`、点遮罩、右上角的关闭按钮都走它 */
	readonly onClose: () => void;
}

/** 图片预览浮层。 */
export function ImagePreviewDialog({ items, initialIndex, onClose }: ImagePreviewDialogProps): ReactNode {
	const { t } = useI18n();
	const [index, setIndex] = useState(initialIndex);
	/** 相对原始像素的倍数：1 = 100% */
	const [scale, setScale] = useState(1);
	const [pan, setPan] = useState<Pan>(NO_PAN);
	const [natural, setNatural] = useState<Size>(NO_SIZE);
	/** 窗口可用区，铺满整层，量它是为了算「适应窗口」与「能不能拖」 */
	const [viewport, setViewport] = useState<Size>(NO_SIZE);
	const [isDragging, setDragging] = useState(false);
	const stage = useRef<HTMLDivElement>(null);
	/** 正在拖：记下指针起点与那时的平移量，移动时按差值算 */
	const drag = useRef<{ start: Pan; from: Point } | undefined>(undefined);
	const item = items[index] ?? items[0];
	const hasMany = items.length > 1;
	const fit = fitScale(natural, viewport);
	const canDrag = hasOverflow(natural, scale, viewport);

	/**
	 * 量窗口：这一层铺满窗口，「适应窗口」与拖拽的判定都按窗口尺寸算。
	 *
	 * 不去量舞台自己的盒子——`showModal()` 在父组件的 effect 里才调用，第一次布局时这一层还是
	 * `display: none`，量出来是 0；窗口尺寸则随时可读，窗口变化又有现成的 `resize` 信号。
	 */
	useLayoutEffect(() => {
		const measure = (): void => {
			setViewport((current) =>
				current.width === window.innerWidth && current.height === window.innerHeight
					? current
					: { width: window.innerWidth, height: window.innerHeight },
			);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, []);

	/** 舞台中心（视口坐标）：以指针为中心缩放要它做原点 */
	const stageCenter = useCallback((): Point => {
		const node = stage.current;
		if (node === null) {
			return NO_PAN;
		}
		const rect = node.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}, []);

	/**
	 * 缩放：给了指针就以它为中心补一次平移。
	 *
	 * 整张图已经在窗口里时把平移清零：那时拖着它只会把图推歪，居中才是对的。
	 */
	const zoomTo = useCallback(
		(next: number, pointer?: Point) => {
			const target = clampScale(next);
			if (pointer !== undefined) {
				const center = stageCenter();
				setPan((current) =>
					hasOverflow(natural, target, viewport)
						? zoomAround(current, scale, target, { x: pointer.x - center.x, y: pointer.y - center.y })
						: NO_PAN,
				);
			} else if (!hasOverflow(natural, target, viewport)) {
				setPan(NO_PAN);
			}
			setScale(target);
		},
		[natural, scale, stageCenter, viewport],
	);

	/** 换一张图：缩放与平移一起归位——上一张的取景在这张上没有意义 */
	const goTo = useCallback((next: number) => {
		setIndex(next);
		setScale(1);
		setPan(NO_PAN);
		setNatural(NO_SIZE);
	}, []);

	/**
	 * 键盘快捷键挂在 `document` 上：浮层是模态层，焦点停在哪枚按钮上都收得到，不必给容器加一个
	 * 它其实没有的语义角色。同一组有多张时 `←` / `→` 翻页——这两个动作不在控件里。
	 */
	const onKeyDown = useCallback(
		(event: KeyboardEvent): void => {
			switch (event.key) {
				case "Escape":
					event.preventDefault();
					onClose();
					return;
				case "+":
				case "=":
					event.preventDefault();
					zoomTo(scale * PREVIEW_ZOOM_STEP);
					return;
				case "-":
				case "_":
					event.preventDefault();
					zoomTo(scale / PREVIEW_ZOOM_STEP);
					return;
				case "0":
					event.preventDefault();
					zoomTo(1);
					return;
				case "ArrowLeft":
					if (hasMany) {
						event.preventDefault();
						goTo(stepIndex(index, -1, items.length));
					}
					return;
				case "ArrowRight":
					if (hasMany) {
						event.preventDefault();
						goTo(stepIndex(index, 1, items.length));
					}
					return;
				default:
					return;
			}
		},
		[goTo, hasMany, index, items.length, onClose, scale, zoomTo],
	);

	// 快捷键随浮层挂上摘掉
	useEffect(() => {
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onKeyDown]);

	/**
	 * 点图片以外的空白关掉浮层。
	 *
	 * 监听挂在舞台上，`target` 是舞台自己才算「点在空白上」：图标、按钮、缩略图都是它的后代，
	 * 点到它们时 `target` 不是舞台。拖拽也走指针按下，但那一下的 `target` 是图片，不会误关。
	 */
	useEffect(() => {
		const node = stage.current;
		if (node === null) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			if (event.target === node) {
				onClose();
			}
		};
		node.addEventListener("pointerdown", onPointerDown);
		return () => node.removeEventListener("pointerdown", onPointerDown);
	}, [onClose]);

	// 滚轮缩放：要 preventDefault 拦掉页面滚动，监听器必须显式声明非 passive
	useEffect(() => {
		const node = stage.current;
		if (node === null) {
			return;
		}
		const onWheel = (event: WheelEvent): void => {
			event.preventDefault();
			const factor = event.deltaY < 0 ? PREVIEW_ZOOM_STEP : 1 / PREVIEW_ZOOM_STEP;
			zoomTo(scale * factor, { x: event.clientX, y: event.clientY });
		};
		node.addEventListener("wheel", onWheel, { passive: false });
		return () => node.removeEventListener("wheel", onWheel);
	}, [zoomTo, scale]);

	const onPointerDown = (event: ReactPointerEvent<HTMLImageElement>): void => {
		if (!canDrag) {
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { start: pan, from: { x: event.clientX, y: event.clientY } };
		setDragging(true);
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLImageElement>): void => {
		const active = drag.current;
		if (active === undefined) {
			return;
		}
		setPan({
			x: active.start.x + event.clientX - active.from.x,
			y: active.start.y + event.clientY - active.from.y,
		});
	};

	const endDrag = (event: ReactPointerEvent<HTMLImageElement>): void => {
		if (drag.current === undefined) {
			return;
		}
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		drag.current = undefined;
		setDragging(false);
	};

	if (item === undefined) {
		// 请求收口时已经保证至少一张；这里只是让类型收窄
		return null;
	}

	const classes = ["image-preview"];
	if (canDrag) {
		classes.push("is-draggable");
	}
	if (isDragging) {
		classes.push("is-dragging");
	}

	return (
		<Modal open onClose={onClose} label={t("imagePreview.label")} className="image-preview-dialog">
			<div className={classes.join(" ")}>
				<div className="image-preview-stage" ref={stage}>
					{/* 拖拽与双击都落在图上：舞台只是铺满窗口的定位层，背景不接收交互 */}
					<img
						src={item.src}
						alt={item.alt}
						draggable={false}
						onLoad={(event) => {
							const node = event.currentTarget;
							setNatural({ width: node.naturalWidth, height: node.naturalHeight });
						}}
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={endDrag}
						onPointerCancel={endDrag}
						onDoubleClick={() => zoomTo(toggleZoom(scale, fit))}
						style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
					/>
				</div>
				<ImagePreviewActions
					onSave={() => downloadImage(item.src, downloadFileName(item))}
					onClose={onClose}
				/>
				<ImagePreviewZoom
					percent={scalePercent(scale)}
					onZoomIn={() => zoomTo(scale * PREVIEW_ZOOM_STEP)}
					onZoomOut={() => zoomTo(scale / PREVIEW_ZOOM_STEP)}
				/>
			</div>
		</Modal>
	);
}
