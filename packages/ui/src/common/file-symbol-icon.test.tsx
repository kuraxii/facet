// @vitest-environment jsdom
/**
 * `FileSymbolIcon` 与 `FolderSymbolIcon` 的渲染单测。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileSymbolIcon, FolderSymbolIcon } from "./FileSymbolIcon.tsx";

describe("FileSymbolIcon", () => {
	it("按后缀与完整文件名渲染区分度明确的 Symbols SVG 图标", () => {
		const tsSvg = renderToStaticMarkup(createElement(FileSymbolIcon, { name: "packages/ui/src/index.ts" }));
		const mtsSvg = renderToStaticMarkup(createElement(FileSymbolIcon, { name: "build/index.mts" }));
		const mdSvg = renderToStaticMarkup(createElement(FileSymbolIcon, { name: "README.md" }));
		const pkgSvg = renderToStaticMarkup(createElement(FileSymbolIcon, { name: "apps/desktop/package.json" }));
		const jsonSvg = renderToStaticMarkup(createElement(FileSymbolIcon, { name: "data.json" }));

		expect(tsSvg).toContain("<svg");
		expect(tsSvg).toContain('aria-hidden="true"');
		expect(
			renderToStaticMarkup(createElement(FileSymbolIcon, { name: "index.ts", className: "tree-icon" })),
		).toContain('class="tree-icon"');
		expect(mtsSvg).toBe(renderToStaticMarkup(createElement(FileSymbolIcon, { name: "index.ts" })));
		expect(mdSvg).not.toBe(tsSvg);
		expect(pkgSvg).not.toBe(jsonSvg);
	});
});

describe("FolderSymbolIcon", () => {
	it("命中语义目录用对应目录图标，普通目录随展开切换默认开合图标", () => {
		const srcClosed = renderToStaticMarkup(createElement(FolderSymbolIcon, { name: "src", isOpen: false }));
		const srcOpen = renderToStaticMarkup(createElement(FolderSymbolIcon, { name: "src", isOpen: true }));
		const genericClosed = renderToStaticMarkup(
			createElement(FolderSymbolIcon, { name: "custom-folder", isOpen: false }),
		);
		const genericOpen = renderToStaticMarkup(
			createElement(FolderSymbolIcon, { name: "custom-folder", isOpen: true }),
		);

		expect(srcClosed).toBe(srcOpen);
		expect(srcClosed).not.toBe(genericClosed);
		expect(genericOpen).not.toBe(genericClosed);
	});
});
