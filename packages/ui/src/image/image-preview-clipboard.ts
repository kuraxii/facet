/**
 * 图片预览的下载。
 *
 * 地址就是消息里的 `data:` URL 或页面内的 blob，点一下落成文件即可，不必先转码。
 */

/** 触发一次下载；文件名由预览项的 alt 推导。 */
export function downloadImage(src: string, fileName: string): void {
	const link = document.createElement("a");
	link.href = src;
	link.download = fileName;
	link.rel = "noopener";
	link.click();
}
