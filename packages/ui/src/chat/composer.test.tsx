import type { ModelInfo, SlashCommand } from "@facet/protocol";
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";
import { act, createElement, type ReactElement, type RefObject, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
		expect(running.container.querySelector(".send.is-stop")).not.toBeNull();
		expect(sendButton(running.container).getAttribute("aria-label")).not.toBe("排队");
		running.unmount();

		// 有内容时同一个位置换回发送，运行中的含义是排队
		const queued = await renderComposer({ activity: "running", value: "补充一句" });
		expect(queued.container.querySelector(".send.is-stop")).toBeNull();
		queued.unmount();

		// 空闲时不出现停止
		const idle = await renderComposer({ activity: "idle", value: "" });
		expect(idle.container.querySelector(".send.is-stop")).toBeNull();
		idle.unmount();
	});

	it("空闲时按发送处理", async () => {
		const { container, unmount } = await renderComposer({ activity: "idle", value: "你好" });
		expect(container.innerHTML).toContain("回车发送");
		expect(sendButton(container).getAttribute("aria-label")).toBe("发送");
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
			const stop = container.querySelector<HTMLButtonElement>(".send.is-stop");
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
	options: { mentionFiles?: readonly string[]; commands?: readonly SlashCommand[] } = {},
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

		it(`${mode}：有序列表里换行切出新条目，空条目上再换行退出列表`, async () => {
			const rendered = await renderEditor("1. first", shiftEnterToSend);
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

	it("空的列表项在开头退格会变回普通段落", async () => {
		const rendered = await renderEditor("1. first", false);
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

describe("探针", () => {
	it("backspace 行为", async () => {
		const commands: SlashCommand[] = [
			{ name: "review", description: "审查改动", source: "skill", handler: "pi" },
		] as SlashCommand[];
		const onChange = vi.fn();
		const { container, editor, unmount } = await renderComposer({ value: "/rev", commands, onChange });
		await focusEditor(editor);
		console.log("panel open:", container.querySelector('[role="listbox"]') !== null);
		await pressKey(editor, "Enter");
		await act(async () => {});
		console.log("editor text:", JSON.stringify(editor.textContent));
		console.log(
			"after enter:",
			JSON.stringify(onChange.mock.calls),
			container.querySelector(".composer-command")?.outerHTML,
		);
		await pressKey(editor, "Backspace");
		console.log(
			"after bs1:",
			JSON.stringify(onChange.mock.calls),
			container.querySelector(".composer-command")?.outerHTML,
		);
		await pressKey(editor, "Backspace");
		console.log(
			"after bs2:",
			JSON.stringify(onChange.mock.calls),
			container.querySelector(".composer-command")?.outerHTML,
		);
		unmount();
	});
});
