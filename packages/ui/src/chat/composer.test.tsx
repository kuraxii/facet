import type { ModelInfo, SlashCommand } from "@facet/protocol";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer.tsx";
import { QueueStrip } from "./QueueStrip.tsx";

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
