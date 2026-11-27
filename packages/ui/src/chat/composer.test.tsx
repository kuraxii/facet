import type { ModelInfo, SlashCommand } from "@facet/protocol";
import {
	$getRoot,
	$getSelection,
	$isRangeSelection,
	FORMAT_TEXT_COMMAND,
	type LexicalEditor,
	PASTE_COMMAND,
	UNDO_COMMAND,
} from "lexical";
import { act, createElement, type ReactElement, type RefObject, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACET_FILE_DRAG_MIME } from "../common/file-drag.ts";
import { Composer, type ComposerProps } from "./Composer.tsx";
import { QueueStrip } from "./QueueStrip.tsx";
import {
	ComposerEditor,
	type ComposerHandle,
	type ComposerKeyRoutes,
} from "./rich-editor/ComposerEditor.tsx";

// React 19 的 act 只在测试环境里开关作批处理，这个开关是 React 的约定
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 一个渲染好、还没卸载的组件。 */
interface Rendered {
	/** 挂载容器，查询 DOM 都从它出发 */
	container: HTMLElement;
	/** 重渲染，用来验证受控同步 */
	rerender: (element: ReactElement) => void;
	/** 卸载并清掉容器 */
	unmount: () => void;
}

/**
 * 在 jsdom 里挂一个组件：客户端渲染，Lexical 要真实 DOM 才谈得上选区与键盘。
 *
 * 挂载要等一次微任务：编辑器的首次导入是异步提交的，同步 `act` 之后紧接着改内容，
 * 会被还在路上的那次导入盖回去。
 */
async function render(element: ReactElement): Promise<Rendered> {
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	await act(async () => {
		root.render(element);
	});
	return {
		container,
		rerender: (next) => {
			act(() => {
				root.render(next);
			});
		},
		unmount: () => {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

/** 一份最省的输入区参数，用例只覆盖自己关心的那几项。 */
function composerProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
	return {
		value: "",
		onChange: () => {},
		onSend: () => {},
		onStop: () => {},
		activity: "idle",
		model: undefined,
		thinkingLevel: undefined,
		...overrides,
	};
}

/** 渲染输入区，返回容器与输入域本身。 */
async function renderComposer(
	overrides: Partial<ComposerProps> = {},
): Promise<Rendered & { editor: HTMLElement }> {
	const rendered = await render(createElement(Composer, composerProps(overrides)));
	const editor = rendered.container.querySelector<HTMLElement>(".composer-editor");
	if (editor === null) {
		throw new Error("输入域没有渲染出来");
	}
	return { ...rendered, editor };
}

/** 在输入域上按一个键，并等这次更新落定；返回那次事件，用例可以据此判断默认行为有没有被拦下。 */
async function pressKey(
	element: HTMLElement,
	key: string,
	init: { shiftKey?: boolean; keyCode?: number } = {},
): Promise<KeyboardEvent> {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		shiftKey: init.shiftKey ?? false,
	});
	if (init.keyCode !== undefined) {
		// 组词期间有的浏览器只给 keyCode：jsdom 的构造参数不收它，只能补在实例上
		Object.defineProperty(event, "keyCode", { value: init.keyCode });
	}
	await act(async () => {
		element.dispatchEvent(event);
	});
	return event;
}

/**
 * 把光标放进输入域末尾，模拟用户已经点进来。
 *
 * 编辑器没有选区时收到的回车什么都不改：插入段落、插入换行都要先有一个落点。
 */
async function focusEditor(editor: HTMLElement): Promise<void> {
	await act(async () => {
		editor.focus();
		const range = document.createRange();
		range.selectNodeContents(editor);
		range.collapse(false);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
	});
}

/** 发送按钮与停止按钮共用输入区右下角这一个位置（`.composer-send`），两者互相替换。 */
function sendButton(container: HTMLElement): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(".composer-send > button");
	if (button === null) {
		throw new Error("发送按钮没有渲染出来");
	}
	return button;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("输入区", () => {
	it("运行中可以发送,提示改为插入当前轮次", async () => {
		const { container, unmount } = await renderComposer({ activity: "running", value: "补充一句" });
		expect(container.innerHTML).toContain("回车插入当前轮次");
		expect(sendButton(container).getAttribute("aria-label")).toBe("排队");
		expect(sendButton(container).disabled).toBe(false);
		unmount();
	});

	it("压缩与停止中不接受新输入", async () => {
		for (const activity of ["compacting", "stopping"] as const) {
			const { container, unmount } = await renderComposer({ activity, value: "补充一句" });
			expect(sendButton(container).disabled).toBe(true);
			unmount();
		}
	});

	it("发送与停止占同一个按钮", async () => {
		// 没有内容要发时按钮是停止
		const running = await renderComposer({ activity: "running", value: "" });
		expect(running.container.querySelector(".composer-send .is-stop")).not.toBeNull();
		expect(sendButton(running.container).getAttribute("aria-label")).not.toBe("排队");
		running.unmount();

		// 有内容时同一个位置换回发送，运行中的含义是排队
		const queued = await renderComposer({ activity: "running", value: "补充一句" });
		expect(queued.container.querySelector(".composer-send .is-stop")).toBeNull();
		queued.unmount();

		// 空闲时不出现停止
		const idle = await renderComposer({ activity: "idle", value: "" });
		expect(idle.container.querySelector(".composer-send .is-stop")).toBeNull();
		idle.unmount();
	});

	it("空闲时按发送处理", async () => {
		const { container, unmount } = await renderComposer({ activity: "idle", value: "你好" });
		expect(container.innerHTML).toContain("回车发送");
		expect(sendButton(container).getAttribute("aria-label")).toBe("发送");
		unmount();
	});

	it("有一条还在路上时按钮不再可点，点也不多发一条", async () => {
		const onSend = vi.fn();
		const { container, unmount } = await renderComposer({ value: "你好", onSend, isSending: true });
		// 仍显示发送（不是停止）：在途不是「这一轮在跑」，一下没收住就会把轮次停掉
		expect(container.querySelector(".composer-send .is-stop")).toBeNull();
		expect(sendButton(container).getAttribute("aria-label")).toBe("发送");
		expect(sendButton(container).disabled).toBe(true);
		sendButton(container).click();
		expect(onSend).not.toHaveBeenCalled();
		unmount();
	});

	it("运行中还在等回执时按钮留在发送上，不换成停止", async () => {
		const { container, unmount } = await renderComposer({
			activity: "running",
			value: "补充一句",
			isSending: true,
		});
		expect(container.querySelector(".composer-send .is-stop")).toBeNull();
		expect(sendButton(container).disabled).toBe(true);
		unmount();
	});

	it("占位提示挂在输入域外面那一圈上,有缩略图时跟着下移", async () => {
		const attachment = { id: "a1", name: "shot.png", previewUrl: "data:image/png;base64,AA==" };
		const { container, unmount } = await renderComposer({ attachments: [attachment] });

		// 占位提示的定位基准必须是输入域那一圈，不是整个输入区：缩略图把输入域推下去时它也跟下去，
		// 否则会压在缩略图上
		const placeholder = container.querySelector(".composer-placeholder");
		expect(placeholder?.closest(".composer-input")).not.toBeNull();
		expect(placeholder?.closest(".composer")).not.toBeNull();
		unmount();
	});

	it("换行发送时占位符写明 Shift+回车", async () => {
		const { container, unmount } = await renderComposer({ value: "", shiftEnterToSend: true });
		expect(container.innerHTML).toContain("Shift+回车发送");
		unmount();
	});
});

