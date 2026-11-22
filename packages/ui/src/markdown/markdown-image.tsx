/**
 * 正文里的图片。
 *
 * markstream 默认把图片渲染成一张 `<img>`；这里换成「按钮 + 缩略图」，点开走全局图片预览。
 * 同一段正文里的图片共享一个上下文，预览里因此可以左右翻——单张时控制条不出现翻页按钮。
 */

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useImagePreview } from "../image/image-preview.tsx";
import type { ImagePreviewItem } from "../image/image-preview-types.ts";

/** 同一段正文里所有可预览的图片；没有 provider 时为空。 */
const MarkdownImagesContext = createContext<readonly ImagePreviewItem[]>([]);

/** 给一段正文提供它的图片清单。 */
export function MarkdownImagesProvider({
	items,
	children,
}: {
	items: readonly ImagePreviewItem[];
	children: ReactNode;
}): ReactNode {
	return <MarkdownImagesContext.Provider value={items}>{children}</MarkdownImagesContext.Provider>;
}

/** 库传给图片组件的节点形状：只取用得到的两个字段。 */
interface MarkdownImageNode {
	/** 图片地址 */
	readonly src?: unknown;
	/** 替代文字 */
	readonly alt?: unknown;
	/** 标题，没有替代文字时顶上 */
	readonly title?: unknown;
}

/** 一条 Markdown 图片。 */
export function MarkdownImage({ node }: { node: MarkdownImageNode }): ReactNode {
	const { t } = useI18n();
	const openImagePreview = useImagePreview();
	const group = useContext(MarkdownImagesContext);
	const src = typeof node.src === "string" ? node.src : "";
	if (src.length === 0) {
		return null;
	}
	const alt = typeof node.alt === "string" ? node.alt : typeof node.title === "string" ? node.title : "";
	/** 这一段正文里的图片清单；`src` 不在里面（极端情况）时退化成单张 */
	const items: readonly ImagePreviewItem[] = group.some((item) => item.src === src)
		? group
		: [{ src, alt: alt.length > 0 ? alt : t("imagePreview.label") }];
	const index = Math.max(
		0,
		items.findIndex((item) => item.src === src),
	);
	return (
		<button
			type="button"
			className="md-image"
			aria-label={alt.length > 0 ? alt : t("imagePreview.open")}
			onClick={(event) => openImagePreview({ items, index, source: event.currentTarget })}
		>
			<img src={src} alt={alt} loading="lazy" decoding="async" />
		</button>
	);
}
