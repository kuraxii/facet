/**
 * 图片的编码与解码。
 *
 * 协议里的图片是 base64 加媒体类型，界面手里拿到的是 Blob 或选图窗口回来的 base64。
 * 转换只在这里做一次，发送路径与预览路径都不各自拼一份。
 */
import type { ImageBlock } from "@facet/protocol";

/** 允许作为输入的图片类型。矢量图与动图之外的格式不在这里收。 */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** 单张图片的字节上限。 */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** 一段字节转 base64。浏览器里没有 Buffer，分段拼避免一次展开成超长参数。 */
export function bytesToBase64(bytes: Uint8Array): string {
	let text = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		text += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(text);
}

/** base64 转回字节。 */
export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
	const text = atob(data);
	const bytes = new Uint8Array(new ArrayBuffer(text.length));
	for (let index = 0; index < text.length; index += 1) {
		bytes[index] = text.charCodeAt(index);
	}
	return bytes;
}

/** base64 转回 Blob，选图窗口回来的内容要走到与拖拽、粘贴一样的形状。 */
export function blobFromBase64(data: string, mimeType: string): Blob {
	return new Blob([base64ToBytes(data)], { type: mimeType });
}

/** 把一张图片读成协议里的图片块。 */
export async function encodeImage(image: { blob: Blob; mimeType: string }): Promise<ImageBlock> {
	const bytes = new Uint8Array(await image.blob.arrayBuffer());
	return { type: "image", data: bytesToBase64(bytes), mimeType: image.mimeType };
}
