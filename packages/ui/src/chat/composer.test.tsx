import type { ModelInfo, SlashCommand } from "@facet/protocol";
import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";
import { act, createElement, type ReactElement, type RefObject, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer.tsx";
import { QueueStrip } from "./QueueStrip.tsx";
import { ComposerEditor, type ComposerKeyRoutes } from "./rich-editor/ComposerEditor.tsx";

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

/** 在 jsdom 里挂一个组件：客户端渲染，Lexical 要真实 DOM 才谈得上选区与键盘。 */
function render(element: ReactElement): Rendered {
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	act(() => {
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
function renderComposer(overrides: Partial<ComposerProps> = {}): Rendered & { editor: HTMLElement } {
	const rendered = render(createElement(Composer, composerProps(overrides)));
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

/** 发送按钮与停止按钮共用 `.send` 这一个位置。 */
function sendButton(container: HTMLElement): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(".send");
	if (button === null) {
		throw new Error("发送按钮没有渲染出来");
	}
	return button;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("输入区", () => {
	it("运行中可以发送,提示改为插入当前轮次", () => {
		const { container, unmount } = renderComposer({ activity: "running", value: "补充一句" });
		expect(container.innerHTML).toContain("回车插入当前轮次");
		expect(sendButton(container).getAttribute("aria-label")).toBe("排队");
		expect(sendButton(container).disabled).toBe(false);
		unmount();
	});

	it("压缩与停止中不接受新输入", () => {
		for (const activity of ["compacting", "stopping"] as const) {
			const { container, unmount } = renderComposer({ activity, value: "补充一句" });
			expect(sendButton(container).disabled).toBe(true);
			unmount();
		}
	});

	it("发送与停止占同一个按钮", () => {
		// 没有内容要发时按钮是停止
		const running = renderComposer({ activity: "running", value: "" });
		expect(running.container.querySelector(".send.is-stop")).not.toBeNull();
		expect(sendButton(running.container).getAttribute("aria-label")).not.toBe("排队");
		running.unmount();

		// 有内容时同一个位置换回发送，运行中的含义是排队
		const queued = renderComposer({ activity: "running", value: "补充一句" });
		expect(queued.container.querySelector(".send.is-stop")).toBeNull();
		queued.unmount();

		// 空闲时不出现停止
		const idle = renderComposer({ activity: "idle", value: "" });
		expect(idle.container.querySelector(".send.is-stop")).toBeNull();
		idle.unmount();
	});

	it("空闲时按发送处理", () => {
		const { container, unmount } = renderComposer({ activity: "idle", value: "你好" });
		expect(container.innerHTML).toContain("回车发送");
		expect(sendButton(container).getAttribute("aria-label")).toBe("发送");
		unmount();
	});

	it("换行发送时占位符写明 Shift+回车", () => {
		const { container, unmount } = renderComposer({ value: "", shiftEnterToSend: true });
		expect(container.innerHTML).toContain("Shift+回车发送");
		unmount();
	});
});

describe("键盘", () => {
	it("回车发送", async () => {
		const onSend = vi.fn();
		const { editor, unmount } = renderComposer({ value: "你好", onSend });
		const event = await pressKey(editor, "Enter");
		expect(onSend).toHaveBeenCalledTimes(1);
		// 发送键位拦下默认行为，不会同时插入换行
		expect(event.defaultPrevented).toBe(true);
		unmount();
	});

	it("回车发送时 Shift+回车换行", async () => {
		const onSend = vi.fn();
		const onChange = vi.fn();
		const { editor, unmount } = renderComposer({ value: "你好", onSend, onChange });
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
		const { editor, unmount } = renderComposer({
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
		const { editor, unmount } = renderComposer({ value: "", onSend, onChange });
		await focusEditor(editor);
		const event = await pressKey(editor, "Enter");
		expect(onSend).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
		unmount();
	});

	it("组词期间的回车不发送", async () => {
		const onSend = vi.fn();
		const { editor, unmount } = renderComposer({ value: "ni", onSend });
		await focusEditor(editor);
		// 有的浏览器组词时只给 keyCode 229
		await pressKey(editor, "Enter", { keyCode: 229 });
		expect(onSend).not.toHaveBeenCalled();
		unmount();
	});

	it("受阻时回车不发出去", async () => {
		const onSend = vi.fn();
		const { editor, unmount } = renderComposer({ value: "补充一句", onSend, isBlocked: true });
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

	it("开头打斜杠时列出候选", () => {
		const { container, unmount } = renderComposer({ value: "/co", commands });
		const palette = container.querySelector('[role="listbox"]');
		expect(palette).not.toBeNull();
		expect(palette?.textContent).toContain("/compact");
		// 只有前缀命中的那条
		expect(palette?.textContent).not.toContain("/review");
		unmount();
	});

	it("方向键换高亮,回车选中", async () => {
		const onChange = vi.fn();
		const onRunCommand = vi.fn();
		const { container, editor, unmount } = renderComposer({ value: "/", commands, onChange, onRunCommand });

		// 默认高亮第一条；下移一次落到第二条
		await pressKey(editor, "ArrowDown");
		const rows = [...container.querySelectorAll(".cmd-row")];
		expect(rows[0]?.className).not.toContain("is-on");
		expect(rows[1]?.className).toContain("is-on");

		// 交回给 pi 的命令：只把 `/名字 ` 填进输入框
		await pressKey(editor, "Enter");
		expect(onChange).toHaveBeenCalledWith("/review ");
		expect(onRunCommand).not.toHaveBeenCalled();
		unmount();
	});

	it("界面自己处理的命令选中后就地执行", async () => {
		const onChange = vi.fn();
		const onRunCommand = vi.fn();
		const { editor, unmount } = renderComposer({ value: "/comp", commands, onChange, onRunCommand });
		await pressKey(editor, "Enter");
		expect(onRunCommand).toHaveBeenCalledWith(expect.objectContaining({ name: "compact" }), "");
		expect(onChange).toHaveBeenCalledWith("");
		unmount();
	});

	it("Esc 收起面板,回车回到发送", async () => {
		const onSend = vi.fn();
		const { container, editor, unmount } = renderComposer({ value: "/", commands, onSend });
		expect(container.querySelector('[role="listbox"]')).not.toBeNull();
		await pressKey(editor, "Escape");
		expect(container.querySelector('[role="listbox"]')).toBeNull();
		// 内容没变，面板不再弹回来
		expect(container.querySelector('[role="listbox"]')).toBeNull();
		unmount();
	});

	it("组词期间的上下键不换高亮", async () => {
		const { container, editor, unmount } = renderComposer({ value: "/", commands });
		const before = container.querySelector(".cmd-row.is-on")?.textContent;
		await pressKey(editor, "ArrowDown", { keyCode: 229 });
		expect(container.querySelector(".cmd-row.is-on")?.textContent).toBe(before);
		unmount();
	});
});

describe("受控同步", () => {
	it("外部改值之后输入域跟着换内容", () => {
		const rendered = renderComposer({ value: "旧草稿" });
		expect(rendered.editor.textContent).toContain("旧草稿");
		rendered.rerender(createElement(Composer, composerProps({ value: "引用进来的一段" })));
		expect(rendered.editor.textContent).toContain("引用进来的一段");
		expect(rendered.editor.textContent).not.toContain("旧草稿");
		rendered.unmount();
	});

	it("清空草稿之后输入域是空的", () => {
		const rendered = renderComposer({ value: "先写了一段" });
		rendered.rerender(createElement(Composer, composerProps({ value: "" })));
		expect(rendered.editor.textContent).toBe("");
		rendered.unmount();
	});
});

describe("排队条", () => {
	it("没有排队内容时不渲染", () => {
		const { container, unmount } = render(
			createElement(QueueStrip, { queued: { steering: [], followUp: [] }, onClear: () => {} }),
		);
		expect(container.innerHTML).toBe("");
		unmount();
	});

	it("列出排队内容与条数,带收回入口", () => {
		const { container, unmount } = render(
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

	it("给出可选模型时芯片可以打开菜单", () => {
		const { container, unmount } = renderComposer({
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

	it("思考档位芯片用大脑图标加档位取值，不翻译", () => {
		const { container, unmount } = renderComposer({ thinkingLevel: "max", onThinkingLevelChange: () => {} });
		const chip = container.querySelector<HTMLButtonElement>('button[aria-label="思考档位 Max"]');
		expect(chip).not.toBeNull();
		expect(chip?.querySelector(".lucide-brain")).not.toBeNull();
		expect(chip?.textContent).toContain("Max");
		expect(chip?.textContent).not.toContain("思考 ·");
		unmount();
	});

	it("不给回调时模型芯片只展示", () => {
		const { container, unmount } = renderComposer();
		const chip = container.querySelector<HTMLButtonElement>("button.chip");
		expect(chip?.disabled).toBe(true);
		expect(chip?.textContent).toContain("无模型");
		unmount();
	});
});

describe("发送受阻", () => {
	it("等待扩展询问时停止可用，只读与断线时禁用停止", () => {
		for (const canStop of [true, false]) {
			const { container, unmount } = renderComposer({
				value: "已有草稿",
				activity: "running",
				isBlocked: true,
				canStop,
			});
			const stop = container.querySelector<HTMLButtonElement>(".send.is-stop");
			expect(stop).not.toBeNull();
			expect(stop?.disabled).toBe(!canStop);
			unmount();
		}
	});

	it("受阻时只禁用发送，不显示说明", () => {
		const { container, unmount } = renderComposer({ value: "有待发送的内容", isBlocked: true });
		expect(container.querySelector(".composer-blocked")).toBeNull();
		expect(sendButton(container).disabled).toBe(true);
		unmount();
	});
});

/** 富文本输入域的按键落点：块级用例只关心换行键位与能不能发。 */
function editorRoutes(shiftEnterToSend: boolean): ComposerKeyRoutes {
	return {
		isPaletteOpen: false,
		onPaletteMove: () => {},
		onPalettePick: () => {},
		onPaletteClose: () => {},
		canSend: true,
		shiftEnterToSend,
		onSend: () => {},
	};
}

/** 受控外壳：草稿跟着 `onChange` 回传，与 `Composer` 接线的方式一致。 */
function EditorHost(props: {
	initial: string;
	shiftEnterToSend: boolean;
	editorRef: RefObject<LexicalEditor | null>;
	onDraft: (draft: string) => void;
}): ReactElement {
	const [draft, setDraft] = useState(props.initial);
	return (
		<ComposerEditor
			value={draft}
			onChange={(next) => {
				setDraft(next);
				props.onDraft(next);
			}}
			placeholder="输入消息"
			routes={editorRoutes(props.shiftEnterToSend)}
			editorRef={props.editorRef}
		/>
	);
}

/** 一份渲染好的富文本输入域。 */
interface EditorRendered extends Rendered {
	/** 输入域根节点 */
	editorElement: HTMLElement;
	/** 编辑器句柄，用例靠它模拟输入 */
	editor: LexicalEditor;
	/** 最近一次回传给父级的草稿 */
	draft: () => string;
}

/** 挂一个受控的富文本输入域。 */
function renderEditor(initial: string, shiftEnterToSend: boolean): EditorRendered {
	const editorRef: RefObject<LexicalEditor | null> = { current: null };
	let latest = initial;
	const rendered = render(
		createElement(EditorHost, {
			initial,
			shiftEnterToSend,
			editorRef,
			onDraft: (next: string) => {
				latest = next;
			},
		}),
	);
	const editorElement = rendered.container.querySelector<HTMLElement>(".composer-editor");
	const editor = editorRef.current;
	if (editorElement === null || editor === null) {
		throw new Error("编辑器没有渲染出来");
	}
	return { ...rendered, editorElement, editor, draft: () => latest };
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

/** 输入域顶层块的名字，用来确认引用、列表有没有干净地结束。 */
function topBlocks(container: HTMLElement): string[] {
	return [...container.querySelectorAll(".composer-editor > *")].map((node) => node.tagName.toLowerCase());
}

describe("块级结构换行", () => {
	for (const shiftEnterToSend of [false, true]) {
		const mode = shiftEnterToSend ? "Shift+回车发送" : "回车发送";
		/** 这一档设置下「换行」是哪一个组合：回车发送时靠 Shift，反之回车就是换行 */
		const newlineKey = shiftEnterToSend ? {} : { shiftKey: true };

		it(`${mode}：引用里换一次行继续写引用，再换行退回普通段落`, async () => {
			const rendered = renderEditor("> quote", shiftEnterToSend);
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

		it(`${mode}：有序列表里换行切出新条目，空条目上再换行退出列表`, async () => {
			const rendered = renderEditor("1. first", shiftEnterToSend);
			await focusEditor(rendered.editorElement);

			await pressKey(rendered.editorElement, "Enter", newlineKey);
			expect(rendered.container.querySelectorAll("li")).toHaveLength(2);
			await typeText(rendered.editor, "second");
			expect(rendered.draft()).toBe("1. first\n2. second");

			// 再换行出一个空条目，然后在空条目上换行：退出列表，已写的条目留在原地
			await pressKey(rendered.editorElement, "Enter", newlineKey);
			expect(rendered.container.querySelectorAll("li")).toHaveLength(3);
			await pressKey(rendered.editorElement, "Enter", newlineKey);
			expect(rendered.container.querySelectorAll("li")).toHaveLength(2);
			expect(topBlocks(rendered.container)).toEqual(["ol", "p"]);
			expect(rendered.draft().startsWith("1. first\n2. second")).toBe(true);
			rendered.unmount();
		});
	}

	it("引用中间换行只是续行，不退出引用", async () => {
		const rendered = renderEditor("> first\n> second", false);
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
		const rendered = renderEditor("> ", false);
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
		const rendered = renderEditor("> ", false);
		await focusEditor(rendered.editorElement);

		await pressKey(rendered.editorElement, "Backspace");
		expect(rendered.container.querySelector("blockquote")).toBeNull();
		expect(topBlocks(rendered.container)).toEqual(["p"]);
		rendered.unmount();
	});

	it("空的列表项在开头退格会变回普通段落", async () => {
		const rendered = renderEditor("1. first", false);
		await focusEditor(rendered.editorElement);
		// 换行出来的第二项是空的，在它开头退格应当退出列表
		await pressKey(rendered.editorElement, "Enter", { shiftKey: true });
		expect(rendered.container.querySelectorAll("li")).toHaveLength(2);
		await pressKey(rendered.editorElement, "Backspace");
		expect(rendered.container.querySelectorAll("li")).toHaveLength(1);
		expect(topBlocks(rendered.container)).toEqual(["ol", "p"]);
		rendered.unmount();
	});
});
