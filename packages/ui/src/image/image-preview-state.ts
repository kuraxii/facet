/**
 * 图片预览的纯逻辑：一组图片、缩放档位与以指针为中心的平移补偿。
 *
 * 不碰 DOM、不读窗口：`ImagePreview` 只把这些函数的结果贴到 transform 上，这样缩放与拖拽的
 * 数学可以单测，组件里只剩事件编排。
 *
 * 缩放的坐标口径：**1 = 原始像素（100%）**。图片按固有尺寸铺在窗口上，超出窗口的部分裁掉，
 * `scale` 就是它上面乘的倍数；「适应窗口」是另一档，由 `fitScale` 算出来。
 */
import type { ImagePreviewItem } from "./image-preview-types.ts";

/** 缩到最小：再小就只剩噪点了。 */
export const PREVIEW_MIN_SCALE = 0.25;
/** 放到最大：再大也分不出像素。 */
export const PREVIEW_MAX_SCALE = 5;
/** 一次滚轮或一次按键的倍率。 */
export const PREVIEW_ZOOM_STEP = 1.25;

/** 一个二维点或二维位移，单位 px。 */
export interface Point {
	readonly x: number;
	readonly y: number;
}

/** 图片的固有尺寸，单位 px。 */
export interface Size {
	readonly width: number;
	readonly height: number;
}

/** 打开预览的请求。 */
export interface ImagePreviewOpenRequest {
	/** 这一组图片：多张时预览层给出上一张 / 下一张 */
	readonly items: readonly ImagePreviewItem[];
	/** 从哪一张开始，缺省第一张；越界会被夹回范围内 */
	readonly index?: number | undefined;
	/** 点开它的那个元素：View Transitions 从这里飞出去 */
	readonly source?: HTMLElement | null | undefined;
}

/** 收好的请求：一定至少有一张图，`index` 一定落在范围内。 */
export interface ImagePreviewSession {
	readonly items: readonly ImagePreviewItem[];
	readonly index: number;
	readonly source: HTMLElement | null;
}

/**
 * 把请求收成一次可用的会话。
 *
 * 没有地址的项直接丢掉（扩展或正文都可能给出空 `src`）；一张都不剩时返回 `undefined`，
 * 调用方据此不开浮层。
 */
export function normalizeRequest(request: ImagePreviewOpenRequest): ImagePreviewSession | undefined {
	const items = request.items.filter((item) => item.src.length > 0);
	if (items.length === 0) {
		return undefined;
	}
	const requested = Math.round(request.index ?? 0);
	const index = Number.isFinite(requested) ? Math.min(items.length - 1, Math.max(0, requested)) : 0;
	return { items, index, source: request.source ?? null };
}

/** 把缩放夹进 [`PREVIEW_MIN_SCALE`, `PREVIEW_MAX_SCALE`]；读不懂的值按适应视口算。 */
export function clampScale(scale: number): number {
	if (!Number.isFinite(scale) || scale <= 0) {
		return 1;
	}
	return Math.min(PREVIEW_MAX_SCALE, Math.max(PREVIEW_MIN_SCALE, scale));
}

/**
 * 以指针为中心缩放后的平移量。
 *
 * 图片的变换是 `translate(pan) scale(scale)`、原点在容器中心，所以屏幕上某点与图片上某点的
 * 关系是 `p = (q − pan) / scale`。缩放之后要让同一个图片点仍落在指针下，即
 * `pan' = q − p · scale'`；`q` 这里给的是相对容器中心的坐标。
 */
export function zoomAround(pan: Point, scale: number, nextScale: number, pointer: Point): Point {
	if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(nextScale) || nextScale <= 0) {
		return pan;
	}
	const ratio = nextScale / scale;
	return {
		x: pointer.x - (pointer.x - pan.x) * ratio,
		y: pointer.y - (pointer.y - pan.y) * ratio,
	};
}

/** 一组图片里往前后挪一步，到头绕回另一端。 */
export function stepIndex(index: number, step: number, count: number): number {
	if (count <= 0) {
		return 0;
	}
	const next = (index + step) % count;
	return next < 0 ? next + count : next;
}

/**
 * 适应窗口的那一档：整张图刚好放进窗口。
 *
 * 小图不为了填满窗口而被拉大（上限 100%），所以这个值永远在 `(0, 1]`。
 */
export function fitScale(natural: Size, viewport: Size): number {
	if (natural.width <= 0 || natural.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
		return 1;
	}
	return Math.min(1, viewport.width / natural.width, viewport.height / natural.height);
}

/**
 * 双击在「100% 原始像素」与「适应窗口」之间切换。
 *
 * 已经在 100% 附近就回适应，否则回 100%。
 */
export function toggleZoom(scale: number, fit: number): number {
	return Math.abs(scale - 1) < 0.01 ? clampScale(fit) : 1;
}

/**
 * 当前这一档下图片有没有超出窗口。
 *
 * 只有超出时才谈得上拖动：整张图都在窗口里的时候拖它只会把图推歪。
 */
export function hasOverflow(natural: Size, scale: number, viewport: Size): boolean {
	if (viewport.width <= 0 || viewport.height <= 0) {
		return false;
	}
	return natural.width * scale > viewport.width + 1 || natural.height * scale > viewport.height + 1;
}

/** 控制条上的百分比：以原始像素为 100%。 */
export function scalePercent(scale: number): string {
	return `${Math.round(scale * 100)}%`;
}

/** 下载用的文件名：优先用 alt，没有就从地址里捡一个像名字的片段。 */
export function downloadFileName(item: ImagePreviewItem): string {
	const base = item.alt.trim().replace(/[\\/:*?"<>|]+/g, "-");
	if (base.length > 0) {
		return base;
	}
	// 先切掉查询串与锚点，再取最后一段：`photo.jpeg?x=1` 要的是 `photo.jpeg`
	const path = item.src.split(/[?#]/)[0] ?? "";
	const tail = path.split("/").pop() ?? "";
	return tail.includes(".") ? tail : "image.png";
}
