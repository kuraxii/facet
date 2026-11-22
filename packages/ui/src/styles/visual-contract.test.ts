// @vitest-environment node
// 这份用例直接读仓库里的 CSS 源码，要有真实的文件系统与 `file:` URL。
/**
 * 视觉契约：`base.css` 的 `:root` 与 `visual-contract.ts` 逐条对齐，外加两道全仓闸。
 *
 * 三件事：
 * 1. **刻度对齐**：字号、行高、间距、控件高度、圆角、图标、动效、以及那几个脚本要读的长度，
 *    样式表里的值必须与 `visual-contract.ts` 相等。两边各改一处就等于漂移，而漂移了也看不
 *    出来——只能靠读源码比对。
 * 2. **纪律闸**：`0` 处 `!important`、`0` 处裸 `z-index`、`0` 处非 `prefers-*` 的 `@media`。
 * 3. **棘轮**：每个样式文件里还写死着多少个字号 / 圆角 / gap / padding / 阴影 / 过渡，
 *    记在 `VISUAL_DEBT_BASELINE` 里，只许降不许升。新增一个 CSS 文件必须在这里登记基线，
 *    否则这条用例会红——不然新文件从第一天起就可以随便写死数值。
 *
 * 棘轮的计数口径（与迁移步骤一一对应）：
 * - 一条声明里**一个 `var()` 都没有**，就算写死：`font-size: 12px` 算，`var(--text-xs)` 不算，
 *   `calc(var(--a) - 1px)` 不算。
 * - `transition` 另算：把 `var(...)` 整段抹掉之后还剩下时间字面量（`120ms` / `0.18s`）或缓动
 *   关键字（`ease` / `linear` / `cubic-bezier` / `steps`）才算。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { VISUAL_PX, VISUAL_SCALE } from "./visual-contract.ts";

/** `packages/` 目录：`packages/ui/src/styles` 往上三层。 */
const PACKAGES = join(import.meta.dirname, "..", "..", "..");

/** 读一份 `packages/` 下的文件。 */
function read(relativePath: string): string {
	return readFileSync(join(PACKAGES, relativePath), "utf8");
}

/** 收全仓的样式表，路径相对 `packages/`，分隔符统一成 `/`。 */
function collectCss(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") {
			continue;
		}
		const full = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(...collectCss(full));
			continue;
		}
		if (entry.name.endsWith(".css")) {
			found.push(relative(PACKAGES, full).split(sep).join("/"));
		}
	}
	return found;
}

const CSS_FILES = collectCss(PACKAGES).sort();

const base = read("ui/src/styles/base.css");

/** 取一份源码里某个变量第一次声明的值（去空白）。 */
function declaredValue(source: string, name: string): string | undefined {
	const match = new RegExp(`(?:^|[\\s{;])${name}:\\s*([^;]+);`).exec(source);
	return match?.[1]?.trim().replace(/\s+/g, " ");
}

/** `:root` 里该有的刻度：变量名 → 期望值。 */
const SCALE_DECLARATIONS: readonly (readonly [string, string])[] = [
	// 字号阶梯
	["--text-xs", `${VISUAL_SCALE.text.xs}px`],
	["--text-ui", `${VISUAL_SCALE.text.ui}px`],
	["--text-body", `${VISUAL_SCALE.text.body}px`],
	["--text-title-sm", `${VISUAL_SCALE.text.titleSm}px`],
	["--text-title-md", `${VISUAL_SCALE.text.titleMd}px`],
	["--text-title-lg", `${VISUAL_SCALE.text.titleLg}px`],
	// 行高
	["--leading-tight", `${VISUAL_SCALE.leading.tight}px`],
	["--leading-ui", `${VISUAL_SCALE.leading.ui}px`],
	["--leading-prose", `${VISUAL_SCALE.leading.prose}px`],
	["--leading-display", `${VISUAL_SCALE.leading.display}px`],
	// 间距
	["--space-1", `${VISUAL_SCALE.space.s1}px`],
	["--space-2", `${VISUAL_SCALE.space.s2}px`],
	["--space-3", `${VISUAL_SCALE.space.s3}px`],
	["--space-4", `${VISUAL_SCALE.space.s4}px`],
	["--space-5", `${VISUAL_SCALE.space.s5}px`],
	["--space-6", `${VISUAL_SCALE.space.s6}px`],
	["--space-8", `${VISUAL_SCALE.space.s8}px`],
	["--space-10", `${VISUAL_SCALE.space.s10}px`],
	["--space-12", `${VISUAL_SCALE.space.s12}px`],
	["--space-16", `${VISUAL_SCALE.space.s16}px`],
	// 控件高度
	["--control-xs", `${VISUAL_SCALE.control.xs}px`],
	["--control-sm", `${VISUAL_SCALE.control.sm}px`],
	["--control-md", `${VISUAL_SCALE.control.md}px`],
	["--control-lg", `${VISUAL_SCALE.control.lg}px`],
	// 圆角
	["--radius-sm", `${VISUAL_SCALE.radius.sm}px`],
	["--radius-md", `${VISUAL_SCALE.radius.md}px`],
	["--radius-lg", `${VISUAL_SCALE.radius.lg}px`],
	["--radius-xl", `${VISUAL_SCALE.radius.xl}px`],
	["--radius-pill", `${VISUAL_SCALE.radius.pill}px`],
	// 图标
	["--icon-sm", `${VISUAL_SCALE.icon.sm}px`],
	["--icon-md", `${VISUAL_SCALE.icon.md}px`],
	["--icon-lg", `${VISUAL_SCALE.icon.lg}px`],
	// 动效
	["--dur-fast", `${VISUAL_SCALE.motion.fastMs}ms`],
	["--dur-slow", `${VISUAL_SCALE.motion.slowMs}ms`],
	["--ease-standard", VISUAL_SCALE.motion.ease],
];