describe("键盘", () => {
	it("回车发送", async () => {
		const onSend = vi.fn();
		const { editor, unmount } = await renderComposer({ value: "你好", onSend });
		const event = await pressKey(editor, "Enter");
		expect(onSend).toHaveBeenCalledTimes(1);
		// 发送键位拦下默认行为，不会同时插入换行
		expect(event.defaultPrevented).toBe(true);
		unmount();
	});

	it("回车发送时 Shift+回车换行", async () => {
		const onSend = vi.fn();
		const onChange = vi.fn();
		const { editor, unmount } = await renderComposer({ value: "你好", onSend, onChange });
		await focusEditor(editor);
		await pressKey(editor, "Enter", { shiftKey: true });
		expect(onSend).not.toHaveBeenCalled();
		// 换行交给编辑器自己：草稿里多出一个换行
		expect(onChange).toHaveBeenLastCalledWith("你好\n");
		unmount();
	});

	it("Shift+回车发送时回车换行", async () => {
		const onSend = vi.fn();
		const onChange = vi.fn();
		const { editor, unmount } = await renderComposer({
			value: "你好",
			onSend,
			onChange,
			shiftEnterToSend: true,
		});
		await focusEditor(editor);
		await pressKey(editor, "Enter");
		expect(onSend).not.toHaveBeenCalled();
		expect(onChange).toHaveBeenLastCalledWith("你好\n");

		await pressKey(editor, "Enter", { shiftKey: true });
		expect(onSend).toHaveBeenCalledTimes(1);
		unmount();
	});

	it("没有内容时按发送键也不多出空行", async () => {
		const onSend = vi.fn();
		const onChange = vi.fn();
		const { editor, unmount } = await renderComposer({ value: "", onSend, onChange });
		await focusEditor(editor);
		const event = await pressKey(editor, "Enter");
		expect(onSend).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
		unmount();
	});

	it("组词期间的回车不发送", async () => {
		const onSend = vi.fn();
		const { editor, unmount } = await renderComposer({ value: "ni", onSend });
		await focusEditor(editor);
		// 有的浏览器组词时只给 keyCode 229
		await pressKey(editor, "Enter", { keyCode: 229 });
		expect(onSend).not.toHaveBeenCalled();
		unmount();
	});

	it("长按回车的重复事件不发送也不补空行", async () => {
		const onSend = vi.fn();
		const onChange = vi.fn();
		const { editor, unmount } = await renderComposer({ value: "你好", onSend, onChange });
		await focusEditor(editor);

		// 第一下正常发送
		await pressKey(editor, "Enter");
		expect(onSend).toHaveBeenCalledTimes(1);

		// 按住不放：浏览器接着发的都是 repeat 事件，既不发送也不插入换行
		for (let index = 0; index < 3; index += 1) {
			const repeated = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
				repeat: true,
			});
			await act(async () => {
				editor.dispatchEvent(repeated);
			});
			expect(repeated.defaultPrevented).toBe(true);
		}
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onChange).not.toHaveBeenCalled();
		unmount();
	});

	it("有一条还在路上时回车不发出去", async () => {
		const onSend = vi.fn();
		const onChange = vi.fn();
		const { editor, unmount } = await renderComposer({ value: "你好", onSend, onChange, isSending: true });
		await focusEditor(editor);
		const event = await pressKey(editor, "Enter");
		expect(onSend).not.toHaveBeenCalled();
		// 发送键位本来就拦下默认行为：不该顺手多出一个换行
		expect(event.defaultPrevented).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
		unmount();
	});

	it("受阻时回车不发出去", async () => {
		const onSend = vi.fn();
		const { editor, unmount } = await renderComposer({ value: "补充一句", onSend, isBlocked: true });
		await focusEditor(editor);
		await pressKey(editor, "Enter");
		expect(onSend).not.toHaveBeenCalled();
		unmount();
	});
});

