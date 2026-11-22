/**
 * 思考档位单元格的测试。
 *
 * 只查两件事：格子里写的是不是最高一档，以及勾选之后交回去的那组档位对不对。菜单是原生
 * Popover，jsdom 不展开它，但内容一直在 DOM 里，勾选框照样点得到。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { ProviderThinkingLevels } from "./ProviderThinkingLevels.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

/** 挂一个格子，返回它的容器与最近一次的提交值。 */
function mount(levels: readonly ("off" | "low" | "high" | "max")[]): {
	changes: string[][];
	rerender: (next: readonly ("off" | "low" | "high" | "max")[]) => void;
} {
	const changes: string[][] = [];
	const render = (current: readonly ("off" | "low" | "high" | "max")[]): void => {
		act(() => {
			root.render(
				<I18nProvider language="zh-CN">
					<ProviderThinkingLevels
						levels={current}
						onChange={(next) => {
							changes.push(next);
						}}
						label="思考档位"
						anchor="prov-levels-row-1"
					/>
				</I18nProvider>,
			);
		});
	};
	render(levels);
	return { changes, rerender: render };
}

describe("思考档位单元格", () => {
	it("格子里写最高一档,一档都没有时是一道横线", () => {
		mount(["off", "low", "high"]);
		expect(container.querySelector(".prov-levels-value")?.textContent).toBe("high");

		mount([]);
		expect(container.querySelector(".prov-levels-value")?.textContent).toBe("—");
	});

	it("菜单里有七档,勾中的那几档是选中状态", () => {
		mount(["off", "high"]);
		const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
		expect(boxes).toHaveLength(7);
		expect(boxes.filter((box) => box.checked)).toHaveLength(2);
		expect(container.querySelectorAll(".prov-levels-name")[0]?.textContent).toBe("off");
		expect(container.querySelectorAll(".prov-levels-name")[6]?.textContent).toBe("max");
	});

	it("勾一档交回整组,顺序按七档排", () => {
		const { changes } = mount(["off", "high"]);
		const low = container.querySelector<HTMLLabelElement>('[data-level="low"] input');
		act(() => low?.click());
		expect(changes).toEqual([["off", "low", "high"]]);
	});

	it("取消一档交回去掉之后的那组", () => {
		const { changes } = mount(["off", "high"]);
		const off = container.querySelector<HTMLLabelElement>('[data-level="off"] input');
		act(() => off?.click());
		expect(changes).toEqual([["high"]]);
	});

	it("菜单挂在浏览器顶层的 Popover 上,并用锚点定位", () => {
		mount(["off"]);
		const menu = container.querySelector(".prov-levels-menu");
		expect(menu?.getAttribute("popover")).toBe("auto");
		expect(menu?.id).toBe("prov-levels-row-1");
		const trigger = container.querySelector(".prov-levels-trigger");
		expect(trigger?.getAttribute("popovertarget")).toBe("prov-levels-row-1");
		expect(trigger?.getAttribute("style")).toContain("anchor-name: --prov-levels-row-1");
		expect(menu?.getAttribute("style")).toContain("position-anchor: --prov-levels-row-1");
	});
});
