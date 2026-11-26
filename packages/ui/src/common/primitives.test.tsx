/**
 * 控件原语的结构与属性透传。
 *
 * 这几条要盯住的是"不会把交互弄坏"的部分：`type` 缺省不提交表单、变体与档位落在 `data-*`
 * 上、禁用与选中态真的到 DOM 上、其余原生属性（事件、`aria-*`、`data-*`）原样透传。
 * 外观由 `styles/primitives.css` 决定，这里不查几何。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge.tsx";
import { Button, type ButtonProps } from "./Button.tsx";
import { IconButton } from "./IconButton.tsx";
import { Input } from "./Input.tsx";
import { ListRow } from "./ListRow.tsx";

describe("Button", () => {
	it("缺省是次级按钮、md 档，并且 type=button 不提交表单", () => {
		const html = renderToStaticMarkup(createElement(Button, null, "保存"));
		expect(html).toContain('class="ui-btn"');
		expect(html).toContain('data-variant="secondary"');
		expect(html).toContain('data-size="md"');
		expect(html).toContain('type="button"');
		expect(html).toContain("保存");
	});

	it("变体、档位与 armed 落在属性上，业务类名接在后面", () => {
		const html = renderToStaticMarkup(
			createElement(
				Button,
				{ variant: "danger", size: "sm", armed: true, className: "prov-foot-danger" },
				"删除",
			),
		);
		expect(html).toContain('class="ui-btn prov-foot-danger"');
		expect(html).toContain('data-variant="danger"');
		expect(html).toContain('data-size="sm"');
		expect(html).toContain('data-armed="true"');
	});

	it("原生属性透传：aria、disabled 与自定义 data-*", () => {
		// `data-*` 不在组件的 props 类型里，但运行期靠 `...rest` 原样落到 DOM 上，
		// 这里就是要确认这条通道没被拦掉
		const props = {
			disabled: true,
			"aria-label": "确认删除",
			"data-testid": "ok",
			onClick: () => {},
		} as unknown as ButtonProps;
		const html = renderToStaticMarkup(createElement(Button, props));
		expect(html).toContain("disabled");
		expect(html).toContain('aria-label="确认删除"');
		expect(html).toContain('data-testid="ok"');
	});

	it("表单提交按钮可以显式要回 type=submit", () => {
		const html = renderToStaticMarkup(createElement(Button, { type: "submit" }, "提交"));
		expect(html).toContain('type="submit"');
	});
});

describe("IconButton", () => {
	it("缺省 ghost / sm / type=button，带可访问名", () => {
		const html = renderToStaticMarkup(createElement(IconButton, { "aria-label": "关闭" }, "×"));
		expect(html).toContain('class="ui-icon-btn"');
		expect(html).toContain('data-variant="ghost"');
		expect(html).toContain('data-size="sm"');
		expect(html).toContain('type="button"');
		expect(html).toContain('aria-label="关闭"');
	});

	it("选中态与圆角档位走属性，不堆类名", () => {
		const html = renderToStaticMarkup(
			createElement(IconButton, {
				"aria-label": "发送",
				variant: "primary",
				size: "md",
				radius: "lg",
				active: true,
			}),
		);
		expect(html).toContain('data-variant="primary"');
		expect(html).toContain('data-size="md"');
		expect(html).toContain('data-radius="lg"');
		expect(html).toContain('data-active="true"');

		const pillHtml = renderToStaticMarkup(
			createElement(IconButton, {
				"aria-label": "发送",
				variant: "primary",
				size: "md",
				radius: "pill",
			}),
		);
		expect(pillHtml).toContain('data-radius="pill"');
	});
});

describe("Input", () => {
	it("缺省 default / md，接住原生输入属性", () => {
		const html = renderToStaticMarkup(
			createElement(Input, { value: "abc", onChange: () => {}, placeholder: "标识", "aria-label": "标识" }),
		);
		expect(html).toContain('class="ui-input"');
		expect(html).toContain('data-variant="default"');
		expect(html).toContain('data-size="md"');
		expect(html).toContain('placeholder="标识"');
		expect(html).toContain('value="abc"');
	});

	it("invalid 同时给边框状态与 aria-invalid", () => {
		const html = renderToStaticMarkup(createElement(Input, { invalid: true, "aria-label": "密钥" }));
		expect(html).toContain('data-invalid="true"');
		expect(html).toContain('aria-invalid="true"');
	});

	it("ghost 变体用于已经带框的容器", () => {
		const html = renderToStaticMarkup(
			createElement(Input, { variant: "ghost", size: "lg", "aria-label": "搜索" }),
		);
		expect(html).toContain('data-variant="ghost"');
		expect(html).toContain('data-size="lg"');
	});
});

describe("ListRow", () => {
	it("缺省是 div 行，带档位与交互标记", () => {
		const html = renderToStaticMarkup(createElement(ListRow, null, "一行"));
		expect(html).toContain('class="ui-row"');
		expect(html).toContain('data-size="sm"');
		expect(html).toContain('data-variant="list"');
		expect(html).toContain('data-interactive="true"');
	});

	it("as=button 的行是 type=button，不会被当成提交按钮", () => {
		const html = renderToStaticMarkup(createElement(ListRow, { as: "button", onClick: () => {} }, "会话"));
		expect(html).toContain("<button");
		expect(html).toContain('type="button"');
	});

	it("选中与激活落在属性上，菜单项用另一档圆角", () => {
		const html = renderToStaticMarkup(
			createElement(ListRow, { variant: "menu", selected: true, active: true }),
		);
		expect(html).toContain('data-variant="menu"');
		expect(html).toContain('data-selected="true"');
		expect(html).toContain('data-active="true"');
	});

	it("as=li 给菜单列表用，interactive=false 时不挂悬停", () => {
		const html = renderToStaticMarkup(createElement(ListRow, { as: "li", interactive: false }));
		expect(html).toContain("<li");
		expect(html).toContain('data-interactive="false"');
	});
});

describe("Badge", () => {
	it("缺省中性胶囊", () => {
		const html = renderToStaticMarkup(createElement(Badge, null, "3"));
		expect(html).toContain('class="ui-badge"');
		expect(html).toContain('data-variant="neutral"');
		expect(html).toContain('data-shape="pill"');
	});

	it("语义变体与标签形走属性", () => {
		const html = renderToStaticMarkup(createElement(Badge, { variant: "accent", shape: "tag" }, "自定义"));
		expect(html).toContain('data-variant="accent"');
		expect(html).toContain('data-shape="tag"');
	});
});