describe("命令面板", () => {
	const commands: SlashCommand[] = [
		{ name: "compact", description: "压缩上下文", source: "builtin", handler: "facet" },
		{ name: "review", description: "审查改动", source: "skill", handler: "pi" },
	] as SlashCommand[];

	/** 把光标放到编辑器里最后一个文本节点的末尾。 */
	async function caretAtLastText(rendered: EditorRendered): Promise<void> {
		await act(async () => {
			rendered.editorElement.focus();
			const texts = rendered.container.querySelectorAll(".composer-editor [data-lexical-text]");
			const last = texts[texts.length - 1]?.lastChild ?? null;
			if (last === null) {
				throw new Error("编辑器里没有文字");
			}
			const range = document.createRange();
			range.setStart(last, (last.textContent ?? "").length);
			range.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
		});
	}

	it("开头打斜杠时列出候选,挂在输入区外框上", async () => {
		const { container, editor, unmount } = await renderComposer({ value: "/co", commands });
		await focusEditor(editor);
		const palette = container.querySelector('[role="listbox"]');
		expect(palette).not.toBeNull();
		expect(palette?.textContent).toContain("/compact");
		// 只有前缀命中的那条
		expect(palette?.textContent).not.toContain("/review");
		// 与 `@` 菜单同一处：挂在 `.composer` 下、不在编辑器里，不会被编辑区滚动裁切
		expect(palette?.parentElement).toBe(container.querySelector(".composer"));
		expect(editor.contains(palette)).toBe(false);
		unmount();
	});

	it("空输入区里打斜杠就列候选,接着打的字收窄范围", async () => {
		const rendered = await renderEditor("", false, { commands });
		await focusEditor(rendered.editorElement);

		await typeText(rendered.editor, "/");
		const palette = rendered.container.querySelector('[role="listbox"]');
		expect(palette).not.toBeNull();
		expect(palette?.textContent).toContain("/compact");
		expect(palette?.textContent).toContain("/review");

		await typeText(rendered.editor, "co");
		const narrowed = rendered.container.querySelector('[role="listbox"]');
		expect(narrowed).not.toBeNull();
		expect(narrowed?.textContent).toContain("/compact");
		expect(narrowed?.textContent).not.toContain("/review");
		rendered.unmount();
	});

	it("方向键换高亮,回车选中交给 pi 的命令", async () => {
		const onChange = vi.fn();
		const onRunCommand = vi.fn();
		const { container, editor, unmount } = await renderComposer({
			value: "/",
			commands,
			onChange,
			onRunCommand,
		});
		await focusEditor(editor);

		// 默认高亮第一条；下移一次落到第二条
		await pressKey(editor, "ArrowDown");
		const rows = [...container.querySelectorAll(".cmd-row")];
		expect(rows[0]?.className).not.toContain("is-on");
		expect(rows[1]?.className).toContain("is-on");

		// 交给 pi 的命令：换成胶囊再补一个空格，草稿对外的写法不变
		await pressKey(editor, "Enter");
		expect(onChange).toHaveBeenLastCalledWith("/review ");
		expect(onRunCommand).not.toHaveBeenCalled();
		expect(container.querySelector(".composer-command")?.textContent).toBe("/review");
		unmount();
	});

	it("界面自己处理的命令选中后就地执行", async () => {
		const onChange = vi.fn();
		const onRunCommand = vi.fn();
		const { container, editor, unmount } = await renderComposer({
			value: "/comp",
			commands,
			onChange,
			onRunCommand,
		});
		await focusEditor(editor);
		await pressKey(editor, "Enter");
		expect(onRunCommand).toHaveBeenCalledWith(expect.objectContaining({ name: "compact" }), "");
		// 触发文本清掉，草稿跟着空，不留一枚胶囊
		expect(onChange).toHaveBeenLastCalledWith("");
		expect(container.querySelector(".composer-command")).toBeNull();
		expect(editor.textContent).toBe("");
		unmount();
	});

	it("方向键选到底部时命令面板也跟随滚动", async () => {
		// 十二条命令，按 26px 一行排进 200px 高的盒子里：最后几条落在视口外
		const many: SlashCommand[] = Array.from({ length: 12 }, (_, index) => ({
			name: `cmd${String(index)}`,
			description: `第 ${String(index + 1)} 条`,
			source: "builtin",
			handler: "pi",
		})) as SlashCommand[];
		const { container, editor, unmount } = await renderComposer({ value: "/", commands: many });
		await focusEditor(editor);
		const list = container.querySelector<HTMLElement>(".cmd-pop");
		expect(list).not.toBeNull();
		if (list === null) {
			throw new Error("命令面板没有渲染出来");
		}

		let scrollTop = 0;
		Object.defineProperty(list, "clientHeight", { value: 200, configurable: true });
		Object.defineProperty(list, "clientTop", { value: 0, configurable: true });
		Object.defineProperty(list, "scrollTop", {
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
			},
			configurable: true,
		});
		list.getBoundingClientRect = () => rectAt(0, 200);
		[...list.children].forEach((row, index) => {
			(row as HTMLElement).getBoundingClientRect = () => rectAt(index * 26 - scrollTop, 26);
		});

		for (let step = 0; step < 11; step += 1) {
			await pressKey(editor, "ArrowDown");
		}
		expect([...list.children].at(-1)?.className).toContain("is-on");
		// 第 12 行下沿 11×26+26=312，比 200 的可视高度多出 112，容器正好滚到底
		expect(scrollTop).toBe(112);
		unmount();
	});

	it("Esc 收起面板并挡掉默认行为", async () => {
		const onSend = vi.fn();
		const { container, editor, unmount } = await renderComposer({ value: "/", commands, onSend });
		await focusEditor(editor);
		expect(container.querySelector('[role="listbox"]')).not.toBeNull();

		const event = await pressKey(editor, "Escape");
		// 面板吃掉这次按键：窄档下的外层抽屉看到 defaultPrevented 就不会跟着关
		expect(event.defaultPrevented).toBe(true);
		expect(container.querySelector('[role="listbox"]')).toBeNull();
		// 内容没变，面板不再弹回来
		expect(container.querySelector('[role="listbox"]')).toBeNull();
		unmount();
	});

	it("组词期间的上下键不换高亮", async () => {
		const { container, editor, unmount } = await renderComposer({ value: "/", commands });
		await focusEditor(editor);
		const before = container.querySelector(".cmd-row.is-on")?.textContent;
		await pressKey(editor, "ArrowDown", { keyCode: 229 });
		expect(container.querySelector(".cmd-row.is-on")?.textContent).toBe(before);
		unmount();
	});

	it("Tab 选中高亮项,Shift+Tab 不选", async () => {
		const rendered = await renderEditor("/rev", false, { commands });
		await focusEditor(rendered.editorElement);

		// Shift+Tab 管的是焦点链，菜单不吃这个键，也就不选中任何东西
		const shifted = await pressKey(rendered.editorElement, "Tab", { shiftKey: true });
		expect(shifted.defaultPrevented).toBe(false);
		expect(rendered.container.querySelector(".composer-command")).toBeNull();

		await pressKey(rendered.editorElement, "Tab");
		expect(rendered.draft()).toBe("/review ");
		rendered.unmount();
	});

	it("选中的胶囊是一个原子 token,后面补一个空格接着写参数", async () => {
		const rendered = await renderEditor("/rev", false, { commands });
		await focusEditor(rendered.editorElement);
		await pressKey(rendered.editorElement, "Enter");

		const capsule = rendered.container.querySelector(".composer-command");
		expect(capsule?.textContent).toBe("/review");
		expect(capsule?.getAttribute("data-command")).toBe("review");
		// 胶囊后面跟着一个空格，光标停在那儿等参数
		expect(capsule?.nextElementSibling?.textContent).toBe(" ");
		expect(rendered.draft()).toBe("/review ");

		// 原子性来自 token 模式：退格整块删除、光标整块跳过。jsdom 没有布局，编辑器的
		// 按字符删除在这里是空操作，所以只断言语义，不模拟那一下按键。
		const mode = rendered.editor.getEditorState().read(() => {
			const node = $getRoot()
				.getAllTextNodes()
				.find((item) => item.getType() === "slash-command");
			return node?.getMode() ?? null;
		});
		expect(mode).toBe("token");

		// 接着写的参数落在胶囊之后，胶囊本身不受影响
		await typeText(rendered.editor, "看下 diff");
		expect(rendered.draft()).toBe("/review 看下 diff");
		expect(rendered.container.querySelector(".composer-command")?.textContent).toBe("/review");
		rendered.unmount();
	});

	it("第二段与代码块里的斜杠不弹面板", async () => {
		const second = await renderEditor("第一行\n\n/co", false, { commands });
		await caretAtLastText(second);
		expect(second.container.querySelector('[role="listbox"]')).toBeNull();
		second.unmount();

		const code = await renderEditor("```\n/co\n```", false, { commands });
		await caretAtLastText(code);
		expect(code.container.querySelector('[role="listbox"]')).toBeNull();
		code.unmount();
	});

	it("已有命令胶囊之后不再弹面板", async () => {
		const rendered = await renderEditor("/review 看下 diff", false, { commands });
		// 外部铺进来的草稿本身就带胶囊：照旧导出同样的写法
		expect(rendered.container.querySelector(".composer-command")?.textContent).toBe("/review");
		expect(rendered.draft()).toBe("/review 看下 diff");

		await caretAtLastText(rendered);
		expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
		rendered.unmount();
	});

	it("一条候选都匹配不上时不弹空框", async () => {
		const { container, editor, unmount } = await renderComposer({ value: "/zz", commands });
		await focusEditor(editor);
		expect(container.querySelector('[role="listbox"]')).toBeNull();
		unmount();
	});
});

