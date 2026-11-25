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
 * 3. **零债门禁**：全仓每个样式文件里，字号 / 圆角 / gap / padding / 阴影 / 过渡都不许写死，
 *    一律走刻度变量。没有基线表、没有豁免表：新加的文件从第一天起就按同一把尺子量。
 *
 * 计数口径（一条声明算不算写死）：
 * - 声明里有 `var()`，就不算：`var(--text-xs)` 与 `calc(var(--a) - 1px)` 都算走变量。
 *   边框折叠、图标基线这类结构性的 ±1～2px 微调因此本来就是 `calc(...)`，不会被误伤。
 * - 全零复位（`padding: 0`）不算：它没有引入数值。
 * - 只写相对单位的字号（`1.6em` 标题、`0.8em` 行内代码）不算：它跟着父级缩放，换成固定档位
 *   反而丢掉这层关系。
 * - `transition` 另算：把 `var(...)` 整段抹掉之后还剩下时间字面量（`120ms` / `0.18s`）或缓动
 *   关键字（`ease` / `linear` / `cubic-bezier` / `steps`）才算。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_SIZE, ICON_STROKE_WIDTH, VISUAL_PX, VISUAL_SCALE } from "./visual-contract.ts";

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

/** 收全仓的 TSX，路径相对 `packages/`；`apps/` 也在这里，因为外壳组件同样受图标真值约束。 */
function collectTsx(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") {
			continue;
		}
		const full = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(...collectTsx(full));
			continue;
		}
		if (entry.name.endsWith(".tsx")) {
			found.push(relative(PACKAGES, full).split(sep).join("/"));
		}
	}
	return found;
}

const TSX_FILES = [...collectTsx(PACKAGES), ...collectTsx(join(PACKAGES, "..", "apps"))].sort();

/** 读一份 `packages/` 之外的源码：`apps/` 下的路径以 `../apps/` 开头。 */
function readAny(relativePath: string): string {
	const path = relativePath.startsWith("../apps/")
		? join(PACKAGES, relativePath)
		: join(PACKAGES, relativePath);
	return readFileSync(path, "utf8");
}

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
	// 代码区比例排版
	["--leading-code-block", `${VISUAL_SCALE.code.lineHeight}`],
	["--text-code-inline", `${VISUAL_SCALE.code.inlineScaleEm}em`],
	// 动效
	["--dur-fast", `${VISUAL_SCALE.motion.fastMs}ms`],
	["--dur-slow", `${VISUAL_SCALE.motion.slowMs}ms`],
	["--dur-enter", `${VISUAL_SCALE.motion.enterMs}ms`],
	["--dur-structural", `${VISUAL_SCALE.motion.structuralMs}ms`],
	["--ease-standard", VISUAL_SCALE.motion.ease],
	["--ease-out", VISUAL_SCALE.motion.easeOut],
	["--ease-in", VISUAL_SCALE.motion.easeIn],
	["--ease-enter", VISUAL_SCALE.motion.easeEnter],
	["--ease-panel", VISUAL_SCALE.motion.easePanel],
	// 图标描边：界面图标（lucide 与自绘 `.ui-icon`）的唯一宽度
	["--icon-stroke-width", `${ICON_STROKE_WIDTH}px`],
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
	["--image-preview-edge", `${VISUAL_PX.imagePreviewEdge}px`],
	// 三列聊天轨道：左留白与右轨占位都由别的刻度拼出来，断言拼法而不是断言数
	["--chat-gutter-min", "var(--space-10)"],
	["--outline-slot", "calc(var(--outline-rail-width) + var(--outline-inset) * 2)"],
	["--diff-gutter-old", `${VISUAL_PX.diff.gutterOld}px`],
	["--diff-gutter-new", `${VISUAL_PX.diff.gutterNew}px`],
	["--diff-gutter-sign", `${VISUAL_PX.diff.gutterSign}px`],
];

/** 存量债的计数维度。 */
type DebtKind = "fontSize" | "radius" | "gap" | "padding" | "shadow" | "transition";

/** 一个文件里各维度还剩多少条写死的声明。 */
type DebtCount = Record<DebtKind, number>;

/** 六个数一起看：门禁逐维度断言为 0。 */
const DEBT_KINDS: readonly DebtKind[] = ["fontSize", "radius", "gap", "padding", "shadow", "transition"];

