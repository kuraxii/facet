// @vitest-environment jsdom
/**
 * 引用之后把光标放回输入框末尾。
 *
 * 两种输入框共用这一份约定：文本域用 `setSelectionRange`，富文本编辑器只能靠 `Range`
 * 把选区折叠到内容末尾，再让编辑器把这个 DOM 选区同步回自己的状态。
 */
import { describe, expect, it } from "vitest";
import { placeCaretAtEnd } from "./selection-quote.ts";

/** 等一帧：落光标安排在下一帧，等界面把新草稿提交完。 */
function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve());
	});
}

/** 把元素挂进文档，用完自己收掉。 */
function mount(element: HTMLElement): void {
	document.body.append(element);
}

describe("引用之后落光标", () => {
	it("富文本输入框：选区折叠在内容末尾", async () => {
		const editor = document.createElement("div");
		editor.setAttribute("contenteditable", "true");
		const paragraph = document.createElement("p");
		paragraph.textContent = "引用进来的一段";
		editor.append(paragraph);
		mount(editor);

		placeCaretAtEnd(editor);
		await nextFrame();

		const selection = window.getSelection();
		expect(selection?.isCollapsed).toBe(true);
		expect(selection?.anchorNode?.textContent).toBe("引用进来的一段");
		expect(selection?.anchorOffset).toBe("引用进来的一段".length);
		editor.remove();
	});

	it("空段落里也能落光标", async () => {
		const editor = document.createElement("div");
		editor.setAttribute("contenteditable", "true");
		editor.append(document.createElement("p"));
		mount(editor);

		placeCaretAtEnd(editor);
		await nextFrame();

		expect(window.getSelection()?.isCollapsed).toBe(true);
		editor.remove();
	});

	it("文本域走选区接口", async () => {
		const textarea = document.createElement("textarea");
		textarea.value = "写了一半";
		mount(textarea);

		placeCaretAtEnd(textarea);
		await nextFrame();

		expect(textarea.selectionStart).toBe("写了一半".length);
		expect(textarea.selectionEnd).toBe("写了一半".length);
		textarea.remove();
	});

	it("没有输入框时什么都不做", async () => {
		expect(() => {
			placeCaretAtEnd(null);
		}).not.toThrow();
	});
});
