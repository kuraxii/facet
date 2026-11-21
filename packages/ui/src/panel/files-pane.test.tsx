/**
 * 文件页的测试。
 *
 * 目录内容要等 effect 里取，所以真的挂一棵 DOM。这里管两件事：还没取到目录时的加载态，
 * 以及文件行往输入区拖出去时带的是什么——拖的是「项目根下的相对路径」这一条信息，走自己的
 * MIME，目录行不拖（引用只认文件）。展开、打开与键盘导航不在这里测。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FACET_FILE_DRAG_MIME } from "../common/file-drag.ts";
import { FilesPane } from "./files-pane.tsx";

beforeAll(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let unmount: (() => void) | undefined;

afterEach(() => {
	act(() => unmount?.());
	unmount = undefined;
	document.body.innerHTML = "";
});

/** 文件页：根目录下只有一条目录与一条文件，展开请求也回同一份。 */
function pane(): ReactElement {
	return createElement(FilesPane, {
		loadDirectory: async () => [
			{ name: "src", path: "src", kind: "directory" as const },
			{ name: "a.ts", path: "src/a.ts", kind: "file" as const },
		],
		onOpenFile: () => {},
	});
}

/** 挂一个文件页，返回容器。 */
async function mountPane(): Promise<HTMLElement> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(pane());
	});
	unmount = () => root.unmount();
	return container;
}

/** 树里按名字找一行。 */
function rowOf(container: HTMLElement, name: string): HTMLButtonElement {
	const row = [...container.querySelectorAll<HTMLButtonElement>(".tree-row")].find((item) =>
		item.textContent?.includes(name),
	);
	if (row === undefined) {
		throw new Error(`${name} 这一行没有渲染出来`);
	}
	return row;
}

/** 造一次带 `dataTransfer` 的拖拽事件：jsdom 没有 `DragEvent`，这一格得自己补。 */
function dragStart(): { event: Event; written: Map<string, string>; allowed: () => string } {
	const written = new Map<string, string>();
	let effectAllowed = "uninitialized";
	const event = new Event("dragstart", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", {
		value: {
			setData: (format: string, value: string) => {
				written.set(format, value);
			},
			getData: (format: string) => written.get(format) ?? "",
			get effectAllowed() {
				return effectAllowed;
			},
			set effectAllowed(next: string) {
				effectAllowed = next;
			},
		},
	});
	return { event, written, allowed: () => effectAllowed };
}

describe("文件页", () => {
	it("还没取到目录时显示加载提示", () => {
		const html = renderToStaticMarkup(
			createElement(FilesPane, { loadDirectory: async () => [], onOpenFile: () => {} }),
		);
		expect(html).toContain("正在读取目录");
	});

	it("文件行拖出去带的是相对路径,并且只是复制", async () => {
		const container = await mountPane();
		const file = rowOf(container, "a.ts");
		expect(file.draggable).toBe(true);

		const { event, written, allowed } = dragStart();
		await act(async () => {
			file.dispatchEvent(event);
		});
		expect(written.get(FACET_FILE_DRAG_MIME)).toBe("src/a.ts");
		expect(allowed()).toBe("copy");
	});

	it("目录行不拖", async () => {
		const container = await mountPane();
		expect(rowOf(container, "src").draggable).toBe(false);
	});
});
