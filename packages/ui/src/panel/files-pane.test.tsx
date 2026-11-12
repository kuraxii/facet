/**
 * 文件页的测试。
 *
 * 目录内容要等 effect 里取，服务端渲染只能覆盖加载态；交互部分靠手工验证。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilesPane } from "./files-pane.tsx";

describe("文件页", () => {
	it("还没取到目录时显示加载提示", () => {
		const html = renderToStaticMarkup(
			createElement(FilesPane, { loadDirectory: async () => [], onOpenFile: () => {} }),
		);
		expect(html).toContain("正在读取目录");
	});
});
