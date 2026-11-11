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

	it("代码字体按三个字重声明,并指向打包后的 woff2", () => {
		const weights = [...fonts.matchAll(/font-weight: (\d+);/g)].map((match) => match[1]);
		expect(weights).toEqual(["400", "500", "600"]);
		expect(fonts.match(/url\("\.\.\/assets\/fonts\/maple-mono-\d+\.woff2"\)/g)).toHaveLength(3);
		expect(fonts).toContain('font-family: "Maple Mono"');
	});

	it("界面字体与代码字体的变量三处一致", () => {
		expect(index).toContain('@import "./fonts.css";');
		expect(index).toMatch(/--font-sans: Inter,/);
		expect(index).toMatch(/--font-mono: "Maple Mono",/);
		// markstream 的字体走同一个变量,不再单独写一份字体栈
		expect(index).toContain("--ms-font-sans: var(--font-sans);");
	});

	it("不再引入外部等宽字体包", () => {
		expect(index).not.toContain("jetbrains-mono");
	});
});