describe("受控同步", () => {
	it("外部改值之后输入域跟着换内容", async () => {
		const rendered = await renderComposer({ value: "旧草稿" });
		expect(rendered.editor.textContent).toContain("旧草稿");
		rendered.rerender(createElement(Composer, composerProps({ value: "引用进来的一段" })));
		expect(rendered.editor.textContent).toContain("引用进来的一段");
		expect(rendered.editor.textContent).not.toContain("旧草稿");
		rendered.unmount();
	});

	it("清空草稿之后输入域是空的", async () => {
		const rendered = await renderComposer({ value: "先写了一段" });
		rendered.rerender(createElement(Composer, composerProps({ value: "" })));
		expect(rendered.editor.textContent).toBe("");
		rendered.unmount();
	});
});

describe("排队条", () => {
	it("没有排队内容时不渲染", async () => {
		const { container, unmount } = await render(
			createElement(QueueStrip, { queued: { steering: [], followUp: [] }, onClear: () => {} }),
		);
		expect(container.innerHTML).toBe("");
		unmount();
	});

	it("列出排队内容与条数,带收回入口", async () => {
		const { container, unmount } = await render(
			createElement(QueueStrip, {
				queued: { steering: ["先看日志", "再看配置"], followUp: [] },
				onClear: () => {},
			}),
		);
		expect(container.textContent).toContain("排队 2 条");
		expect(container.textContent).toContain("先看日志");
		expect(container.textContent).toContain("再看配置");
		expect(container.textContent).toContain("收回");
		unmount();
	});
});

