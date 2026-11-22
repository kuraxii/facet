/**
 * 设置里的下拉。
 *
 * 覆盖结构与可访问性：真正干活的是原生 `<select>`（选项、可访问名、禁用都在它身上），
 * 叠在上面的那一行只是显示同一句话、负责省略，对读屏隐藏。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "./select.tsx";

const OPTIONS = [
	{ value: "a", label: "甲" },
	{ value: "b", label: "很长很长的一个乙选项" },
];

describe("Select", () => {
	it("原生下拉带可访问名与全部选项，标签叠在上面且对读屏隐藏", () => {
		const html = renderToStaticMarkup(
			createElement(Select, { value: "b", options: OPTIONS, onChange: () => {}, ariaLabel: "选一个" }),
		);
		expect(html).toContain('<span class="set-select">');
		expect(html).toContain('class="ui-input"');
		expect(html).toContain('aria-label="选一个"');
		expect(html).toContain('<option value="a">甲</option>');
		// 当前值那一项由 React 标成 selected
		expect(html).toMatch(/<option value="b" selected="">很长很长的一个乙选项<\/option>/);
		// 同一句话出现两次：一次在选项里，一次在叠上去的标签里
		expect(html.match(/很长很长的一个乙选项/g)).toHaveLength(2);
		expect(html).toContain('class="set-select-label ell" aria-hidden="true"');
	});

	it("禁用落在原生下拉上，并带上额外类名", () => {
		const html = renderToStaticMarkup(
			createElement(Select, {
				value: "a",
				options: OPTIONS,
				onChange: () => {},
				disabled: true,
				className: "set-models-select",
			}),
		);
		expect(html).toContain('<span class="set-select set-models-select">');
		expect(html).toMatch(/<select[^>]*disabled/);
	});
});
