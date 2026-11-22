/**
 * 正文里的图片地址。
 *
 * markstream 逐个节点渲染图片，拿不到「同一段正文里还有哪几张」；预览要支持左右翻，就得在
 * 渲染整段之前先把地址按出现顺序收一遍。两种写法都认：Markdown 的 `![alt](src)` 与裸
 * `<img src="...">`（后者在正文里也常被扩展与模型用到）。
 */
import type { ImagePreviewItem } from "../image/image-preview-types.ts";

/** `![alt](src "title")`：地址可以带尖括号（里面允许空格），也可以跟一个标题。 */
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*(?:<([^>\n]*)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g;
/** HTML 写法：属性顺序不定，只认 `src`（替代文字不猜）。 */
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

/**
 * 一段正文里所有图片，按出现顺序、按地址去重。
 *
 * 去重是给预览的前后翻用：同一张图出现两次，翻到第二次时应落在同一张上。
 */
export function markdownImages(text: string): ImagePreviewItem[] {
	const found: { at: number; item: ImagePreviewItem }[] = [];
	for (const match of text.matchAll(MARKDOWN_IMAGE)) {
		const src = (match[2] ?? match[3] ?? "").trim();
		if (src.length > 0) {
			found.push({ at: match.index ?? 0, item: { src, alt: (match[1] ?? "").trim() } });
		}
	}
	for (const match of text.matchAll(HTML_IMAGE)) {
		const src = (match[1] ?? "").trim();
		if (src.length > 0) {
			found.push({ at: match.index ?? 0, item: { src, alt: "" } });
		}
	}
	found.sort((left, right) => left.at - right.at);
	const seen = new Set<string>();
	const items: ImagePreviewItem[] = [];
	for (const { item } of found) {
		if (!seen.has(item.src)) {
			seen.add(item.src);
			items.push(item);
		}
	}
	return items;
}
