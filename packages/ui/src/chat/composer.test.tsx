import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Composer } from "./Composer.tsx";
import { QueueStrip } from "./QueueStrip.tsx";

function renderComposer(activity: "idle" | "running" | "compacting" | "stopping", value: string): string {
	return renderToStaticMarkup(
		createElement(Composer, {
			value,
			onChange: () => {},
			onSend: () => {},
			onStop: () => {},
			activity,
			model: undefined,
			thinkingLevel: undefined,
		}),
	);
}

describe("输入区", () => {
	it("运行中可以发送,提示改为插入当前轮次", () => {
		const html = renderComposer("running", "补充一句");
		expect(html).toContain("回车插入当前轮次");
		expect(html).toContain('aria-label="排队"');
		expect(html).not.toMatch(/class="send"[^>]*disabled/);
	});

	it("压缩与停止中不接受新输入", () => {
		expect(renderComposer("compacting", "补充一句")).toMatch(/class="send"[^>]*disabled/);
		expect(renderComposer("stopping", "补充一句")).toMatch(/class="send"[^>]*disabled/);
	});

	it("空闲时按发送处理", () => {
		const html = renderComposer("idle", "你好");
		expect(html).toContain("回车发送");
		expect(html).toContain('aria-label="发送"');
	});
});

describe("排队条", () => {
	it("没有排队内容时不渲染", () => {
		expect(
			renderToStaticMarkup(
				createElement(QueueStrip, {
					queued: { steering: [], followUp: [] },
					onClear: () => {},
				}),
			),
		).toBe("");
	});

	it("列出排队内容与条数,带收回入口", () => {
		const html = renderToStaticMarkup(
			createElement(QueueStrip, {
				queued: { steering: ["先看日志", "再看配置"], followUp: [] },
				onClear: () => {},
			}),
		);
		expect(html).toContain("排队 2 条");
		expect(html).toContain("先看日志");
		expect(html).toContain("再看配置");
		expect(html).toContain("收回");
	});
});

describe("模型与思考档位芯片", () => {
	it("给出可选模型时芯片可以打开菜单", () => {
		const html = renderToStaticMarkup(
			createElement(Composer, {
				value: "",
				onChange: () => {},
				onSend: () => {},
				onStop: () => {},
				activity: "idle",
				model: {
					provider: "p",
					id: "m1",
					name: "模型一",
					api: "openai-responses",
					reasoning: true,
					contextWindow: 1000,
					maxTokens: 100,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
				thinkingLevel: "medium",
				models: [],
				onModelChange: () => {},
			}),
		);
		const modelChip = html.match(/<button[^>]*class="chip"[^>]*>m1/);
		expect(modelChip?.[0]).toBeDefined();
		expect(modelChip?.[0]).not.toContain("disabled");
	});

	it("不给回调时模型芯片只展示", () => {
		const html = renderComposer("idle", "");
		expect(html).toMatch(/<button[^>]*class="chip"[^>]*disabled[^>]*>无模型/);
	});

	it("换行发送时占位符写明 Shift+回车", () => {
		const html = renderToStaticMarkup(
			createElement(Composer, {
				value: "",
				onChange: () => {},
				onSend: () => {},
				onStop: () => {},
				activity: "idle",
				model: undefined,
				thinkingLevel: undefined,
				shiftEnterToSend: true,
			}),
		);
		expect(html).toContain("Shift+回车发送");
	});
});
