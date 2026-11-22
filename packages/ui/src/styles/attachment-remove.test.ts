/**
 * 待发图片上的移除按钮。
 *
 * 两条规矩是这次定下来的：平时不显示（只在指针落在缩略图上、或键盘把焦点移进来时出现），
 * 底色必须不透明——半透明遮罩压在亮图、暗图上都看不出边界。静态断言样式表，改回去就红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "composer.css"), "utf8");

/** 取一条规则的声明块。 */
function block(selector: string): string {
	const match = new RegExp(`\\n${selector.replace(/[.:]/g, "\\$&")} \\{([\\s\\S]*?)\\n\\}`).exec(css);
	if (match === null) {
		throw new Error(`没找到规则：${selector}`);
	}
	return match[1] ?? "";
}

describe("待发图片的移除按钮", () => {
	it("平时不显示,也不吃指针", () => {
		const remove = block(".att-x");
		expect(remove).toContain("opacity: 0");
		expect(remove).toContain("pointer-events: none");
	});

	it("指针落在缩略图上或键盘聚焦时出现", () => {
		expect(css).toContain(".att:hover .att-x,\n.att-x:focus-visible {");
		expect(block(".att:hover .att-x,\n.att-x:focus-visible")).toContain("opacity: 1");
	});

	it("底色不透明:不写带 alpha 的颜色", () => {
		for (const selector of [".att-x", ".att-x:hover"]) {
			const remove = block(selector);
			expect(remove).not.toContain("rgb(");
			expect(remove).not.toContain("transparent");
			expect(remove).toMatch(/background: var\(--bg-[a-z-]+\)/);
		}
	});
});