describe("模型与思考档位芯片", () => {
	const model: ModelInfo = {
		provider: "p",
		id: "m1",
		name: "模型一",
		api: "openai-responses",
		reasoning: true,
		contextWindow: 1000,
		maxTokens: 100,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	it("给出可选模型时芯片可以打开菜单", async () => {
		const { container, unmount } = await renderComposer({
			model,
			thinkingLevel: "medium",
			models: [],
			onModelChange: () => {},
		});
		const chip = container.querySelector<HTMLButtonElement>("button.chip");
		expect(chip?.textContent).toContain("模型一");
		expect(chip?.disabled).toBe(false);
		unmount();
	});

	it("思考档位芯片用大脑图标加档位取值，不翻译", async () => {
		const { container, unmount } = await renderComposer({
			thinkingLevel: "max",
			onThinkingLevelChange: () => {},
		});
		const chip = container.querySelector<HTMLButtonElement>('button[aria-label="思考档位 Max"]');
		expect(chip).not.toBeNull();
		expect(chip?.querySelector(".lucide-brain")).not.toBeNull();
		expect(chip?.textContent).toContain("Max");
		expect(chip?.textContent).not.toContain("思考 ·");
		unmount();
	});

	it("不给回调时模型芯片只展示", async () => {
		const { container, unmount } = await renderComposer();
		const chip = container.querySelector<HTMLButtonElement>("button.chip");
		expect(chip?.disabled).toBe(true);
		expect(chip?.textContent).toContain("无模型");
		unmount();
	});

	it("上下文用量有效时在按钮旁展示百分比", async () => {
		const { container, rerender, unmount } = await renderComposer({
			contextUsage: { tokens: 83_400, contextWindow: 200_000, percent: 41.7 },
		});
		const ctxChip = container.querySelector<HTMLButtonElement>(
			'button.composer-status-chip[data-chip="context"]',
		);
		expect(ctxChip?.textContent).toBe("42%");
		rerender(createElement(Composer, composerProps({ contextUsage: undefined })));
		expect(
			container.querySelector<HTMLButtonElement>('button.composer-status-chip[data-chip="context"]')
				?.textContent,
		).toBe("");
		unmount();
	});
});

describe("发送受阻", () => {
	it("等待扩展询问时停止可用，只读与断线时禁用停止", async () => {
		for (const canStop of [true, false]) {
			const { container, unmount } = await renderComposer({
				value: "已有草稿",
				activity: "running",
				isBlocked: true,
				canStop,
			});
			const stop = container.querySelector<HTMLButtonElement>(".composer-send .is-stop");
			expect(stop).not.toBeNull();
			expect(stop?.disabled).toBe(!canStop);
			unmount();
		}
	});

	it("受阻时只禁用发送，不显示说明", async () => {
		const { container, unmount } = await renderComposer({ value: "有待发送的内容", isBlocked: true });
		expect(container.querySelector(".composer-blocked")).toBeNull();
		expect(sendButton(container).disabled).toBe(true);
		unmount();
	});
});

/** 富文本输入域的按键落点：块级用例只关心换行键位与能不能发。 */
function editorRoutes(shiftEnterToSend: boolean): ComposerKeyRoutes {
	return { canSend: true, shiftEnterToSend, onSend: () => {} };
}

/**
 * 受控外壳：草稿跟着 `onChange` 回传，DOM 与 `Composer` 一样是「`.composer` 外框 + 编辑器」，
 * `@` 菜单的挂载容器就是那个外框。
 */
function EditorHost(props: {
	initial: string;
	shiftEnterToSend: boolean;
	editorRef: RefObject<LexicalEditor | null>;
	handleRef: RefObject<ComposerHandle | null>;
	mentionFiles?: readonly string[];
	commands?: readonly SlashCommand[];
	sentHistory?: readonly string[];
	onOpenMentionFile?: ((filePath: string) => void) | undefined;
	onDraft: (draft: string) => void;
}): ReactElement {
	const [draft, setDraft] = useState(props.initial);
	const boxRef = useRef<HTMLDivElement>(null);
	return (
		<div className="composer" ref={boxRef}>
			<ComposerEditor
				value={draft}
				onChange={(next) => {
					setDraft(next);
					props.onDraft(next);
				}}
				placeholder="输入消息"
				routes={editorRoutes(props.shiftEnterToSend)}
				commands={props.commands}
				mentionFiles={props.mentionFiles}
				sentHistory={props.sentHistory}
				onOpenMentionFile={props.onOpenMentionFile}
				menuContainerRef={boxRef}
				handleRef={props.handleRef}
				editorRef={props.editorRef}
			/>
		</div>
	);
}

/** 一份渲染好的富文本输入域。 */
interface EditorRendered extends Rendered {
	/** 输入域根节点 */
	editorElement: HTMLElement;
	/** 编辑器实例，用例靠它模拟输入 */
	editor: LexicalEditor;
	/** 对外的命令式句柄 */
	handle: ComposerHandle;
	/** 最近一次回传给父级的草稿 */
	draft: () => string;
}

/** 挂一个受控的富文本输入域。 */
async function renderEditor(
	initial: string,
	shiftEnterToSend: boolean,
	options: {
		mentionFiles?: readonly string[];
		commands?: readonly SlashCommand[];
		sentHistory?: readonly string[];
		onOpenMentionFile?: ((filePath: string) => void) | undefined;
	} = {},
): Promise<EditorRendered> {
	const editorRef: RefObject<LexicalEditor | null> = { current: null };
	const handleRef: RefObject<ComposerHandle | null> = { current: null };
	let latest = initial;
	const rendered = await render(
		createElement(EditorHost, {
			initial,
			shiftEnterToSend,
			editorRef,
			handleRef,
			mentionFiles: options.mentionFiles,
			commands: options.commands,
			sentHistory: options.sentHistory,
			onOpenMentionFile: options.onOpenMentionFile,
			onDraft: (next: string) => {
				latest = next;
			},
		}),
	);
	const editorElement = rendered.container.querySelector<HTMLElement>(".composer-editor");
	const editor = editorRef.current;
	const handle = handleRef.current;
	if (editorElement === null || editor === null || handle === null) {
		throw new Error("编辑器没有渲染出来");
	}
	return { ...rendered, editorElement, editor, handle, draft: () => latest };
}

/**
 * 在光标处打一段字。
 *
 * jsdom 没有原生编辑，字符写不进 contenteditable，只能走编辑器自己的插入：对模型来说
 * 与用户敲进来是同一个结果。
 */
async function typeText(editor: LexicalEditor, text: string): Promise<void> {
	await act(async () => {
		editor.update(
			() => {
				const selection = $getSelection();
				if ($isRangeSelection(selection)) {
					selection.insertText(text);
				}
			},
			{ discrete: true },
		);
	});
}

/** 造一份「顶边在 top、高 height」的矩形，补布局给 jsdom 用。 */
function rectAt(top: number, height: number): DOMRect {
	const left = 0;
	const width = 240;
	return {
		x: left,
		y: top,
		top,
		left,
		width,
		height,
		bottom: top + height,
		right: left + width,
		toJSON: () => ({}),
	} as DOMRect;
}

/** 输入域顶层块的名字，用来确认引用有没有干净地结束。 */
function topBlocks(container: HTMLElement): string[] {
	return [...container.querySelectorAll(".composer-editor > *")].map((node) => node.tagName.toLowerCase());
}

describe("块级结构换行", () => {
	for (const shiftEnterToSend of [false, true]) {
		const mode = shiftEnterToSend ? "Shift+回车发送" : "回车发送";
		/** 这一档设置下「换行」是哪一个组合：回车发送时靠 Shift，反之回车就是换行 */
		const newlineKey = shiftEnterToSend ? {} : { shiftKey: true };

		it(`${mode}：引用里换一次行继续写引用，再换行退回普通段落`, async () => {
			const rendered = await renderEditor("> quote", shiftEnterToSend);
			await focusEditor(rendered.editorElement);

			// 第一下：引用内换行，竖线接着往下画
			await pressKey(rendered.editorElement, "Enter", newlineKey);
			expect(rendered.draft()).toBe("> quote\n> ");

			// 第二下：站在末尾空行上，退出引用另起一段
			await pressKey(rendered.editorElement, "Enter", newlineKey);
			await typeText(rendered.editor, "normal");

			expect(rendered.draft()).toBe("> quote\nnormal");
			expect(topBlocks(rendered.container)).toEqual(["blockquote", "p"]);
			rendered.unmount();
		});
	}

	it("引用中间换行只是续行，不退出引用", async () => {
		const rendered = await renderEditor("> first\n> second", false);
		await focusEditor(rendered.editorElement);
		// 光标挪到引用第一行开头：不是末尾那道空行，换行应当就地插一行
		await act(async () => {
			const text = rendered.editorElement.querySelector("blockquote [data-lexical-text]")?.firstChild;
			if (text === undefined || text === null) {
				throw new Error("引用里的文字没有渲染出来");
			}
			const range = document.createRange();
			range.setStart(text, 0);
			range.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
		});

		await pressKey(rendered.editorElement, "Enter", { shiftKey: true });
		expect(topBlocks(rendered.container)).toEqual(["blockquote"]);
		expect(rendered.draft()).toBe("> \n> first\n> second");
		rendered.unmount();
	});

	it("空引用上连按两次换行会整块收掉", async () => {
		const rendered = await renderEditor("> ", false);
		await focusEditor(rendered.editorElement);

		// 第一下在引用里起一行，第二下退出：一个字都没有的引用不该留下一条空竖线
		await pressKey(rendered.editorElement, "Enter", { shiftKey: true });
		expect(topBlocks(rendered.container)).toEqual(["blockquote"]);
		await pressKey(rendered.editorElement, "Enter", { shiftKey: true });
		expect(topBlocks(rendered.container)).toEqual(["p"]);
		expect(rendered.draft()).toBe("");
		rendered.unmount();
	});

	it("空的引用块在开头退格会变回普通段落", async () => {
		const rendered = await renderEditor("> ", false);
		await focusEditor(rendered.editorElement);

		await pressKey(rendered.editorElement, "Backspace");
		expect(rendered.container.querySelector("blockquote")).toBeNull();
		expect(topBlocks(rendered.container)).toEqual(["p"]);
		rendered.unmount();
	});
});

describe("@文件补全", () => {
	const FILES = ["src/a.ts", "src/chat/Composer.tsx", "docs/readme.md"] as const;

	/** 光标前的文本里打一段字，走编辑器自己的插入。 */
	async function typeInEditor(rendered: EditorRendered, text: string): Promise<void> {
		await typeText(rendered.editor, text);
	}

	it("打 @ 列出候选,过滤之后方向键选中并插入胶囊", async () => {
		const rendered = await renderEditor("", false, { mentionFiles: FILES });
		await focusEditor(rendered.editorElement);
		await typeInEditor(rendered, "@Com");

		const listbox = rendered.container.querySelector(".composer-mention-pop");
		expect(listbox).not.toBeNull();
		expect(listbox?.getAttribute("role")).toBe("listbox");
		// 与 `/` 命令面板同一套外观与定位
		expect(listbox?.classList.contains("cmd-pop")).toBe(true);
		// 挂在输入区外框下、不在编辑器里，所以不会被编辑区滚动裁切
		expect(listbox?.parentElement).toBe(rendered.container.querySelector(".composer"));
		expect(rendered.editorElement.contains(listbox)).toBe(false);
		// 只有前缀命中的那一条
		expect(listbox?.textContent).toContain("Composer.tsx");
		expect(listbox?.textContent).not.toContain("readme.md");

		await pressKey(rendered.editorElement, "Enter");
		await act(async () => {});

		const mention = rendered.container.querySelector(".composer-mention");
		expect(mention).not.toBeNull();
		// 屏幕上只有文件名，完整路径在 title 上
		expect(mention?.textContent).toBe("@Composer.tsx");
		expect(mention?.getAttribute("title")).toBe("src/chat/Composer.tsx");
		// 胶囊后面补了一个空格，草稿对外是完整路径
		expect(rendered.draft()).toBe("@src/chat/Composer.tsx ");

		// 接着打字落在胶囊之后，胶囊本身不受影响
		await typeInEditor(rendered, "看一下");
		expect(rendered.draft()).toBe("@src/chat/Composer.tsx 看一下");
		expect(rendered.container.querySelector(".composer-mention")?.textContent).toBe("@Composer.tsx");
		rendered.unmount();
	});

	it("选中的胶囊是一个原子 token", async () => {
		const rendered = await renderEditor("", false, { mentionFiles: FILES });
		await focusEditor(rendered.editorElement);
		await typeInEditor(rendered, "@a");
		await pressKey(rendered.editorElement, "Enter");
		await act(async () => {});

		// 原子性来自 token 模式：退格整块删除、光标整块跳过。jsdom 没有布局，编辑器的
		// 按字符删除在这里是空操作，所以只断言语义，不模拟那一下按键。
		const mode = rendered.editor.getEditorState().read(() => {
			const mention = $getRoot()
				.getAllTextNodes()
				.find((node) => node.getType() === "file-mention");
			return mention?.getMode() ?? null;
		});
		expect(mode).toBe("token");
		// 对外仍然是完整路径
		expect(rendered.draft()).toBe("@src/a.ts ");
		rendered.unmount();
	});

	it("方向键选到底部时把那一行滚进可视范围", async () => {
		const files = Array.from({ length: 10 }, (_, index) => `src/f${String(index)}.ts`);
		const rendered = await renderEditor("", false, { mentionFiles: files });
		await focusEditor(rendered.editorElement);
		await typeInEditor(rendered, "@");
		const menu = rendered.container.querySelector<HTMLElement>(".composer-mention-pop");
		expect(menu).not.toBeNull();
		if (menu === null) {
			throw new Error("候选菜单没有渲染出来");
		}

		/*
		 * jsdom 不做布局：给菜单与每行补上矩形、可视高度和一个可写的 scrollTop，
		 * 模拟「十行装在 240px 高的盒子里」这一版式。
		 */
		let scrollTop = 0;
		Object.defineProperty(menu, "clientHeight", { value: 240, configurable: true });
		Object.defineProperty(menu, "clientTop", { value: 0, configurable: true });
		Object.defineProperty(menu, "scrollTop", {
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
			},
			configurable: true,
		});
		menu.getBoundingClientRect = () => rectAt(0, 240);
		const rows = [...menu.children];
		rows.forEach((row, index) => {
			(row as HTMLElement).getBoundingClientRect = () => rectAt(index * 26, 26);
		});

		// 一路下移到最后一条：它的下沿在 260，比 240 的可视高度多出 20
		for (let step = 0; step < 9; step += 1) {
			await pressKey(rendered.editorElement, "ArrowDown");
		}
		expect(rows.at(-1)?.className).toContain("is-on");
		expect(scrollTop).toBe(20);
		rendered.unmount();
	});

	it("普通 @名字 与邮箱不弹菜单", async () => {
		const rendered = await renderEditor("", false, { mentionFiles: FILES });
		await focusEditor(rendered.editorElement);
		await typeInEditor(rendered, "mail a@b.com");
		expect(rendered.container.querySelector(".composer-mention-pop")).toBeNull();
		expect(rendered.draft()).toBe("mail a@b.com");
		rendered.unmount();
	});

	it("Esc 收起菜单并挡掉默认行为", async () => {
		const rendered = await renderEditor("", false, { mentionFiles: FILES });
		await focusEditor(rendered.editorElement);
		await typeInEditor(rendered, "@");
		expect(rendered.container.querySelector(".composer-mention-pop")).not.toBeNull();

		const event = await pressKey(rendered.editorElement, "Escape");
		// 菜单吃掉这次按键：外层抽屉看到 defaultPrevented 就不会跟着关
		expect(event.defaultPrevented).toBe(true);
		expect(rendered.container.querySelector(".composer-mention-pop")).toBeNull();
		rendered.unmount();
	});

	it("空清单时不弹空框", async () => {
		const rendered = await renderEditor("", false, { mentionFiles: [] });
		await focusEditor(rendered.editorElement);
		await typeInEditor(rendered, "@");
		expect(rendered.container.querySelector(".composer-mention-pop")).toBeNull();
		rendered.unmount();
	});

	it("代码块里打 @ 不弹菜单", async () => {
		const rendered = await renderEditor("```\nconst a = 1;\n```", false, { mentionFiles: FILES });
		await focusEditor(rendered.editorElement);
		// 光标放到代码块最后一行
		await act(async () => {
			rendered.editorElement.focus();
			const text = rendered.container.querySelector(".composer-code-block [data-lexical-text]")?.lastChild;
			if (text === null || text === undefined) {
				throw new Error("代码块没有渲染出来");
			}
			const range = document.createRange();
			range.setStart(text, (text.textContent ?? "").length);
			range.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
		});
		await typeInEditor(rendered, "@");
		expect(rendered.container.querySelector(".composer-mention-pop")).toBeNull();
		rendered.unmount();
	});
});

