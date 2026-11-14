import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionUi } from "./extension-ui.ts";

const bridges: ExtensionUi[] = [];

function bridge(): ExtensionUi {
	const ui = new ExtensionUi({} as ExtensionUIContext);
	bridges.push(ui);
	return ui;
}

function requestId(ui: ExtensionUi, index = 0): string {
	const id = ui.snapshot().prompts[index]?.requestId;
	if (id === undefined) throw new Error("没有待答请求");
	return id;
}

afterEach(() => {
	for (const ui of bridges.splice(0)) ui.dispose();
	vi.useRealTimers();
});

describe("扩展交互", () => {
	it("四种请求分别返回完整的用户应答", async () => {
		const ui = bridge();
		const select = ui.context.select("选择", ["A", "B"]);
		const confirm = ui.context.confirm("确认", "继续操作？");
		const input = ui.context.input("输入", "路径");
		const editor = ui.context.editor("编辑", "  第一行\n\n第二行  ");
		expect(ui.snapshot().prompts.map((prompt) => prompt.kind)).toEqual([
			"select",
			"confirm",
			"input",
			"editor",
		]);
		expect(ui.snapshot().prompts[3]).toMatchObject({ prefill: "  第一行\n\n第二行  " });
		const ids = ui.snapshot().prompts.map((prompt) => prompt.requestId);
		expect(ui.respond(ids[0] ?? "", { kind: "select", value: "B" })).toBe(true);
		ui.respond(ids[1] ?? "", { kind: "confirm", confirmed: true });
		ui.respond(ids[2] ?? "", { kind: "input", value: "" });
		ui.respond(ids[3] ?? "", { kind: "editor", value: "  编辑后\n\n末行  " });
		await expect(Promise.all([select, confirm, input, editor])).resolves.toEqual([
			"B",
			true,
			"",
			"  编辑后\n\n末行  ",
		]);
		expect(ui.snapshot().prompts).toEqual([]);
	});

	it("取消确认返回 false，其余返回 undefined", async () => {
		const ui = bridge();
		const results = [
			ui.context.select("选择", ["A"]),
			ui.context.confirm("确认", "继续？"),
			ui.context.input("输入"),
			ui.context.editor("编辑"),
		];
		for (const prompt of ui.snapshot().prompts) ui.respond(prompt.requestId, { kind: "cancel" });
		await expect(Promise.all(results)).resolves.toEqual([undefined, false, undefined, undefined]);
	});

	it("应答类型与选项必须匹配，第一份有效应答生效", async () => {
		const ui = bridge();
		const result = ui.context.select("选择", ["A"]);
		const id = requestId(ui);
		expect(() => ui.respond(id, { kind: "input", value: "A" })).toThrow("类型");
		expect(() => ui.respond(id, { kind: "select", value: "B" })).toThrow("选项");
		expect(ui.respond(id, { kind: "select", value: "A" })).toBe(true);
		expect(ui.respond(id, { kind: "cancel" })).toBe(false);
		await expect(result).resolves.toBe("A");
	});

	it("请求发布时复制选项，不接受随后改变的选项", async () => {
		const ui = bridge();
		const options = ["A"];
		const result = ui.context.select("选择", options);
		options.push("B");
		expect(ui.snapshot().prompts[0]).toMatchObject({ options: ["A"] });
		ui.cancel();
		await expect(result).resolves.toBeUndefined();
	});

	it("AbortSignal 清理请求、timer 与 listener", async () => {
		vi.useFakeTimers();
		const ui = bridge();
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		const result = ui.context.input("输入", undefined, { signal: controller.signal, timeout: 1000 });
		controller.abort();
		await expect(result).resolves.toBeUndefined();
		expect(ui.snapshot().prompts).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
		await expect(ui.context.confirm("确认", "继续？", { signal: controller.signal })).resolves.toBe(false);
	});

	it("正常应答同样清理 timeout 与 AbortSignal listener", async () => {
		vi.useFakeTimers();
		const ui = bridge();
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		const result = ui.context.confirm("确认", "继续？", { signal: controller.signal, timeout: 1000 });
		ui.respond(requestId(ui), { kind: "confirm", confirmed: false });
		await expect(result).resolves.toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		expect(remove).toHaveBeenCalledOnce();
	});

	it("超时取消，已到截止时刻的应答不生效", async () => {
		vi.useFakeTimers();
		const ui = bridge();
		const result = ui.context.confirm("确认", "继续？", { timeout: 1000 });
		const id = requestId(ui);
		vi.setSystemTime(Date.now() + 1000);
		expect(ui.respond(id, { kind: "confirm", confirmed: true })).toBe(false);
		await expect(result).resolves.toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		const next = ui.context.input("输入", undefined, { timeout: 100 });
		await vi.advanceTimersByTimeAsync(100);
		await expect(next).resolves.toBeUndefined();
	});

	it("长 timeout 按截止时刻等待，非法 timeout 立即取消", async () => {
		vi.useFakeTimers();
		const ui = bridge();
		const result = ui.context.confirm("确认", "继续？", { timeout: 2_147_483_700 });
		await vi.advanceTimersByTimeAsync(2_147_483_647);
		expect(ui.snapshot().prompts).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(53);
		await expect(result).resolves.toBe(false);
		for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			await expect(ui.context.input("输入", undefined, { timeout })).resolves.toBeUndefined();
		}
	});

	it("停止与释放解除全部等待，取消后新操作可以恢复", async () => {
		const ui = bridge();
		const first = ui.context.editor("编辑", "内容");
		ui.cancel();
		await expect(first).resolves.toBeUndefined();
		await expect(ui.context.input("后续询问")).resolves.toBeUndefined();
		ui.resume();
		const second = ui.context.confirm("确认", "继续？");
		expect(ui.snapshot().prompts).toHaveLength(1);
		ui.dispose();
		await expect(second).resolves.toBe(false);
		ui.resume();
		await expect(ui.context.input("已释放")).resolves.toBeUndefined();
	});

	it("限制并行请求数量，并按发起顺序保留其余请求", async () => {
		const ui = bridge();
		const results = Array.from({ length: 65 }, (_, index) => ui.context.input(`输入 ${index}`));
		expect(ui.snapshot().prompts).toHaveLength(64);
		await expect(results[64]).resolves.toBeUndefined();
		ui.respond(requestId(ui), { kind: "cancel" });
		expect(ui.snapshot().prompts[0]?.title).toBe("输入 1");
		ui.cancel();
		await Promise.all(results);
	});

	it("通知同文合并并限制频率，快照包含订阅之前的通知", async () => {
		vi.useFakeTimers();
		const ui = bridge();
		ui.context.notify("通知");
		ui.context.notify("通知");
		expect(ui.snapshot().notices).toHaveLength(1);
		for (let index = 0; index < 25; index += 1) ui.context.notify(`内容 ${index}`, "warning");
		expect(ui.snapshot().notices).toHaveLength(20);
		await vi.advanceTimersByTimeAsync(5000);
		ui.context.notify("通知");
		expect(ui.snapshot().notices).toHaveLength(20);
		expect(ui.snapshot().notices?.filter((notice) => notice.message === "通知")).toHaveLength(1);
		expect(ui.snapshot().notices?.at(-1)?.message).toBe("通知");
	});

	it("草稿写入保留完整文本，每次写入使用独立标识", () => {
		const ui = bridge();
		ui.context.setEditorText("  内容\n\n末行  ");
		const first = ui.snapshot().editor;
		ui.context.pasteToEditor("新内容");
		expect(first?.text).toBe("  内容\n\n末行  ");
		expect(ui.snapshot().editor?.text).toBe("新内容");
		expect(ui.snapshot().editor?.id).not.toBe(first?.id);
	});

	it("展示内容清理终端控制字符，编辑内容保持原文", async () => {
		const ui = bridge();
		const result = ui.context.confirm("\u001b[31m标题\u001b[0m", "\u001b[32m内容\u001b[0m");
		ui.context.notify("\u001b[31m通知\u001b[0m");
		expect(ui.snapshot().prompts[0]).toMatchObject({ title: "标题", message: "内容" });
		expect(ui.snapshot().notices?.[0]?.message).toBe("通知");
		ui.cancel();
		await result;
	});
});
