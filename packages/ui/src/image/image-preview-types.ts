/**
 * 图片预览的数据形状。
 *
 * 单独一份是因为它同时被纯逻辑（`image-preview-state.ts`）与两个组件引用；放在其中任何一边
 * 都会绕出循环依赖。
 */

/** 可预览的一张图片。 */
export interface ImagePreviewItem {
	/** 地址：data URL、objectURL 或 http(s) 链接 */
	readonly src: string;
	/** 无障碍名，也是下载文件的缺省名 */
	readonly alt: string;
}

/** 打开预览的入口：全仓图片点击都走它。 */
export type OpenImagePreview = (request: {
	/** 这一组图片；单张时控制条不出现上一张 / 下一张 */
	readonly items: readonly ImagePreviewItem[];
	/** 从哪一张开始 */
	readonly index?: number | undefined;
	/** 点开它的那个元素，用于 View Transitions 飞出 */
	readonly source?: HTMLElement | null | undefined;
}) => void;