describe("代码块", () => {
	/** 把光标放到代码块第一行开头。 */
	async function caretAtCodeStart(rendered: EditorRendered): Promise<void> {
		await act(async () => {
			rendered.editorElement.focus();
			const text = rendered.container.querySelector(".composer-code-block [data-lexical-text]")?.firstChild;
			if (text === null || text === undefined) {
				throw new Error("代码块没有渲染出来");
			}
			const range = document.createRange();
			range.setStart(text, 0);
			range.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
		});
	}

	it("代码块里 Tab 缩进两格,Shift+Tab 撤回", async () => {
		const rendered = await renderEditor("```\nconst a = 1;\n```", false);
		await caretAtCodeStart(rendered);

		await pressKey(rendered.editorElement, "Tab");
		expect(rendered.draft()).toBe("```\n  const a = 1;\n```");

		await pressKey(rendered.editorElement, "Tab", { shiftKey: true });
		expect(rendered.draft()).toBe("```\nconst a = 1;\n```");
		rendered.unmount();
	});

	it("普通段落里 Tab 保持焦点链,不插空格", async () => {
		const rendered = await renderEditor("你好", false);
		await focusEditor(rendered.editorElement);
		const event = await pressKey(rendered.editorElement, "Tab");
		expect(event.defaultPrevented).toBe(false);
		expect(rendered.draft()).toBe("你好");
		rendered.unmount();
	});
});

describe("命令式句柄", () => {
	it("appendQuote 插入引用块,光标落在其后的空段落", async () => {
		const rendered = await renderEditor("", false);
		await act(async () => {
			rendered.handle.appendQuote("line 1\nline 2");
		});

		expect(topBlocks(rendered.container)).toEqual(["blockquote", "p"]);
		expect(rendered.container.querySelector("blockquote")?.textContent).toBe("line 1line 2");
		expect(rendered.draft()).toBe("> line 1\n> line 2\n");
		rendered.unmount();
	});

	it("已有内容时引用块接在后面", async () => {
		const rendered = await renderEditor("先写的一段", false);
		await act(async () => {
			rendered.handle.appendQuote("被引用的文字");
		});

		expect(topBlocks(rendered.container)).toEqual(["p", "blockquote", "p"]);
		expect(rendered.draft()).toBe("先写的一段\n> 被引用的文字\n");
		rendered.unmount();
	});

	it("placeCaretAtEnd 把光标放到内容末尾", async () => {
		const rendered = await renderEditor("一段草稿", false);
		await act(async () => {
			rendered.handle.placeCaretAtEnd();
		});
		// 随后打的字应当接在末尾
		await typeText(rendered.editor, "!");
		expect(rendered.draft()).toBe("一段草稿!");
		rendered.unmount();
	});
});

