/**
 * 消息里的图片是正方形缩略图。
 *
 * 几何跟输入区待发附件同一套（圆角、间距、`object-fit: cover` 铺满整格），边长由
 * `--msg-image-size` 一处给。这三条是这次定下来的形状，改样式时一漂就红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = join(import.meta.dirname);
const chat = readFileSync(join(styles, "chat.css"), "utf8");
const base = readFileSync(join(styles, "base.css"), "utf8");

/** 取一条规则的声明块。 */
function block(source: string, selector: string): string {
	const match = new RegExp(`\\n${selector.replace(/[.:]/g, "\\$&")} \\{([\\s\\S]*?)\\n\\}`).exec(source);
	if (match === null) {
		throw new Error(`没找到规则：${selector}`);
	}
	return match[1] ?? "";
}

describe("消息里的图片", () => {
	it("边长 64px，宽高同一个变量", () => {
		expect(base).toContain("--msg-image-size: 64px;");
		const image = block(chat, ".msg-image");
		expect(image).toContain("width: var(--msg-image-size)");
		expect(image).toContain("height: var(--msg-image-size)");
	});

	it("图片铺满整格：cover，不留白", () => {
		const img = block(chat, ".msg-image img");
		expect(img).toContain("object-fit: cover");
		expect(img).toContain("width: 100%");
		expect(img).toContain("height: 100%");
	});

	it("圆角与间距跟输入区附件共用同一套刻度", () => {
		expect(block(chat, ".msg-image")).toContain("border-radius: var(--attach-thumb-radius)");
		expect(block(chat, ".msg-images")).toContain("gap: var(--attach-thumb-gap)");
	});
});
