// @vitest-environment node
// 这份用例直接读仓库里的 CSS 文件，要有真实的文件系统与 `file:` URL。
/**
 * 原生 `<dialog>` 的两条默认样式必须被接住。
 *
 * 浏览器给弹层的 UA 样式会盖两件事：`border: solid`（`medium` 3px、`currentcolor`）画出
 * 一圈 3px 描边，深色主题下是白的、浅色主题下是黑的；`color: CanvasText` 让弹层里的文字
 * 不跟页面的前景色走。项目的三个弹层（设置、对话框、会话搜索）都只靠 `--shadow-modal`
 * 自带的那条 1px 环与圆角定轮廓，自己也只按变量给颜色，所以 `base.css` 里那条复位一旦被
 * 删掉，边缘与文字色会一起变——组件样式里本来就看不到它，评审也看不出来。
 *
 * 这里只量 `base.css` 有没有这两条复位，不重复检查各弹层的观感。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const base = readFileSync(new URL("./base.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** `dialog` 那条规则体。 */
const reset = /(?:^|\n)dialog\s*\{([^}]*)\}/.exec(base)?.[1] ?? "";

describe("原生弹层的缺省样式", () => {
	it("`<dialog>` 的 UA 描边被复位", () => {
		expect(reset).toMatch(/border:\s*(?:0|none);/);
	});

	it("`<dialog>` 的文字色跟页面走", () => {
		expect(reset).toMatch(/color:\s*inherit;/);
	});
});