/**
 * 脚本要读的那几个长度：变量名 → 期望值。
 *
 * 这几条不是刻度，各自量一处几何关系；样式表里有同名变量，脚本从 `VISUAL_PX` 取同一个数。
 */
const NAMED_DECLARATIONS: readonly (readonly [string, string])[] = [
	["--chat-column-max", `${VISUAL_PX.readingColumnMax}px`],
	["--outline-inset", `${VISUAL_PX.outlineRail.inset}px`],
	["--outline-rail-width", `calc(${VISUAL_PX.outlineRail.width}px * var(--outline-scale))`],
	["--workspace-menu-edge", `${VISUAL_PX.popover.menuEdge}px`],
	["--workspace-menu-offset", `${VISUAL_PX.popover.menuOffset}px`],
	["--tool-tip-gap", `${VISUAL_PX.popover.tipGap}px`],
	["--text-menu-edge", `${VISUAL_PX.popover.textMenuEdge}px`],
	["--editor-head-gap", `${VISUAL_PX.editorHeadGap}px`],
];

/** 存量债的计数维度。 */
type DebtKind = "fontSize" | "radius" | "gap" | "padding" | "shadow" | "transition";

/** 一个文件里各维度还剩多少条写死的声明。 */
type DebtCount = Record<DebtKind, number>;

/** 各维度匹配的属性名。 */
const DEBT_PROPS: readonly (readonly [DebtKind, RegExp])[] = [
	["fontSize", /^font-size$/],
	["radius", /^border-radius$/],
	["gap", /^(?:gap|row-gap|column-gap)$/],
	["padding", /^padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?$/],
	["shadow", /^box-shadow$/],
	["transition", /^transition(?:-property|-duration|-timing-function|-delay)?$/],
];

/**
 * 棘轮基线：按文件记下当前的存量，只许降不许升。
 *
 * 数值是 Phase 1 落地刻度时各文件的实际条数，不是目标值。每迁完一个文件就把它那一行改小；
 * 一个文件归零之后，这一行就是 0 且不会再长回去。
 */
const VISUAL_DEBT_BASELINE: Readonly<Record<string, DebtCount>> = {
	"ui-terminal/src/terminal.css": { fontSize: 5, radius: 3, gap: 5, padding: 8, shadow: 0, transition: 0 },
	"ui/src/chat/ExtensionPromptCard.module.css": {
		fontSize: 7,
		radius: 5,
		gap: 3,
		padding: 2,
		shadow: 0,
		transition: 0,
	},
	"ui/src/git/git.module.css": { fontSize: 10, radius: 2, gap: 2, padding: 9, shadow: 0, transition: 0 },
	"ui/src/panel/changes.module.css": {
		fontSize: 10,
		radius: 2,
		gap: 0,
		padding: 9,
		shadow: 0,
		transition: 0,
	},
	"ui/src/styles/base.css": { fontSize: 0, radius: 1, gap: 0, padding: 0, shadow: 0, transition: 0 },
	"ui/src/styles/changes.css": { fontSize: 10, radius: 2, gap: 5, padding: 5, shadow: 0, transition: 0 },
	"ui/src/styles/chat.css": { fontSize: 22, radius: 19, gap: 21, padding: 22, shadow: 1, transition: 2 },
	"ui/src/styles/chrome.css": { fontSize: 7, radius: 5, gap: 4, padding: 7, shadow: 1, transition: 0 },
	"ui/src/styles/composer.css": { fontSize: 12, radius: 14, gap: 10, padding: 14, shadow: 3, transition: 0 },
	"ui/src/styles/fonts.css": { fontSize: 0, radius: 0, gap: 0, padding: 0, shadow: 0, transition: 0 },
	"ui/src/styles/git-graph.css": { fontSize: 0, radius: 0, gap: 0, padding: 0, shadow: 0, transition: 0 },
	"ui/src/styles/index.css": { fontSize: 0, radius: 0, gap: 0, padding: 0, shadow: 0, transition: 0 },
	"ui/src/styles/markdown.css": { fontSize: 9, radius: 4, gap: 1, padding: 10, shadow: 1, transition: 1 },
	"ui/src/styles/motion.css": { fontSize: 0, radius: 0, gap: 0, padding: 0, shadow: 0, transition: 0 },
	"ui/src/styles/overlays.css": { fontSize: 23, radius: 17, gap: 14, padding: 22, shadow: 5, transition: 2 },
	"ui/src/styles/panel.css": { fontSize: 13, radius: 12, gap: 8, padding: 23, shadow: 2, transition: 0 },
	"ui/src/styles/settings.css": { fontSize: 33, radius: 20, gap: 34, padding: 27, shadow: 2, transition: 0 },
	"ui/src/styles/sidebar.css": { fontSize: 28, radius: 18, gap: 19, padding: 23, shadow: 3, transition: 0 },
	"ui/src/styles/theme.css": { fontSize: 0, radius: 0, gap: 0, padding: 0, shadow: 0, transition: 0 },
};

