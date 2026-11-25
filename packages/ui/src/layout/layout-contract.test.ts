/**
 * 布局契约：样式表里的字面量必须与 `layout-contract.ts` 逐条对齐。
 *
 * 容器查询与属性选择器里都不能写 CSS 变量，样式表那边只能写死数字与属性名；真值在
 * `layout-contract.ts`。两边各改一处就等于漂移，而且漂移了也看不出来——只能靠读源码比对。
 * 这个用例就是那道闸：`@container` 的折点、`--main-min`、窗口按钮簇、拖拽折叠属性名，
 * 都对一遍。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAYOUT_PX, SHELL_DATA_ATTRS } from "./layout-contract.ts";

const styles = join(import.meta.dirname, "..", "styles");

/** 读一份样式源码。 */
function css(name: string): string {
	return readFileSync(join(styles, name), "utf8");
}

const panel = css("panel.css");
const base = css("base.css");
const chrome = css("chrome.css");

/** 取出文件里所有 `@container (width < Npx)` 的折点。 */
function containerBreakpoints(source: string): number[] {
	return [...source.matchAll(/@container \(width < (\d+)px\)/g)].map((match) => Number(match[1]));
}

/** 取出 `:root` 里某个变量的 px 值。 */
function rootPx(source: string, name: string): number | undefined {
	const match = new RegExp(`${name}:\\s*(\\d+)px;`).exec(source);
	return match === null ? undefined : Number(match[1]);
}

describe("样式表与布局契约一致", () => {
	it("右栏顶栏的容器折点", () => {
		expect(panel).toContain(`@container (width < ${LAYOUT_PX.workspaceTabBar.tight}px)`);
	});

	it("样式表里没有契约之外的容器折点", () => {
		// 新增一个折点必须先进契约再改样式，否则这里会红
		expect(new Set(containerBreakpoints(panel))).toEqual(new Set([LAYOUT_PX.workspaceTabBar.tight]));
	});

	it("正文最小可用宽与 `--main-min` 是同一个数", () => {
		expect(rootPx(base, "--main-min")).toBe(LAYOUT_PX.mainMinWidth);
	});

	it("窗口按钮簇的宽与 `:root` 里那条派生一致", () => {
		expect(LAYOUT_PX.windowControls.width).toBe(
			LAYOUT_PX.windowControls.buttonWidth * LAYOUT_PX.windowControls.buttonCount,
		);
		expect(rootPx(base, "--window-button-width")).toBe(LAYOUT_PX.windowControls.buttonWidth);
		expect(base).toContain(
			`--window-controls-width: calc(var(--window-button-width) * ${LAYOUT_PX.windowControls.buttonCount});`,
		);
	});

	it("文件树的边界与缺省宽是同一组数", () => {
		expect(rootPx(base, "--file-tree-min")).toBe(LAYOUT_PX.fileTree.minWidth);
		expect(rootPx(base, "--file-tree-default")).toBe(LAYOUT_PX.fileTree.defaultWidth);
		expect(rootPx(base, "--file-tree-max")).toBe(LAYOUT_PX.fileTree.maxWidth);
		expect(rootPx(base, "--editor-keep-width")).toBe(LAYOUT_PX.fileTree.editorKeepWidth);
	});

	it("两侧栏的上下限与缺省宽是同一组数", () => {
		expect(rootPx(base, "--sidebar-width")).toBe(LAYOUT_PX.sidebar.defaultWidth);
		// 左右栏的下限不写在样式里，只在脚本里用；这里只把「样式里有对应变量」的那几条对齐
		expect(panel).toContain("var(--file-tree-min)");
	});

	it("拖拽折叠的属性名在样式里只出现契约里的这两个", () => {
		const declared = Object.values(SHELL_DATA_ATTRS);
		for (const name of declared) {
			expect(panel).toContain(`.app[${name}="true"]`);
		}
		// 样式里出现的 `data-*-drag-collapsed` 不能有契约之外的第三个
		const used = new Set([...`${panel}${chrome}`.matchAll(/data-[\w-]*drag-collapsed/g)].map((m) => m[0]));
		expect(used).toEqual(new Set(declared));
	});

	it("左右栏的折叠预览属性各用一条,不串", () => {
		expect(panel).toContain(`.app[${SHELL_DATA_ATTRS.sidebarDragCollapsed}="true"] .sb`);
		expect(panel).toContain(`.app[${SHELL_DATA_ATTRS.panelDragCollapsed}="true"] .panel`);
		expect(chrome).toContain(`.app[${SHELL_DATA_ATTRS.sidebarDragCollapsed}="true"]`);
		expect(chrome).toContain(`.app[${SHELL_DATA_ATTRS.panelDragCollapsed}="true"]`);
	});
});
