import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = join(import.meta.dirname);

function read(name: string): string {
	return readFileSync(join(styles, name), "utf8");
}

describe("自带字体", () => {
	const fonts = read("fonts.css");
	const index = read("index.css");
	const pkg = JSON.parse(readFileSync(join(styles, "..", "..", "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
	};

	it("代码字体的拉丁与符号按三个字重声明,并指向打包后的 woff2", () => {
		const weights = [...fonts.matchAll(/font-weight: (\d+);/g)].map((match) => match[1]);
		expect(weights).toEqual(["400", "500", "600"]);
		expect(fonts.match(/url\("\.\.\/assets\/fonts\/maple-mono-\d+\.woff2"\)/g)).toHaveLength(3);
		expect(fonts).toContain('font-family: "Maple Mono"');
	});

	it("汉字与中文标点由 maple-mono-cn 的 400 分片补上", () => {
		const cjkImport = '@import "@automann/maple-mono-cn/400.css";';
		expect(fonts).toContain(cjkImport);
		// @import 必须排在同文件的 @font-face 之前,否则浏览器会整条忽略
		expect(fonts.indexOf(cjkImport)).toBeLessThan(fonts.indexOf("@font-face"));
		expect(pkg.dependencies?.["@automann/maple-mono-cn"]).toMatch(/^(\^|~)?7\.9\./);
	});

	it("界面字体的汉字由 noto-sans-sc 可变字体补上", () => {
		const sansImport = '@import "@fontsource-variable/noto-sans-sc";';
		expect(fonts).toContain(sansImport);
		expect(fonts.indexOf(sansImport)).toBeLessThan(fonts.indexOf("@font-face"));
		expect(index).toMatch(/--font-sans: Inter, "Noto Sans SC Variable",/);
	});

	it("界面字体与代码字体的变量三处一致", () => {
		expect(index).toContain('@import "./fonts.css";');
		expect(index).toMatch(/--font-sans: Inter,/);
		expect(index).toMatch(/--font-mono: "Maple Mono", "Maple Mono CN",/);
		// markstream 的字体走同一个变量,不再单独写一份字体列表
		expect(index).toContain("--ms-font-sans: var(--font-sans);");
	});

	it("字体包只有 Inter、noto-sans-sc 与 maple-mono-cn", () => {
		const imported = [...(index + fonts).matchAll(/@import\s+"(@[^"]+)"/g)].map((match) => match[1]);
		expect(new Set(imported)).toEqual(
			new Set([
				"@automann/maple-mono-cn/400.css",
				"@fontsource-variable/noto-sans-sc",
				"@fontsource/inter/400.css",
				"@fontsource/inter/500.css",
				"@fontsource/inter/600.css",
			]),
		);
	});
});
