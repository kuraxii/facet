/**
 * 窄屏抽屉的渲染：侧栏是否展开由属性决定，展开时带 is-open。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionSidebar, type SessionSidebarProps } from "./SessionSidebar.tsx";

type ThemeName = SessionSidebarProps["theme"];

function render(isOpen: boolean | undefined): string {
	return renderToStaticMarkup(
		createElement(SessionSidebar, {
			sessions: [],
			projects: [],
			activeFile: undefined,
			runningFile: undefined,
			runningDot: "running" as const,
			createCwd: "/work/a",
			theme: "zinc" as ThemeName,
			onSelect: () => {},
			onCreate: () => {},
			canCreate: true,
			onAddProject: () => {},
			isProjectsStale: false,
			onRefreshProjects: () => {},
			onRenameProject: async () => {},
			onRemoveProject: async () => {},
			onRevealProject: async () => {},
			onRenameSession: async () => {},
			onDeleteSession: async () => {},
			onToggleTheme: () => {},
			onOpenSettings: () => {},
			isSettingsOpen: false,
			onTogglePanel: () => {},
			isPanelOpen: false,
			...(isOpen === undefined ? {} : { isOpen }),
		}),
	);
}

describe("侧栏抽屉", () => {
	it("展开时带 is-open，收起时不带", () => {
		expect(render(true)).toContain('class="sb is-open"');
		expect(render(false)).toContain('class="sb"');
	});

	it("不给属性时按展开处理，宽屏不需要抽屉状态", () => {
		expect(render(undefined)).toContain('class="sb is-open"');
	});
});
