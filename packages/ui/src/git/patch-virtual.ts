/**
 * 补丁虚拟化的纯计算。
 *
 * 两件事必须不依赖 DOM 才好测：按视觉列宽挑出最长的那几行（用它们量出整个补丁的横向
 * 像素宽），以及在拖选跨行时算出要额外钉住的区间。组件只负责把这些结果用到渲染上。
 */
import type { PatchLine } from "../transcript/diff-lines.ts";

/**
 * 一行正文的视觉列宽。
 *
 * 等宽字体下 ASCII 占一格，CJK 与全角标点占两格，Tab 按 `tab-size` 对齐到下一个制表位。
 * 只用来排"谁最宽"的顺序，不追求像素级精确——真正的像素宽由 Canvas 对最宽的那几行实测。
 */
export function visualWidth(text: string, tabSize: number): number {
	let columns = 0;
	for (const char of text) {
		if (char === "\t") {
			columns += tabSize - (columns % tabSize);
			continue;
		}
		const code = char.codePointAt(0) ?? 0;
		columns += isWide(code) ? 2 : 1;
	}
	return columns;
}

/**
 * 这个码位在等宽字体里是不是占两格。
 *
 * 覆盖 CJK 统一表意、假名、谚文、全角标点与常见 emoji 区间；判错的代价只是量宽度时少算
 * 一点，横向滚动条略短一点点，不会截断文字（画布宽度永远至少是 100%）。
 */
function isWide(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0x303e) ||
		(code >= 0x3041 && code <= 0x33ff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xa000 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe6f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1f300 && code <= 0x1f64f) ||
		(code >= 0x1f900 && code <= 0x1f9ff) ||
		(code >= 0x20000 && code <= 0x3fffd)
	);
}

/**
 * 挑出可能最宽的几行正文，交给 Canvas 实测。
 *
 * 只量前几名而不是全部：五千行里逐行 `measureText` 是几万次调用，量一次够用几帧；而最宽
 * 的那一行几乎总是视觉列宽排头的一行，按列宽挑候选再实测就不会漏。
 */
export function widestLineTexts(
	lines: readonly PatchLine[],
	limit: number,
	tabSize: number,
): readonly string[] {
	if (limit <= 0) {
		return [];
	}
	const best: { text: string; width: number }[] = [];
	for (const { text } of lines) {
		const width = visualWidth(text, tabSize);
		if (best.length === limit && width <= (best[best.length - 1]?.width ?? 0)) {
			continue;
		}
		let at = best.length;
		while (at > 0 && (best[at - 1]?.width ?? 0) < width) {
			at -= 1;
		}
		best.splice(at, 0, { text, width });
		if (best.length > limit) {
			best.pop();
		}
	}
	return best.map(({ text }) => text);
}

/** 拖选要钉住的区间，两端都含；`null` 表示没有跨行选区。 */
export interface PinnedSpan {
	/** 起点行下标 */
	start: number;
	/** 终点行下标，可能比起始小（从下往上拖） */
	end: number;
}

/**
 * 把拖选跨过的行并进虚拟化器这一帧要渲染的下标里。
 *
 * 行是按需挂载的：滚出去就卸载，原生选区一旦跨过被卸载的行，浏览器的选区就断在边界上，
 * 右键「复制」拿到的只有半截文字。这里把选区覆盖的区间整段保住——区间太长（几万行的全选）
 * 时只保两端，否则钉住等于放弃虚拟化。
 */
export function withPinnedSpan(
	indices: readonly number[],
	span: PinnedSpan | null,
	cap: number,
): readonly number[] {
	if (span === null) {
		return indices;
	}
	const from = Math.min(span.start, span.end);
	const to = Math.max(span.start, span.end);
	const keep = to - from + 1 > cap ? [from, to] : range(from, to);
	const extra = keep.filter((index) => !indices.includes(index));
	if (extra.length === 0) {
		return indices;
	}
	return [...indices, ...extra].sort((left, right) => left - right);
}

/** 闭区间 `[from, to]` 的下标表。 */
function range(from: number, to: number): number[] {
	const list: number[] = [];
	for (let index = from; index <= to; index += 1) {
		list.push(index);
	}
	return list;
}
