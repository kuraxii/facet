// @vitest-environment jsdom
/**
 * 顶带左右侧栏开关渲染：原地复用同一节点，仅随开合状态切换对应方向的图标状态与角标。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { PanelToggle, SidebarToggle } from "./top-bar.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function mountButton(element: ReactElement, selector: string): HTMLButtonElement {
	if (container === undefined) {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	}
	act(() => {
		root?.render(createElement(I18nProvider, null, element));
	});
	const button = container.querySelector<HTMLButtonElement>(selector);
	if (button === null) {
		throw new Error(`未找到开关按钮: ${selector}`);
	}
	return button;
}

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	container?.remove();
	container = undefined;
});

describe("SidebarToggle", () => {
	it("切换开合状态时保留同一按钮与图标节点，仅变更左向内部竖线状态", () => {
		const onToggle = vi.fn();
		const openButton = mountButton(
			createElement(SidebarToggle, { isOpen: true, onToggle }),
			"button.chrome-toggle.is-sidebar",
		);
		const openSvg = openButton.querySelector("svg.panel-toggle-icon");
		const openBar = openButton.querySelector("line.panel-toggle-bar");
		expect(openButton.getAttribute("aria-expanded")).toBe("true");
		expect(openSvg?.getAttribute("data-side")).toBe("left");
		expect(openSvg?.getAttribute("data-open")).toBe("true");
		expect(openBar?.getAttribute("x1")).toBe("9");

		const collapsedButton = mountButton(
			createElement(SidebarToggle, { isOpen: false, onToggle }),
			"button.chrome-toggle.is-sidebar",
		);
		expect(collapsedButton).toBe(openButton);
		expect(collapsedButton.querySelector("svg.panel-toggle-icon")).toBe(openSvg);
		expect(collapsedButton.querySelector("line.panel-toggle-bar")).toBe(openBar);
		expect(collapsedButton.getAttribute("aria-expanded")).toBe("false");
		expect(openSvg?.getAttribute("data-open")).toBe("false");

		act(() => collapsedButton.click());
		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});

describe("PanelToggle", () => {
	it("切换开合状态时保留同一按钮与图标节点，仅变更右向内部竖线状态与角标显隐", () => {
		const onToggle = vi.fn();
		const openButton = mountButton(
			createElement(PanelToggle, { isOpen: true, onToggle, badge: 3 }),
			"button.chrome-toggle.is-panel",
		);
		const openSvg = openButton.querySelector("svg.panel-toggle-icon");
		const openBar = openButton.querySelector("line.panel-toggle-bar");
		expect(openButton.getAttribute("aria-expanded")).toBe("true");
		expect(openSvg?.getAttribute("data-side")).toBe("right");
		expect(openSvg?.getAttribute("data-open")).toBe("true");
		expect(openBar?.getAttribute("x1")).toBe("15");
		expect(openButton.querySelector(".chrome-toggle-badge")).toBeNull();

		const collapsedButton = mountButton(
			createElement(PanelToggle, { isOpen: false, onToggle, badge: 3 }),
			"button.chrome-toggle.is-panel",
		);
		expect(collapsedButton).toBe(openButton);
		expect(collapsedButton.querySelector("svg.panel-toggle-icon")).toBe(openSvg);
		expect(collapsedButton.querySelector("line.panel-toggle-bar")).toBe(openBar);
		expect(collapsedButton.getAttribute("aria-expanded")).toBe("false");
		expect(openSvg?.getAttribute("data-open")).toBe("false");
		expect(collapsedButton.querySelector(".chrome-toggle-badge")?.textContent).toBe("3");

		act(() => collapsedButton.click());
		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});
