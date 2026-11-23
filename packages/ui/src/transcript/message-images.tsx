/**
 * 消息里的图片。
 *
 * 一条消息的几张图并排成一条缩略图，排在正文上方：用户发出的截图在气泡上面，助手自己给的图
 * 在答复上方。点一张开全局预览，组内可以左右翻——与工具结果里的图、正文 Markdown 里的图同一套
 * 预览。
 *
 * 数据就是消息里的 base64，这里拼成 `data:` URL 直接交给 `<img>`，不落盘也不走网络。不另做
 * 占位框：解码就在本进程里，空盒子先占一次高度再换成真实高度，反倒闪一下。
 */
import type { MessageImage, Part, TranscriptItem } from "@facet/client-core";
import { type ReactNode, useMemo } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useImagePreview } from "../image/image-preview.tsx";
import type { ImagePreviewItem } from "../image/image-preview-types.ts";

/** 从渲染单元里挑出图片，保持内容块原本的顺序。 */
export function imagesOf(items: readonly TranscriptItem[]): MessageImage[] {
	const images: MessageImage[] = [];
	for (const item of items) {
		for (const part of item.parts as readonly Part[]) {
			if (part.kind === "image") {
				images.push({ data: part.data, mimeType: part.mimeType });
			}
		}
	}
	return images;
}

/** 一条消息的图片条。 */
export interface MessageImagesProps {
	/** 这一行的标识，用来给缩略图起稳定的键 */
	id: string;
	/** 这一行含的渲染单元 */
	items: readonly TranscriptItem[];
}

/** 一条消息的图片，排在正文上方；没有图片时不渲染。 */
export function MessageImages({ id, items }: MessageImagesProps): ReactNode {
	const { t } = useI18n();
	const openImagePreview = useImagePreview();
	// 渲染单元在行复用时保持引用，所以这批预览项只算一次
	const preview = useMemo<ImagePreviewItem[]>(
		() =>
			imagesOf(items).map((image, index) => ({
				src: `data:${image.mimeType};base64,${image.data}`,
				alt: t("transcript.imageInMessage", { index: index + 1 }),
			})),
		[items, t],
	);
	if (preview.length === 0) {
		return null;
	}
	return (
		<div className="msg-images">
			{preview.map((item, index) => (
				<button
					key={`${id}:${item.src}`}
					type="button"
					className="msg-image"
					aria-label={item.alt}
					onClick={(event) => openImagePreview({ items: preview, index, source: event.currentTarget })}
				>
					<img src={item.src} alt={item.alt} loading="lazy" decoding="async" />
				</button>
			))}
		</div>
	);
}
