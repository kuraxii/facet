// @vitest-environment node
// 这份用例直接读仓库里的 CSS 文件，要有真实的文件系统与 `file:` URL。
/**
 * 渲染器变量桥的两条死规矩。
 *
 * markstream 把 `--code-*`、`--background`、`--ms-*` 这一整套定义在自己的根节点上
 * （`.dark .markstream-react` 与 `.markstream-react.dark`，两档类选择器）。`markdown.css`
 * 里那份「换成本项目配色」的覆盖因此必须比它高一档：同权重时胜负取决于产物里的先后，
 * 覆盖会被静默顶掉，代码块退回库里的 `#111827`——屏幕上只表现为「底色没了」，看不出是
 * 哪条规则输了。
 *
 * 另一条是变量名：色板不能占用 `--code-bg` / `--code-fg`。桥要在渲染器根节点上写
 * `--code-bg: <色板值>`，色板同名就成了同一个元素上的自我引用，计算值是无效值。
 *
 * 这里只量权重与名字，颜色本身由 `theme.test.ts` 与 `visual-contract.test.ts` 守。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const markdown = stripComments(readFileSync(new URL("./markdown.css", import.meta.url), "utf8"));
const theme = stripComments(readFileSync(new URL("./theme.css", import.meta.url), "utf8"));

/** 去掉注释：注释里会举例写到手写选择器与变量名，算进权重与名字里就是假数。 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 库里那几条规则能拿到的最高权重：两个类选择器。 */
const LIBRARY_CLASS_COUNT = 2;

/** 选择器里类选择器的个数。这份样式表不靠 id 与元素选择器堆权重，数 `class` 就够。 */
function classCount(selector: string): number {
	return (selector.match(/\.[\w-]+/g) ?? []).length;
}

/** 取声明了 `declaration` 的那条规则的选择器列表。 */
function selectorsDeclaring(source: string, declaration: string): string[] {
	const at = source.indexOf(declaration);
	expect(at, `找不到 ${declaration}`).toBeGreaterThanOrEqual(0);
	const open = source.lastIndexOf("{", at);
	const close = source.lastIndexOf("}", open);
	return source
		.slice(close + 1, open)
		.split(",")
		.map((selector) => selector.trim())
		.filter((selector) => selector.length > 0);
}

describe("markstream 变量桥", () => {
	it("覆盖自带变量的规则比库里那几条高权重", () => {
		const selectors = selectorsDeclaring(markdown, "--code-bg: var(--code-block-bg);");
		expect(selectors.length).toBeGreaterThan(0);
		for (const selector of selectors) {
			expect(classCount(selector), selector).toBeGreaterThan(LIBRARY_CLASS_COUNT);
		}
	});

	it("色板不占用渲染器自己的 `--code-*` 变量名", () => {
		expect(theme).not.toMatch(/--code-(?:bg|fg):/);
	});
});
