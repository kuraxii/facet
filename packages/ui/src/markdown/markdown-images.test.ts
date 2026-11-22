/**
 * 正文图片地址的收集：预览要在同一段正文的几张图之间翻，就得先知道有哪些。
 */
import { describe, expect, it } from "vitest";
import { markdownImages } from "./markdown-images.ts";

describe("markdownImages", () => {
	it("认出 Markdown 写法，带下 alt 与顺序", () => {
		expect(markdownImages("前 ![甲](a.png) 中 ![乙](b.png) 后")).toEqual([
			{ src: "a.png", alt: "甲" },
			{ src: "b.png", alt: "乙" },
		]);
	});

	it("认尖括号地址、标题与 data URL", () => {
		expect(markdownImages('![甲](<a b.png> "标题")')).toEqual([{ src: "a b.png", alt: "甲" }]);
		expect(markdownImages("![截图](data:image/png;base64,AAAA)")).toEqual([
			{ src: "data:image/png;base64,AAAA", alt: "截图" },
		]);
	});

	it("裸 img 标签也认，属性顺序不影响", () => {
		expect(markdownImages('<img class="x" src="c.png" width="10">')).toEqual([{ src: "c.png", alt: "" }]);
	});

	it("同一个地址只留第一次出现", () => {
		expect(markdownImages("![甲](a.png) 再说一次 ![甲](a.png)")).toEqual([{ src: "a.png", alt: "甲" }]);
	});

	it("没有图片时是空清单", () => {
		expect(markdownImages("只有文字与 ![行内但仍是图片](x.png)")).toEqual([
			{ src: "x.png", alt: "行内但仍是图片" },
		]);
		expect(markdownImages("纯文字，没有任何地址")).toEqual([]);
	});
});