/**
 * 受控外壳：`onChange` 回传的草稿立刻成为下一次渲染的 `value`。
 *
 * 真的输入区就是这么接的；用例若只挂一个 `vi.fn()` 而不回填 `value`，任何一次重渲染都会
 * 让编辑器以为外面改了值、整份重铺一遍。
 */
function ControlledComposer(props: ComposerProps): ReactElement {
	const [draft, setDraft] = useState(props.value);
	return createElement(Composer, {
		...props,
		value: draft,
		onChange: (next: string) => {
			setDraft(next);
			props.onChange(next);
		},
	});
}

/** 渲染一个真受控的输入区，返回容器与输入域本身。 */
async function renderControlled(
	overrides: Partial<ComposerProps> = {},
): Promise<Rendered & { editor: HTMLElement }> {
	const rendered = await render(createElement(ControlledComposer, composerProps(overrides)));
	const editor = rendered.container.querySelector<HTMLElement>(".composer-editor");
	if (editor === null) {
		throw new Error("输入域没有渲染出来");
	}
	return { ...rendered, editor };
}

/** 造一次带 `dataTransfer` 的拖拽事件：jsdom 没有 `DragEvent`，这一格得自己补。 */
function dragEvent(
	type: "dragstart" | "dragover" | "drop",
	types: readonly string[],
	getData: (format: string) => string,
	files: readonly File[] = [],
): Event {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", {
		value: {
			types,
			getData,
			files,
			effectAllowed: "unmodified",
			dropEffect: "none",
			setData: () => {},
		},
	});
	return event;
}

/**
 * 模拟 `useComposer` 的草稿表：草稿按会话键分开存，切会话就是换一个键。
 *
 * 撤销栈是否真的按会话分开，只有走这条「换键 + 换草稿」的路才看得出来。
 */
function SessionHost(props: {
	activeKey: string;
	editorRef: RefObject<LexicalEditor | null>;
	onDrafts: (key: string, draft: string) => void;
}): ReactElement {
	const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
	const boxRef = useRef<HTMLDivElement>(null);
	const key = props.activeKey;
	return (
		<div className="composer" ref={boxRef}>
			<ComposerEditor
				value={drafts[key] ?? ""}
				onChange={(next) => {
					setDrafts((current) => ({ ...current, [key]: next }));
					props.onDrafts(key, next);
				}}
				placeholder="输入消息"
				routes={editorRoutes(false)}
				draftKey={key}
				menuContainerRef={boxRef}
				editorRef={props.editorRef}
			/>
		</div>
	);
}

describe("按会话隔离的撤销栈", () => {
	it("切走再切回来,各自只撤自己那一份", async () => {
		const editorRef: RefObject<LexicalEditor | null> = { current: null };
		const seen: string[] = [];
		const host = (activeKey: string): ReactElement =>
			createElement(SessionHost, {
				activeKey,
				editorRef,
				onDrafts: (key, draft) => seen.push(`${key}:${draft}`),
			});
		const rendered = await render(host("a"));
		const editorElement = rendered.container.querySelector<HTMLElement>(".composer-editor");
		const editor = editorRef.current;
		if (editorElement === null || editor === null) {
			throw new Error("编辑器没有渲染出来");
		}
		const undo = async (): Promise<void> => {
			await act(async () => {
				editor.dispatchCommand(UNDO_COMMAND, undefined);
			});
		};

		// 会话 a 写一段
		await focusEditor(editorElement);
		await typeText(editor, "会话甲的内容");
		expect(seen.at(-1)).toBe("a:会话甲的内容");

		// 切到会话 b，写另一段
		rendered.rerender(host("b"));
		await act(async () => {});
		expect(editorElement.textContent).toBe("");
		await focusEditor(editorElement);
		await typeText(editor, "会话乙的内容");
		expect(seen.at(-1)).toBe("b:会话乙的内容");

		// 在 b 里撤销：只撤掉 b 的那一段，草稿不会被 b 恢复时铺进来的内容顶掉，
		// 更不会冒出 a 的内容
		await undo();
		expect(editorElement.textContent).toBe("");
		expect(editorElement.textContent).not.toContain("会话甲");

		// 再写一点留痕，然后切回 a：a 的草稿还在，撤销栈也还在原处
		await typeText(editor, "会话乙的内容");
		rendered.rerender(host("a"));
		await act(async () => {});
		expect(editorElement.textContent).toBe("会话甲的内容");
		await undo();
		expect(editorElement.textContent).toBe("");
		rendered.unmount();
	});
});

