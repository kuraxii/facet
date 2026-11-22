/**
 * 气泡与悬浮提示的留白归属。
 *
 * 两条几何关系各容易在不知不觉间回退：
 *
 * 1. **气泡的内边距是气垫自己的**：四边都借 `--space-8` 时竖向上比横向多出一截，而那个刻度
 *    同时是代码块与 Markdown 段落的留白，改它会把别处一起带走。所以气泡单有两个名字。
 * 2. **分段卡片不叠两层内边距**：`CommitTip` 每一段自己带横向留白，外层浮层再垫一圈就成了
 *    双层套壳，分隔线也顶不到边。只有这种自带分段的卡片开 `flush`，纯文字提示保持默认。
 *
 * 用例是静态断言：读样式表与源码，改一处就红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const base = readFileSync(join(here, "base.css"), "utf8");
const chat = readFileSync(join(here, "chat.css"), "utf8");
const overlays = readFileSync(join(here, "overlays.css"), "utf8");

/** 取一条规则的声明块。 */
function block(source: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`\\n${escaped} \\{([\\s\\S]*?)\\n\\}`).exec(source);
	if (match === null) {
		throw new Error(`没找到规则：${selector}`);
	}
	return match[1] ?? "";
}

/** 取 `:root` 里一条变量的值。 */
function token(name: string): string | undefined {
	return new RegExp(`${name}:\\s*([^;]+);`).exec(base)?.[1]?.trim();
}

describe("用户消息气泡的内边距", () => {
	it("横向与纵向各有一个名字，纵向走半档刻度", () => {
		expect(token("--bubble-padding-y")).toBe("var(--space-5)");
		expect(token("--bubble-padding-x")).toBe("14px");
	});

	it("公共间距刻度不被这一步牵动", () => {
		// 气泡曾经借 `--space-8`，改它就会一起改掉代码块与 Markdown 段落
		expect(token("--space-8")).toBe("16px");
	});

	it("`.bub` 只读这两个变量", () => {
		const bubble = block(chat, ".bub");
		expect(bubble).toContain("padding: var(--bubble-padding-y) var(--bubble-padding-x);");
		expect(bubble).not.toContain("var(--space-8)");
	});

	it("字号、行高、圆角与宽度不受影响", () => {
		const bubble = block(chat, ".bub");
		expect(bubble).toContain("max-width: 80%");
		expect(bubble).toContain(
			"border-radius: var(--radius-xl) var(--radius-sm) var(--radius-xl) var(--radius-xl)",
		);
		expect(bubble).toContain("font-size: var(--text-size)");
		expect(bubble).toContain("line-height: var(--leading-prose)");
	});
});

describe("悬浮提示的内边距归属", () => {
	it("默认是纯文字提示的那一圈留白", () => {
		const tip = block(overlays, ".pop-tip");
		expect(tip).toContain("padding: var(--space-4) var(--space-5);");
		// 圆角、上限与滚动只在这里出现一次，修饰态不重写
		expect(tip).toContain("border-radius: var(--radius-lg)");
		expect(tip).toContain("max-height: var(--tool-tip-height)");
		expect(tip).toContain("overflow: auto");
	});

	it("修饰态只把内边距归零", () => {
		const flush = block(overlays, ".pop-tip.is-flush");
		expect(flush.trim()).toBe("padding: 0;");
	});

	it("提交悬浮卡的三段自己带横向留白与通栏分隔线", () => {
		const style = readFileSync(join(here, "..", "git", "git.module.css"), "utf8");
		expect(block(style, ".commitTipMain")).toContain(
			"padding: var(--commit-tip-padding-y) var(--commit-tip-padding-x);",
		);
		const band = block(style, ".commitTipBand");
		expect(band).toContain("padding: var(--commit-tip-band-padding-y) var(--commit-tip-padding-x);");
		expect(band).toContain("border-top: 1px solid var(--border-subtle);");
	});

	it("段内节奏：首段内 8px、并列项 6px", () => {
		expect(token("--commit-tip-lead-gap")).toBe("var(--space-4)");
		expect(token("--commit-tip-row-gap")).toBe("var(--space-3)");
	});

	it("只有提交图谱这一处开修饰态，纯文字提示都不开", () => {
		const source = readFileSync(join(here, "..", "git", "git-graph-list.tsx"), "utf8");
		expect(source).toContain("useHoverTip({ holdOnLeave: true, flush: true })");

		const tipSource = readFileSync(join(here, "..", "tip.tsx"), "utf8");
		// 修饰态由参数决定，没有写死在某条路径上
		expect(tipSource).toContain('className={flush ? "pop-tip is-flush" : "pop-tip"}');
	});
});
