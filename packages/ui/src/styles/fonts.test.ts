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
	const base = read("base.css");
	const markdown = read("markdown.css");
	const pkg = JSON.parse(readFileSync(join(styles, "..", "..", "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
	};

	it("代码字体只声明 400 与 600 两档", () => {
		const weights = [...fonts.matchAll(/font-weight: (\d+);/g)].map((match) => match[1]);
		expect(weights).toEqual(["400", "600"]);
		expect(fonts.match(/url\("\.\.\/assets\/fonts\/maple-mono-cn-\d+\.woff2"\)/g)).toHaveLength(2);
		expect(fonts).toContain('font-family: "Maple Mono CN"');
	});

	it("代码字体的汉字交给界面中文字体兜底", () => {
		// 子集里没有汉字与全角标点，等宽栈必须自己带上中文，否则会落到各机器自己的回退
		expect(base).toMatch(/--font-mono:\s*"Maple Mono CN", "Noto Sans SC Variable",/);
	});

	it("代码字体直接使用完整 CN 文件,不再依赖外部分片包", () => {
		expect(fonts).not.toContain("@automann/maple-mono-cn");
		expect(pkg.dependencies?.["@automann/maple-mono-cn"]).toBeUndefined();
	});

	it("界面字体的汉字由 noto-sans-sc 可变字体补上", () => {
		const sansImport = '@import "@fontsource-variable/noto-sans-sc";';
		expect(fonts).toContain(sansImport);
		expect(fonts.indexOf(sansImport)).toBeLessThan(fonts.indexOf("@font-face"));
		expect(base).toMatch(/--font-sans: Inter, "Noto Sans SC Variable",/);
	});

	it("界面字体与代码字体的变量三处一致", () => {
		expect(index).toContain('@import "./fonts.css";');
		expect(base).toMatch(/--font-sans: Inter,/);
		expect(base).toMatch(/--font-mono:\s*"Maple Mono CN",/);
		// markstream 的字体走同一个变量,不再单独写一份字体列表
		expect(markdown).toContain("--ms-font-sans: var(--font-sans);");
	});

	it("字体包只有 Inter 与 noto-sans-sc", () => {
		const imported = [...(index + fonts).matchAll(/@import\s+"(@[^"]+)"/g)].map((match) => match[1]);
		expect(new Set(imported)).toEqual(
			new Set([
				"@fontsource-variable/noto-sans-sc",
				"@fontsource/inter/400.css",
				"@fontsource/inter/500.css",
				"@fontsource/inter/600.css",
			]),
		);
	});
});