/** 只写相对单位的字号：跟着父级走，不算写死的数值。 */
const RELATIVE_SIZE = /^-?[\d.]+(?:em|rem|%)$/;

/** 各维度匹配的属性名。 */
const DEBT_PROPS: readonly (readonly [DebtKind, RegExp])[] = [
	["fontSize", /^font-size$/],
	["radius", /^border-radius$/],
	["gap", /^(?:gap|row-gap|column-gap)$/],
	["padding", /^padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?$/],
	["shadow", /^box-shadow$/],
	["transition", /^transition(?:-property|-duration|-timing-function|-delay)?$/],
];

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
			// `padding: 0` 这类全零复位不是"写死的数值"，不计入
			if (value.includes("var(") || !/[1-9]/.test(value)) {
				continue;
			}
			// Markdown 里跟着父级缩放的相对字号（`1.6em` / `0.8em`）不是写死的像素值：
			// 标题与行内代码要跟着正文一起放大，换成固定档位反而丢掉这层关系
			if (kind === "fontSize" && RELATIVE_SIZE.test(value.trim())) {
				continue;
			}
			counts[kind] += 1;
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

/**
 * 由脚本在运行期写到元素上、CSS 里不该出现定义的变量。
 *
 * 每一条都要指得出写入方；新增一个这样的名字必须同时在这里登记，否则"引用了变量却没人定义"
 * 会悄悄变成一条透明或失效的声明。
 */
const RUNTIME_SET_VARS: readonly string[] = [
	// 目录树的层级：行内 style 写在每个 `tree-row` 上（`files-pane.tsx` / `changes-pane.tsx`）
	"--files-depth",
	"--changes-depth",
	// 滚动容器：`ScrollArea` 关掉沟槽时写 `auto`，行自己给横向留白（`scroll-area.tsx`）
	"--scroll-gutter",
	"--scroll-inset",
];

describe("变量都有定义", () => {
	it("样式里引用的每个变量都有人定义，或在运行期写入", () => {
		const defined = new Set<string>();
		for (const file of CSS_FILES) {
			for (const match of read(file).matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
				defined.add(match[1] ?? "");
			}
		}
		const missing: string[] = [];
		for (const file of CSS_FILES) {
			for (const match of read(file).matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
				const name = match[1] ?? "";
				if (!defined.has(name) && !RUNTIME_SET_VARS.includes(name)) {
					missing.push(`${file}: ${name}`);
				}
			}
		}
		expect([...new Set(missing)]).toEqual([]);
	});
});

