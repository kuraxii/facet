import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { MainTabs } from "./main-tabs.tsx";

const markup = renderToStaticMarkup(
	<I18nProvider language="zh-CN">
		<MainTabs
			tabs={[
				{ id: "session:a", kind: "session", label: "facet 实现", closable: true },
				{ id: "diff:a", kind: "diff", label: "Diff · app.tsx", closable: true },
				{ id: "terminal:a", kind: "terminal", label: "facet", closable: true },
			]}
			activeId="session:a"
			onSelect={() => {}}
			onClose={() => {}}
			onCloseTabs={() => {}}
			onCopyText={() => {}}
			onReorder={() => {}}
			onCreateTerminal={() => {}}
			canCreateTerminal
		/>
	</I18nProvider>,
);

describe("main tabs", () => {
	it("renders the open views in one tab strip", () => {
		expect(markup).toContain('aria-label="主区域标签"');
		expect(markup).toContain("facet 实现");
		expect(markup).toContain("Diff · app.tsx");
		expect(markup).toContain('aria-selected="true"');
	});

	it("gives session and closable tabs a close button", () => {
		expect(markup).toContain('aria-label="关闭 Diff · app.tsx"');
		expect(markup).toContain('aria-label="关闭 facet 实现"');
	});

	it("keeps the new-tab button", () => {
		expect(markup).toContain('aria-label="新建标签"');
	});

	it("only arms dragging after a left press", () => {
		expect(markup.match(/draggable="false"/g)?.length).toBe(3);
	});
});
