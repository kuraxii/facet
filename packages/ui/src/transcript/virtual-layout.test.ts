// @vitest-environment node
/**
 * 虚拟化那三个数必须与样式表同源。
 *
 * 行距来自 `.column` 的 `row-gap`，列表起点来自 `.scroll` 的上内边距，两者都被虚拟化器拿去
 * 算坐标：样式表改了而 TS 没跟上，行与占位块就会错位，而且错得只在长会话里看得见。反过来，
 * 行的屏外裁剪交给虚拟化，样式里再写 `content-visibility` 会让占位高度与虚拟坐标打架。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JUMP_LEAD } from "../chat/chat-outline.ts";
import { VISUAL_SCALE } from "../styles/visual-contract.ts";
import { VIRTUAL_ROW_GAP, VIRTUAL_SCROLL_MARGIN } from "./virtual-anchor.ts";

const chat = readFileSync(join(import.meta.dirname, "..", "styles", "chat.css"), "utf8");

/** 去掉注释，免得注释里的示例代码被当成真规则。 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 取一条选择器对应的规则体。 */
function block(source: string, selector: string): string {
	const start = source.indexOf(`\n${selector} {`);
	expect(start, `找不到 ${selector} 的规则`).toBeGreaterThan(-1);
	const open = source.indexOf("{", start);
	const close = source.indexOf("}", open);
	return source.slice(open + 1, close);
}

const styles = stripComments(chat);

describe("虚拟化的几何与样式表同源", () => {
	it("行距等于 `.column` 的 row-gap", () => {
		expect(block(styles, ".column")).toContain("row-gap: var(--space-6)");
		expect(VIRTUAL_ROW_GAP).toBe(VISUAL_SCALE.space.s6);
	});

	it("列表起点等于 `.scroll` 的上内边距", () => {
		const padding = /padding: ([^;]+);/.exec(block(styles, ".scroll"))?.[1] ?? "";
		// 只钉第一位：下内边距是让开输入区上方那条过渡带的距离，另有单测看着
		expect(padding.split(" ")[0]).toBe("var(--space-12)");
		expect(VIRTUAL_SCROLL_MARGIN).toBe(VISUAL_SCALE.space.s12);
	});

	it("跳转留白等于顶部渐隐的高度", () => {
		// 落点贴着上沿的话，跳过去的第一行会被那层渐暗压住
		expect(block(styles, ".chat-fade")).toContain("height: var(--control-lg)");
		expect(JUMP_LEAD).toBe(VISUAL_SCALE.control.lg);
	});

	it("行上不再做屏外裁剪：挂载哪些行由虚拟化决定", () => {
		const row = block(styles, ".row");
		expect(row).toContain("contain: layout style");
		expect(row).not.toContain("content-visibility");
		expect(row).not.toContain("contain-intrinsic-size");
		expect(styles).not.toContain(".row[data-outline-key]");
	});
});
