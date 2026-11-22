/**
 * 输入区占位提示的定位基准。
 *
 * 占位提示是绝对定位的，免得它参与高度计算；它的定位基准必须只是输入域那一圈
 * （`.composer-input`），不是整个 `.composer`。缩略图与「没收下的图片」那行提示都在输入域上面，
 * 基准错了占位提示就留在顶端、压在缩略图上。用例是静态断言：改样式时这两条一变就红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "composer.css"), "utf8");

/** 取一条规则的声明块。 */
function block(selector: string): string {
	const match = new RegExp(`\\n${selector.replace(".", "\\.")} \\{([\\s\\S]*?)\\n\\}`).exec(css);
	if (match === null) {
		throw new Error(`没找到规则：${selector}`);
	}
	return match[1] ?? "";
}

describe("输入区占位提示", () => {
	it("定位基准是输入域那一圈", () => {
		expect(block(".composer-input")).toContain("position: relative");
	});

	it("占位提示贴输入域的上缘，不吃外层内边距", () => {
		const placeholder = block(".composer-placeholder");
		expect(placeholder).toContain("position: absolute");
		expect(placeholder).toContain("top: 0");
		expect(placeholder).not.toContain("-composer-padding-");
	});
});
