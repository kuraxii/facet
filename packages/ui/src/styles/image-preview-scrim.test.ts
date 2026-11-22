/**
 * 图片预览的遮罩浓度只在一处给。
 *
 * 整层盖的是 `.image-preview` 自己那层七成遮罩，`::backdrop` 保持透明——两处都上色的话浓度会
 * 叠成 `1 − (1−a)(1−b)`，改一个数字另一个跟着变，最后没人算得清实际是多少。这三条断言把口径
 * 钉在样式表里。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = join(import.meta.dirname);
const preview = readFileSync(join(styles, "image-preview.css"), "utf8");
const base = readFileSync(join(styles, "base.css"), "utf8");

describe("图片预览的遮罩", () => {
	it("遮罩浓度：`--bg-canvas` 取七成", () => {
		expect(base).toContain("--image-preview-scrim: color-mix(in srgb, var(--bg-canvas) 70%, transparent);");
	});

	it("整层那一层用它", () => {
		expect(preview).toContain("background: var(--image-preview-scrim);");
		expect(preview).not.toContain("background: var(--bg-canvas);");
	});

	it("`::backdrop` 透明，浓度不会叠两层", () => {
		const backdrop = /image-preview-dialog::backdrop \{\n\tbackground: ([^;]+);/.exec(preview);
		expect(backdrop?.[1]).toBe("transparent");
		expect(preview).not.toContain("var(--scrim-bg)");
	});
});