/** 去掉注释：注释里举例写的数值不算存量。 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 把每个 `var(...)` 整段抹成空白，剩下的是写死在声明里的部分。 */
function stripVars(value: string): string {
	let out = "";
	let index = 0;
	while (index < value.length) {
		if (!value.startsWith("var(", index)) {
			out += value[index];
			index += 1;
			continue;
		}
		let depth = 0;
		let cursor = index;
		for (; cursor < value.length; cursor += 1) {
			if (value[cursor] === "(") {
				depth += 1;
			} else if (value[cursor] === ")") {
				depth -= 1;
				if (depth === 0) {
					cursor += 1;
					break;
				}
			}
		}
		out += " ";
		index = cursor;
	}
	return out;
}

/** 一条声明：属性、值。注释已去掉，值的分号是声明的终点。 */
const DECLARATION = /^[ \t]*([a-zA-Z-]+)[ \t]*:[ \t]*([^;]+);/gm;

/** 裸时间字面量：`120ms` / `0.18s`。 */
const RAW_TIME = /\d(?:\.\d+)?m?s\b/;

/** 裸缓动关键字。 */
const RAW_EASING = /\b(?:ease|linear|cubic-bezier|steps)\b/;

/** 数一个文件里的存量债。 */
function countDebt(source: string): DebtCount {
	const counts: DebtCount = { fontSize: 0, radius: 0, gap: 0, padding: 0, shadow: 0, transition: 0 };
	for (const match of stripComments(source).matchAll(DECLARATION)) {
		const property = match[1] ?? "";
		const value = match[2] ?? "";
		for (const [kind, pattern] of DEBT_PROPS) {
			if (!pattern.test(property)) {
				continue;
			}
			if (kind === "transition") {
				const raw = stripVars(value);
				if (RAW_TIME.test(raw) || RAW_EASING.test(raw)) {
					counts.transition += 1;
				}
				continue;
			}
			if (!value.includes("var(")) {
				counts[kind] += 1;
			}
		}
	}
	return counts;
}

describe("视觉刻度与 visual-contract 一致", () => {
	it("`:root` 里的刻度就是契约里的那几个数", () => {
		for (const [name, expected] of SCALE_DECLARATIONS) {
			expect(declaredValue(base, name), name).toBe(expected);
		}
	});

	it("脚本要读的具名长度与样式表是同一个数", () => {
		for (const [name, expected] of NAMED_DECLARATIONS) {
			expect(declaredValue(base, name), name).toBe(expected);
		}
	});

	it("正文字号只有一个入口，指向 `--text-body`", () => {
		// 对话正文、气泡与 Markdown 都读 `--text-size`；它自己不许再写一份死数字
		expect(declaredValue(base, "--text-size")).toBe("var(--text-body)");
	});

	it("动效曲线只有一个名字，旧名不再出现", () => {
		expect(base).not.toMatch(/\n\t--ease:/);
		for (const file of CSS_FILES) {
			expect(read(file)).not.toContain("var(--ease)");
		}
	});
});

describe("全仓样式纪律", () => {
	it("没有 `!important`", () => {
		for (const file of CSS_FILES) {
			expect(read(file), file).not.toContain("!important");
		}
	});

	it("没有裸 `z-index`，只认 `var(--z-*)`", () => {
		for (const file of CSS_FILES) {
			for (const match of read(file).matchAll(/z-index:\s*([^;]+);/g)) {
				expect(match[1]?.trim(), `${file} 的 z-index`).toMatch(/^var\(--z-[a-z-]+\)$/);
			}
		}
	});

	it("没有 `prefers-*` 之外的 `@media`", () => {
		for (const file of CSS_FILES) {
			for (const match of read(file).matchAll(/@media[^{]*/g)) {
				expect(match[0], file).toContain("prefers-");
			}
		}
	});
});

describe("写死数值的棘轮只许往下走", () => {
	it("每个样式文件都登记了基线", () => {
		// 新增文件必须先进基线再写样式，不然它从第一天起就可以随便写死数值
		expect(CSS_FILES).toEqual(Object.keys(VISUAL_DEBT_BASELINE).sort());
	});

	it("各文件的存量不超过基线", () => {
		for (const file of CSS_FILES) {
			const baseline = VISUAL_DEBT_BASELINE[file];
			const actual = countDebt(read(file));
			for (const kind of Object.keys(actual) as DebtKind[]) {
				expect(actual[kind], `${file} 的 ${kind}`).toBeLessThanOrEqual(baseline?.[kind] ?? 0);
			}
		}
	});
});
