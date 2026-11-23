/**
 * 对话滚动区的稳定性口径。
 *
 * 消息行**不做**视口裁剪（`content-visibility`）：裁剪会给屏外的行一个占位高度，滚到时换成真实
 * 高度，滚动总高跟着长；`.scroll` 上又是 `overflow-anchor: none`（吸底由脚本按 `scrollTop` 管），
 * 浏览器不会替我们校准，差值就全落在滚动位置上——上滚像跳了一截、下滚被顶回来。行高本来就随
 * 内容变（图片解码、折叠体展开、流式追加），占位高度只能猜。
 *
 * 这条已经踩过两回，所以用静态断言钉住：谁把裁剪加回 `.row`，谁就把这里改红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "chat.css"), "utf8");

/** 取一条规则的声明块，注释先剥掉，只留声明。 */
function block(selector: string): string {
	const match = new RegExp(`\\n${selector.replace(".", "\\.")} \\{([\\s\\S]*?)\\n\\}`).exec(css);
	if (match === null) {
		throw new Error(`没找到规则：${selector}`);
	}
	return (match[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("对话滚动区的稳定性", () => {
	it("消息行不做视口裁剪", () => {
		const row = block(".row");
		expect(row).toContain("contain: layout style");
		expect(row).not.toContain("content-visibility");
		expect(row).not.toContain("contain-intrinsic-size");
	});

	it("滚动区自己管吸底，不让浏览器锚定", () => {
		expect(block(".scroll")).toContain("overflow-anchor: none");
	});
});
