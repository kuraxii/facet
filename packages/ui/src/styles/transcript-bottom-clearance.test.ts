/**
 * 滚到底部时，最后一行要落在输入区上方那条过渡带之上。
 *
 * 过渡带是 `.footer::before`：一条贴着输入区上缘、往上铺 `--control-lg` 的渐变，永远可见。
 * 正文字典里只留一档内边距时，滚到头最后一行（连同悬停才出现的复制 / 回退 / 分叉）正好坐在
 * 这条带子里，看着像被压住。`.scroll` 的下内边距因此取 `--transcript-bottom-clearance`。
 *
 * 用例是静态断言：带子抬高或让位距离被改小，这里就红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const base = readFileSync(join(import.meta.dirname, "base.css"), "utf8");
const chat = readFileSync(join(import.meta.dirname, "chat.css"), "utf8");
const composer = readFileSync(join(import.meta.dirname, "composer.css"), "utf8");

/** 取一条规则的声明块。选择器里的 `.` `:` 都要转义。 */
function block(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`\\n${escaped} \\{([\\s\\S]*?)\\n\\}`).exec(css);
	if (match === null) {
		throw new Error(`没找到规则：${selector}`);
	}
	return match[1] ?? "";
}

/** 取一条声明里的值，`prop` 之后到分号为止。 */
function declaration(declarations: string, prop: string): string {
	const match = new RegExp(`(?:^|\\n)\\s*${prop}: ([^;]+);`).exec(declarations);
	if (match === null) {
		throw new Error(`没找到声明：${prop}`);
	}
	return (match[1] ?? "").trim();
}

/** `:root` 里一条变量的原始值。 */
function rootVar(name: string): string {
	const match = new RegExp(`\\n\\s*${name}: ([^;]+);`).exec(base);
	if (match === null) {
		throw new Error(`:root 里没有 ${name}`);
	}
	return (match[1] ?? "").trim();
}

/**
 * 把 `var(--x)` / `calc(var(--a) + var(--b))` 算成像素数。
 *
 * 只认 px 与加法——这两个值本来就只有这种形态，真变成别的形态（百分比、乘法）时应当在这里报错，
 * 而不是悄悄算错。
 */
function toPx(value: string, depth = 0): number {
	if (depth > 8) {
		throw new Error(`变量绕圈了：${value}`);
	}
	const resolved = value.replace(
		/var\((--[\w-]+)\)/g,
		(_all, name: string) => `${toPx(rootVar(name), depth + 1)}px`,
	);
	const calc = /^calc\(([\s\S]+)\)$/.exec(resolved.trim());
	const expression = calc === null ? resolved.trim() : (calc[1] ?? "");
	let total = 0;
	for (const part of expression.split("+")) {
		const px = /^(-?\d+(?:\.\d+)?)px$/.exec(part.trim());
		if (px === null) {
			throw new Error(`不认识的长度：${part.trim()}（来自 ${value}）`);
		}
		total += Number(px[1]);
	}
	return total;
}

describe("滚到底部时最后一行让开过渡带", () => {
	it("过渡带是贴在输入区上缘、往上铺的那一条", () => {
		const band = block(composer, ".footer::before");
		expect(declaration(band, "position")).toBe("absolute");
		expect(declaration(band, "top")).toBe("0");
		// 往上平移自身高度，正好盖住视口的最后一条带子
		expect(declaration(band, "transform")).toBe("translateY(-100%)");
	});

	it("正文的下内边距不小于过渡带的高度", () => {
		const bandHeight = toPx(declaration(block(composer, ".footer::before"), "height"));
		const clearance = toPx(rootVar("--transcript-bottom-clearance"));
		expect(clearance).toBeGreaterThanOrEqual(bandHeight);
	});

	it("`.scroll` 的下内边距就是那一档让位距离", () => {
		const scroll = block(chat, ".scroll");
		const padding = declaration(scroll, "padding");
		expect(padding).toContain("var(--transcript-bottom-clearance)");
		// 上面那一条写在简写的最后一位，否则让位距离会被当成左内边距
		expect(padding.split(" ").at(-1)).toBe("var(--transcript-bottom-clearance)");
	});
});
