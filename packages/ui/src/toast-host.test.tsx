// @vitest-environment node
/**
 * 轻提示区的渲染：等级靠类名与图标表达，文字只放事实，整块不抢焦点。
 *
 * 跑在 Node 环境：这份断言看的是服务端渲染出来的那一份，没有 `document` 才走静态分支。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "./i18n/I18nProvider.tsx";
import type { Toast } from "./toast.ts";
import { ToastHost } from "./toast-host.tsx";

function toast(overrides: Partial<Toast> = {}): Toast {
	return {
		id: "info:已复制",
		level: "info",
		message: "已复制",
		count: 1,
		createdAt: 0,
		expiresAt: 1,
		...overrides,
	};
}

function markup(toasts: readonly Toast[]): string {
	return renderToStaticMarkup(
		<I18nProvider language="zh-CN">
			<ToastHost toasts={toasts} onDismiss={() => {}} onPauseChange={() => {}} />
		</I18nProvider>,
	);
}

describe("轻提示区", () => {
	it("没有提示时不渲染任何东西", () => {
		expect(markup([])).toBe("");
	});

	it("是一个礼貌的通知区域，文字只放事实", () => {
		const html = markup([toast({ message: "app.tsx 写盘失败 EACCES" })]);
		expect(html).toContain('role="status"');
		expect(html).toContain('aria-live="polite"');
		expect(html).toContain("app.tsx 写盘失败 EACCES");
		// 等级靠样式表达，不写成文字
		expect(html).not.toContain("错误");
		expect(html).toContain("is-info");
	});

	it("重复出现时右侧浮现次数", () => {
		expect(markup([toast({ count: 3 })])).toContain(">3<");
	});

	it("提示本身不带操作按钮", () => {
		const html = markup([toast({ level: "error", message: "开终端失败 EACCES" })]);
		// 只剩一个关闭按钮
		expect(html.match(/<button/g)).toHaveLength(1);
	});

	it("每条都能手动关掉，关的按钮有名字", () => {
		const html = markup([toast({ level: "error" })]);
		expect(html).toContain("is-error");
		expect(html).toContain('aria-label="关闭提示"');
	});

	it("不使用原生 title 属性", () => {
		expect(markup([toast()])).not.toContain("title=");
	});
});