describe("图标只有一份真值", () => {
	it("全局 `svg` 规则不再写死描边宽度", () => {
		// 以前那条 `svg { stroke-width: 1.8 }` 压过了 lucide 组件上的七十多处 strokeWidth，
		// 那些属性一个都没生效；宽度改由 `.lucide` / `.ui-icon` 上的变量给
		for (const file of CSS_FILES) {
			const source = stripComments(read(file));
			for (const match of source.matchAll(/(?:^|\n)svg[ \t]*\{([^}]*)\}/g)) {
				expect(match[1] ?? "", file).not.toContain("stroke-width");
			}
		}
	});

	it("描边宽度只落在 `.lucide` 与自绘的 `.ui-icon` 上", () => {
		const source = stripComments(base);
		expect(source).toContain(".lucide,\n.ui-icon {\n\tstroke-width: var(--icon-stroke-width);\n}");
	});

	it("TSX 里不再给 lucide 图标写 strokeWidth", () => {
		const offenders = TSX_FILES.filter((file) => {
			const source = readAny(file);
			return source.includes("lucide-react") && /strokeWidth=/.test(source);
		});
		expect(offenders).toEqual([]);
	});

	it("图标尺寸只挑三档，且从 `ICON_SIZE` 取", () => {
		const offenders: string[] = [];
		for (const file of TSX_FILES) {
			const source = readAny(file);
			// `size={12}` 这类裸数字一律不许：要么 ICON_SIZE.*，要么由调用方传进来的变量
			for (const match of source.matchAll(/\bsize=\{(\d+)\}/g)) {
				offenders.push(`${file}: size={${match[1]}}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("三档尺寸与契约一致", () => {
		expect(ICON_SIZE).toEqual(VISUAL_SCALE.icon);
		expect([ICON_SIZE.sm, ICON_SIZE.md, ICON_SIZE.lg]).toEqual([12, 14, 16]);
	});

	it("TSX 里没有绕开样式表的内联字号", () => {
		const offenders = TSX_FILES.filter((file) => /fontSize:\s*["'\d]/.test(readAny(file)));
		expect(offenders).toEqual([]);
	});
});

describe("全仓样式纪律", () => {
	it("没有 `!important`", () => {
		// 只看真声明：注释里解释"不需要 !important"是正常的
		for (const file of CSS_FILES) {
			expect(stripComments(read(file)), file).not.toContain("!important");
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

/**
 * 允许写裸颜色字面量的位置：都是"不是主题色"的两类东西。
 *
 * 除了这两类，任何颜色都必须来自 `theme.css`（组件读变量）；新写一个字面量会让下面那条用例红。
 */
const COLOR_LITERAL_EXEMPT_FILES: readonly string[] = [
	// 泳道色不属于语义色板：六个提交列的颜色是按列循环的图形，不与主题联动
	"ui/src/styles/git-graph.css",
	// 配色真值本身
	"ui/src/styles/theme.css",
];

/**
 * 逐行豁免的颜色字面量：遮罩与"跟随系统"色片的预览。
 *
 * 遮罩只取 alpha 通道，写什么颜色都一样；色片预览要让深浅两半同时出现，天然是两个字面色。
 */
const COLOR_LITERAL_ALLOWLIST: readonly string[] = [
	// 两条遮罩只取 alpha 通道，颜色本身不参与成像
	"mask-image: linear-gradient(to bottom, transparent 0, #000 6px, #000 100%);",
	"mask-image: linear-gradient(to right, #000 0, #000 calc(100% - var(--sb-title-fade)), transparent 100%);",
	// 「跟随系统」色片：深浅两半同时出现，天然是两个字面色
	"background: linear-gradient(135deg, #f4f4f5 0 50%, #272a29 50% 100%);",
];

describe("颜色只从主题来", () => {
	/** 一条声明里的颜色字面量：十六进制、`rgb()`、`hsl()`。 */
	const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

	/** 收一份样式里所有带颜色字面量的行（去注释、去空白）。 */
	function literalLines(source: string): string[] {
		return stripComments(source)
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => COLOR_LITERAL.test(line));
	}

	it("`theme.css` 与泳道色之外没有裸颜色字面量", () => {
		const offenders: string[] = [];
		for (const file of CSS_FILES) {
			if (COLOR_LITERAL_EXEMPT_FILES.includes(file)) {
				continue;
			}
			for (const line of literalLines(read(file))) {
				if (!COLOR_LITERAL_ALLOWLIST.includes(line)) {
					offenders.push(`${file}: ${line}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("豁免清单里的每一条都还在，不留过期项", () => {
		const sources = CSS_FILES.filter((file) => !COLOR_LITERAL_EXEMPT_FILES.includes(file)).map(read);
		const present = sources.flatMap(literalLines);
		for (const line of COLOR_LITERAL_ALLOWLIST) {
			expect(present, line).toContain(line);
		}
	});
});

/**
 * 原生 `<button>` 的样式底：要么套了原语（`ui-` 前缀的类），要么它自己那组类在样式表里带着
 * 尺寸或底色。两样都不占，它就会以浏览器默认的灰方块出现——按钮的几何从样式表里删了、元素却
 * 没换成原语时，屏幕上长的就是这个样子。
 */
/**
 * 滚动类监听器必须显式声明 `passive`。
 *
 * 不写第三参数时浏览器要把这次滚动当成可能 `preventDefault()` 的来等，主线程一忙就掉帧。
 * 真正需要拦默认行为的（Mermaid 图的 Ctrl+滚轮缩放）写 `passive: false`，其余一律
 * `passive: true`——两种都算"声明过"，漏写才算违规。
 */
describe("滚动监听的 passive 声明", () => {
	it("所有 scroll / wheel / touch 监听都显式声明了 passive", () => {
		const offenders: string[] = [];
		const pattern = /addEventListener\(\s*"(?:scroll|wheel|touchstart|touchmove)"\s*,[^)]*?\)/g;
		for (const file of TSX_FILES) {
			if (file.includes(".test.")) {
				continue;
			}
			for (const match of readAny(file).matchAll(pattern)) {
				if (!/passive\s*:/.test(match[0])) {
					offenders.push(`${file}: ${match[0].replace(/\s+/g, " ")}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("原生按钮必须自带样式底", () => {
	/** 从 `from` 开始取一段配平的 `{...}`，含两侧花括号；取不到时返回 `undefined`。 */
	function braced(source: string, from: number): string | undefined {
		if (source[from] !== "{") {
			return undefined;
		}
		let depth = 0;
		for (let index = from; index < source.length; index += 1) {
			const char = source[index];
			if (char === "{") {
				depth += 1;
			} else if (char === "}") {
				depth -= 1;
				if (depth === 0) {
					return source.slice(from, index + 1);
				}
			}
		}
		return undefined;
	}

	/** 取 `<button>` 标签里 `className` 那一串：静态字符串，或者 `{...}` 里的表达式。 */
	function classNameOf(tag: string): string | undefined {
		const at = tag.indexOf("className=");
		if (at < 0) {
			return undefined;
		}
		const after = at + "className=".length;
		if (tag[after] === '"') {
			const close = tag.indexOf('"', after + 1);
			return close < 0 ? undefined : tag.slice(after, close + 1);
		}
		return tag[after] === "{" ? braced(tag, after) : undefined;
	}

	it("每个 `<button>` 要么用原语，要么它的类名在样式表里有几何", () => {
		const css = CSS_FILES.map(read).join("\n");
		const styled = (name: string): boolean => {
			if (name.startsWith("ui-")) {
				return true;
			}
			// 只认顶层规则块：`border: 0` 这类复位不算几何，宽度 / 高度 / 底色 / 圆角才算
			const rule = new RegExp(`^[^\\n{}]*\\.${name}(?![\\w-])[^\\n{}]*\\{([^}]*)\\}`, "gm");
			for (const match of css.matchAll(rule)) {
				if (/(?:^|\s)(?:width|height|min-height|background|border-radius)\s*:/.test(match[1] ?? "")) {
					return true;
				}
			}
			return false;
		};
		const offenders: string[] = [];
		for (const file of TSX_FILES) {
			// 原语自己那几份是样式来源，按钮元素在里面本来就不写 className；用例与常量文件不渲染界面
			if (file.includes(".test.") || file.includes("ui/src/common/")) {
				continue;
			}
			const source = readAny(file);
			for (const match of source.matchAll(/<button\b/g)) {
				const head = source.slice(match.index, match.index + 4000);
				const tagEnd = head.search(/(?<!=)>/);
				const tag = tagEnd < 0 ? head : head.slice(0, tagEnd + 1);
				const className = classNameOf(tag);
				if (className === undefined) {
					offenders.push(`${file}: <button> 没有可识别的 className`);
					continue;
				}
				// 表达式里只认静态字符串那几段；`className={classes}` 这种拼出来的没法静态判断
				const tokens = [...className.matchAll(/"([^"]*)"/g)].flatMap((part) =>
					(part[1] ?? "").split(/\s+/).filter((token) => token.length > 0),
				);
				if (tokens.length === 0) {
					continue;
				}
				if (!tokens.some(styled)) {
					offenders.push(`${file}: <button className=${className}>`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("写死数值的零债门禁", () => {
	it("全仓样式表没有写死的字号、圆角、间距、内边距、阴影与过渡", () => {
		for (const file of CSS_FILES) {
			const actual = countDebt(read(file));
			for (const kind of DEBT_KINDS) {
				expect(actual[kind], `${file} 的 ${kind}`).toBe(0);
			}
		}
	});

	it("零债是量出来的，不是表里写出来的", () => {
		// 防呆：这一条先证明计数器还在工作（否则一个恒为 0 的计数器也能让上一条通过），
		// 再证明全仓文件都被扫到了
		const sample = countDebt(
			[".a {", "\tfont-size: 12px;", "\tborder-radius: 6px;", "\tgap: 8px;", "\tpadding: 0 10px;", "}"].join(
				"\n",
			),
		);
		expect(sample).toEqual({ fontSize: 1, radius: 1, gap: 1, padding: 1, shadow: 0, transition: 0 });
		expect(CSS_FILES.length).toBeGreaterThan(10);
	});
});
