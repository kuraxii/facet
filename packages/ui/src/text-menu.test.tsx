import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextMenu } from "./text-menu.tsx";

describe("选中文字菜单", () => {
	it("没有右键之前不画任何东西", () => {
		const html = renderToStaticMarkup(createElement(TextMenu, { onCopy: () => undefined }));
		expect(html).toBe("");
	});
});