describe("@文件胶囊的双向联动", () => {
	const FILES = ["src/a.ts", "src/chat/Composer.tsx"] as const;

	it("点胶囊把完整路径交给宿主", async () => {
		const onOpenMentionFile = vi.fn();
		const rendered = await renderEditor("看 @src/a.ts 这个", false, {
			mentionFiles: FILES,
			onOpenMentionFile,
		});
		await focusEditor(rendered.editorElement);

		const capsule = rendered.container.querySelector<HTMLElement>(".composer-mention");
		expect(capsule).not.toBeNull();
		// 可点时编辑器上多一个类，指针与悬停样式都由它给
		expect(rendered.container.querySelector(".composer-editor")?.className).toContain("is-mention-clickable");

		await act(async () => {
			capsule?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onOpenMentionFile).toHaveBeenCalledWith("src/a.ts");
		rendered.unmount();
	});

	it("没接打开动作时胶囊不带可点的样子", async () => {
		const rendered = await renderEditor("看 @src/a.ts 这个", false, { mentionFiles: FILES });
		expect(rendered.container.querySelector(".composer-editor")?.className).not.toContain(
			"is-mention-clickable",
		);
		rendered.unmount();
	});

	it("从文件树拖进来的路径落成胶囊,不受能不能收图限制", async () => {
		const onChange = vi.fn();
		const onAddImages = vi.fn();
		const { container, editor, unmount } = await renderControlled({
			value: "",
			onChange,
			onAddImages,
			canAddImages: false,
		});
		await focusEditor(editor);
		const box = container.querySelector<HTMLElement>(".composer");
		if (box === null) {
			throw new Error("输入区外框没有渲染出来");
		}

		await act(async () => {
			box.dispatchEvent(dragEvent("dragover", [FACET_FILE_DRAG_MIME], () => ""));
		});
		// 拖到输入区上方就点亮可投放的样子
		expect(box.className).toContain("is-drop");

		await act(async () => {
			box.dispatchEvent(dragEvent("drop", [FACET_FILE_DRAG_MIME], () => "src/chat/Composer.tsx"));
		});
		const capsule = container.querySelector(".composer-mention");
		expect(capsule?.getAttribute("data-file-path")).toBe("src/chat/Composer.tsx");
		// 落下来是一段草稿：胶囊加一个空格
		expect(onChange).toHaveBeenLastCalledWith("@src/chat/Composer.tsx ");
		expect(box.className).not.toContain("is-drop");
		// 文件引用不走进图片那条路
		expect(onAddImages).not.toHaveBeenCalled();
		unmount();
	});

	it("系统拖来的图片还是走图片那条路", async () => {
		const onAddImages = vi.fn();
		const { container, editor, unmount } = await renderComposer({ value: "", onAddImages });
		await focusEditor(editor);
		const box = container.querySelector<HTMLElement>(".composer");
		if (box === null) {
			throw new Error("输入区外框没有渲染出来");
		}
		const file = new File(["x"], "shot.png", { type: "image/png" });

		await act(async () => {
			box.dispatchEvent(dragEvent("dragover", ["Files"], () => "", [file]));
		});
		expect(box.className).toContain("is-drop");
		await act(async () => {
			box.dispatchEvent(dragEvent("drop", ["Files"], () => "", [file]));
		});
		expect(onAddImages).toHaveBeenCalledWith([file]);
		expect(container.querySelector(".composer-mention")).toBeNull();
		unmount();
	});
});

describe("已发消息的历史回溯", () => {
	const HISTORY = ["第一条", "第二条"];

	it("空输入框里 ArrowUp 依次回填,ArrowDown 走回来", async () => {
		const rendered = await renderEditor("", false, { sentHistory: HISTORY });
		await focusEditor(rendered.editorElement);

		await pressKey(rendered.editorElement, "ArrowUp");
		expect(rendered.draft()).toBe("第二条");
		await pressKey(rendered.editorElement, "ArrowUp");
		expect(rendered.draft()).toBe("第一条");
		// 到最旧的一条就停住，不会绕回最新
		await pressKey(rendered.editorElement, "ArrowUp");
		expect(rendered.draft()).toBe("第一条");

		await pressKey(rendered.editorElement, "ArrowDown");
		expect(rendered.draft()).toBe("第二条");
		// 越过最新的一条：回到进浏览态之前的空草稿
		await pressKey(rendered.editorElement, "ArrowDown");
		expect(rendered.draft()).toBe("");
		rendered.unmount();
	});

	it("浏览态里动手改字之后,ArrowDown 不再拿历史盖掉他", async () => {
		const rendered = await renderEditor("", false, { sentHistory: HISTORY });
		await focusEditor(rendered.editorElement);
		await pressKey(rendered.editorElement, "ArrowUp");
		expect(rendered.draft()).toBe("第二条");

		await typeText(rendered.editor, "补一句");
		await pressKey(rendered.editorElement, "ArrowDown");
		expect(rendered.draft()).toBe("第二条补一句");
		rendered.unmount();
	});

	it("有草稿时 ArrowUp 还是光标上移", async () => {
		const rendered = await renderEditor("自己写的内容", false, { sentHistory: HISTORY });
		await focusEditor(rendered.editorElement);
		const event = await pressKey(rendered.editorElement, "ArrowUp");
		expect(event.defaultPrevented).toBe(false);
		expect(rendered.draft()).toBe("自己写的内容");
		rendered.unmount();
	});

	it("打进去的星号、反引号与下划线原样回传，不补反斜杠", async () => {
		const rendered = await renderEditor("", false);
		await focusEditor(rendered.editorElement);
		// 末尾不带会触发快捷输入的写法，这里考的是草稿导出，不是 Markdown 快捷输入
		await typeText(rendered.editor, "通配 *.ts 与 snake_case 与 prefers-* 与 `a b`");
		expect(rendered.draft()).toBe("通配 *.ts 与 snake_case 与 prefers-* 与 `a b`");
		expect(rendered.draft()).not.toContain("\\");
		rendered.unmount();
	});

	it("候选浮层开着时方向键归浮层,不翻历史", async () => {
		const commands: SlashCommand[] = [
			{ name: "compact", description: "压缩上下文", source: "builtin", handler: "facet" },
			{ name: "review", description: "审查改动", source: "skill", handler: "pi" },
		] as SlashCommand[];
		const rendered = await renderEditor("", false, { commands, sentHistory: HISTORY });
		await focusEditor(rendered.editorElement);
		await typeText(rendered.editor, "/");
		const before = rendered.container.querySelector(".cmd-row.is-on")?.textContent;

		await pressKey(rendered.editorElement, "ArrowUp");
		// 高亮动了，历史没被翻出来
		expect(rendered.draft()).toBe("/");
		expect(rendered.container.querySelector(".cmd-row.is-on")?.textContent).not.toBe(before);
		rendered.unmount();
	});
});

describe("路线 B：提示词源码优先", () => {
	/** 一段典型的手写提示词：只有代码块是真结构件，其余都该原样留在屏幕上 */
	const PROMPT = [
		"## 标题",
		"1. **加粗**",
		"`layout-contract.ts`",
		"- 列表项",
		"```ts",
		"const a = 1;",
		"```",
	].join("\n");

	it("`⌘/Ctrl+B` 这类格式命令被吃掉，草稿里不出现星号", async () => {
		const rendered = await renderEditor("普通文字", false);
		await focusEditor(rendered.editorElement);

		const handled = await act(async () => rendered.editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"));
		// 命令被接管：默认的加粗不会发生
		expect(handled).toBe(true);
		expect(rendered.draft()).toBe("普通文字");
		const formats = rendered.editor.getEditorState().read(() =>
			$getRoot()
				.getAllTextNodes()
				.map((node) => node.getFormat()),
		);
		expect(formats.every((format) => format === 0)).toBe(true);
		rendered.unmount();
	});

	it("粘贴带 Markdown 记号的提示词：原样展示，草稿逐字符一致", async () => {
		const rendered = await renderEditor("", false);
		await focusEditor(rendered.editorElement);

		// jsdom 没有真的剪贴板事件，按插件读到的那几个字段造一个
		let prevented = false;
		const event = {
			clipboardData: { files: [], getData: () => PROMPT },
			preventDefault: () => {
				prevented = true;
			},
		} as unknown as ClipboardEvent;
		await act(async () => {
			rendered.editor.dispatchCommand(PASTE_COMMAND, event);
		});
		expect(prevented).toBe(true);
		expect(rendered.draft()).toBe(PROMPT);
		// 粘贴和"切会话恢复"走同一套解析：围栏是代码块，其余四行是原文
		expect(topBlocks(rendered.container)).toEqual(["p", "p", "p", "p", "code"]);
		rendered.unmount();
	});

	it("切会话铺回来的草稿只有代码块是结构件，其余是原文", async () => {
		const rendered = await renderEditor(PROMPT, false);
		// 顶层块：四个普通段落 + 一个代码块
		expect(topBlocks(rendered.container)).toEqual(["p", "p", "p", "p", "code"]);
		expect(rendered.draft()).toBe(PROMPT);
		expect(rendered.draft()).not.toContain("\\");
		rendered.unmount();
	});

	it("`↑` 回填的历史消息也按原文铺开", async () => {
		const rendered = await renderEditor("", false, { sentHistory: [PROMPT] });
		await focusEditor(rendered.editorElement);

		await pressKey(rendered.editorElement, "ArrowUp");
		expect(rendered.draft()).toBe(PROMPT);
		expect(topBlocks(rendered.container)).toEqual(["p", "p", "p", "p", "code"]);
		rendered.unmount();
	});
});
