// @vitest-environment jsdom
/**
 * 工作区标签栏。
 *
 * 纯展示组件，交互全部落在按钮上，所以这里要真的挂一棵 DOM：点击切换、方向键切换与
 * 无障碍属性都按用户看得见的行为断言，而不是只看静态标记。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import {
	WorkspaceTabBar,
	type WorkspaceTabBarProps,
	type WorkspaceTabId,
	type WorkspaceTabItem,
} from "./workspace-tab-bar.tsx";

/** 三条标签：文件、变更（带计数）、终端。 */
const ITEMS: readonly WorkspaceTabItem[] = [
	{ id: "files", label: "文件", icon: <span data-icon="files" /> },
	{ id: "changes", label: "变更", icon: <span data-icon="changes" />, badge: 3 },
	{ id: "terminal", label: "终端", icon: <span data-icon="terminal" /> },
];

// jsdom 没有 ResizeObserver：标签栏用它在容器变窄时切到只有图标
beforeAll(() => {
	globalThis.ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let unmount: (() => void) | undefined;

afterEach(() => {
	act(() => unmount?.());
	unmount = undefined;
	document.body.innerHTML = "";
});

/** 挂一棵标签栏，返回容器与选中回调。 */
function mount(props: Partial<WorkspaceTabBarProps> = {}): {
	container: HTMLDivElement;
	onSelect: ReturnType<typeof vi.fn>;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const onSelect = vi.fn();
	const root = createRoot(container);
	act(() => {
		root.render(
			<I18nProvider language="zh-CN">
				<WorkspaceTabBar items={ITEMS} activeId="files" onSelect={onSelect} {...props} />
			</I18nProvider>,
		);
	});
	unmount = () => root.unmount();
	return { container, onSelect };
}

/** 取所有标签按钮。 */
function tabs(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

/** 按标识取一条标签。 */
function tab(container: HTMLElement, label: string): HTMLButtonElement {
	const found = tabs(container).find((node) => node.textContent?.includes(label));
	if (found === undefined) {
		throw new Error(`找不到标签 ${label}`);
	}
	return found;
}

/** 敲一下按键。 */
function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

describe("工作区标签栏", () => {
	it("按顺序渲染三类标签，当前项带 aria-selected", () => {
		const { container } = mount();
		expect(container.querySelector('[role="tablist"]')).not.toBeNull();
		expect(tabs(container).map((node) => node.textContent)).toEqual(["文件", "变更3", "终端"]);
		expect(tab(container, "文件").getAttribute("aria-selected")).toBe("true");
		expect(tab(container, "变更").getAttribute("aria-selected")).toBe("false");
	});

	it("当前项是唯一能 Tab 到的那一条", () => {
		const { container } = mount({ activeId: "changes" });
		expect(tabs(container).map((node) => node.tabIndex)).toEqual([-1, 0, -1]);
	});

	it("点一条就切过去", () => {
		const { container, onSelect } = mount();
		act(() => tab(container, "终端").click());
		expect(onSelect).toHaveBeenCalledWith("terminal");
	});

	it("计数作为徽标显示", () => {
		const { container } = mount();
		expect(tab(container, "变更").querySelector(".workspace-tab-badge")?.textContent).toBe("3");
		expect(tab(container, "文件").querySelector(".workspace-tab-badge")).toBeNull();
	});

	it("不可用的标签点不动，方向键也跳过它", () => {
		const items: WorkspaceTabItem[] = [
			{ id: "files", label: "文件", icon: null },
			{ id: "changes", label: "变更", icon: null, disabled: true },
			{ id: "terminal", label: "终端", icon: null },
		];
		const { container, onSelect } = mount({ items, activeId: "files" });
		act(() => tab(container, "变更").click());
		expect(onSelect).not.toHaveBeenCalled();
		expect(tab(container, "变更").disabled).toBe(true);

		press(tab(container, "文件"), "ArrowRight");
		expect(onSelect).toHaveBeenLastCalledWith("terminal");
	});

	it("横向用左右键，到头绕回另一头", () => {
		const { container, onSelect } = mount({ activeId: "files" });
		press(tab(container, "文件"), "ArrowRight");
		expect(onSelect).toHaveBeenLastCalledWith("changes");
		press(tab(container, "文件"), "ArrowLeft");
		expect(onSelect).toHaveBeenLastCalledWith("terminal");
	});

	it("纵向用上下键，Home / End 跳到两头", () => {
		const { container, onSelect } = mount({ orientation: "vertical", labelMode: "never" });
		press(tab(container, "文件"), "ArrowDown");
		expect(onSelect).toHaveBeenLastCalledWith("changes");
		press(tab(container, "文件"), "ArrowUp");
		expect(onSelect).toHaveBeenLastCalledWith("terminal");
		press(tab(container, "文件"), "End");
		expect(onSelect).toHaveBeenLastCalledWith("terminal");
		press(tab(container, "终端"), "Home");
		expect(onSelect).toHaveBeenLastCalledWith("files");
	});

	it("两种方向各自给出 aria-orientation 与类名", () => {
		const horizontal = mount();
		const list = horizontal.container.querySelector('[role="tablist"]');
		expect(list?.getAttribute("aria-orientation")).toBe("horizontal");
		expect(list?.className).toContain("is-horizontal");
		act(() => unmount?.());
		unmount = undefined;

		const vertical = mount({ orientation: "vertical", labelMode: "never" });
		const verticalList = vertical.container.querySelector('[role="tablist"]');
		expect(verticalList?.getAttribute("aria-orientation")).toBe("vertical");
		expect(verticalList?.className).toContain("is-vertical");
	});

	it("文字折起时用无障碍名称与悬浮提示补上文案", () => {
		const { container } = mount({ labelMode: "never" });
		const node = tab(container, "文件");
		expect(node.getAttribute("aria-label")).toBe("文件");
		expect(container.querySelector('[role="tablist"]')?.getAttribute("data-label-mode")).toBe("never");
	});

	it("始终给文字时不加无障碍名称，避免与可见文字重复", () => {
		const { container } = mount({ labelMode: "always" });
		expect(tab(container, "文件").getAttribute("aria-label")).toBeNull();
	});

	it("读屏名称与方向键顺序跟着条目走，不认硬编码的业务", () => {
		const custom: WorkspaceTabItem[] = [
			{ id: "terminal", label: "终端", icon: null },
			{ id: "files", label: "文件", icon: null },
		];
		const { container, onSelect } = mount({ items: custom, activeId: "terminal" });
		press(tab(container, "终端"), "ArrowRight");
		expect(onSelect).toHaveBeenLastCalledWith("files" satisfies WorkspaceTabId);
	});
});
