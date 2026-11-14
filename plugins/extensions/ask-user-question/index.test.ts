import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_DESCRIPTION, default as register, TOOL_NAME } from "./index.ts";
import type { QuestionnaireResult } from "./schema.ts";

interface RegisteredTool {
	name: string;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ExtensionContext,
	) => Promise<{ content: Array<{ text: string }>; details: QuestionnaireResult }>;
}

function setup(answers: unknown) {
	let tool: RegisteredTool | undefined;
	register({
		registerTool: (value: RegisteredTool) => {
			tool = value;
		},
	} as unknown as ExtensionAPI);
	if (tool === undefined) throw new Error("没有注册工具");
	const asked: unknown[] = [];
	const ctx = {
		hasUI: true,
		ui: {
			askForm: async (questions: unknown) => {
				asked.push(questions);
				return answers;
			},
		},
	} as unknown as ExtensionContext;
	return { tool, ctx, asked };
}

const params = {
	questions: [
		{
			question: "选择项目",
			header: "项目",
			options: [
				{ label: "A", description: "写入报告", preview: "报告预览" },
				{ label: "B", description: "只改代码" },
			],
		},
		{
			question: "补充说明",
			header: "补充",
			multiSelect: true,
			options: [
				{ label: "日志", description: "记录日志" },
				{ label: "测试", description: "补测试" },
			],
		},
	],
};

describe("facet ask_user_question", () => {
	it("注册 rpiv 的工具名与描述", () => {
		const { tool } = setup([]);
		expect(tool.name).toBe(TOOL_NAME);
		expect(DEFAULT_TOOL_DESCRIPTION).toContain("structured questions");
	});

	it("把题目交给结构化卡片并拼出 rpiv 的 envelope", async () => {
		const { tool, ctx, asked } = setup([
			{ id: "q0", selections: ["A"], comment: "先看预览" },
			{ id: "q1", selections: ["日志"], custom: "只看错误", comment: "" },
		]);
		const result = await tool.execute("call-1", params, undefined, undefined, ctx);
		expect(asked[0]).toEqual([
			{
				id: "q0",
				title: "选择项目",
				header: "项目",
				allowCustom: true,
				choices: [
					{ label: "A", description: "写入报告", preview: "报告预览" },
					{ label: "B", description: "只改代码" },
				],
			},
			{
				id: "q1",
				title: "补充说明",
				header: "补充",
				multiple: true,
				allowCustom: true,
				choices: [
					{ label: "日志", description: "记录日志" },
					{ label: "测试", description: "补测试" },
				],
			},
		]);
		expect(result.content[0]?.text).toBe(
			'User has answered your questions: "选择项目"="A". selected preview: 报告预览. user notes: 先看预览. "补充说明"="日志, 只看错误". You can now continue with the user\'s answers in mind.',
		);
		expect(result.details.answers).toEqual([
			{
				questionIndex: 0,
				question: "选择项目",
				kind: "option",
				answer: "A",
				notes: "先看预览",
				preview: "报告预览",
			},
			{
				questionIndex: 1,
				question: "补充说明",
				kind: "multi",
				answer: "只看错误",
				selected: ["日志"],
			},
		]);
	});

	it("取消返回 rpiv 的拒绝文案", async () => {
		const { tool, ctx } = setup(undefined);
		const result = await tool.execute("call-2", params, undefined, undefined, ctx);
		expect(result.content[0]?.text).toBe("User declined to answer questions");
		expect(result.details).toMatchObject({ answers: [], cancelled: true });
	});

	it("没有结构化入口时告诉模型没有展示", async () => {
		const { tool, ctx } = setup([]);
		(ctx.ui as unknown as { askForm?: unknown }).askForm = undefined;
		const result = await tool.execute("call-3", params, undefined, undefined, ctx);
		expect(result.content[0]?.text).toContain("never saw the questions");
		expect(result.details).toMatchObject({ error: "no_custom_ui", cancelled: true });
	});

	it("题目不合法时不调用界面", async () => {
		const { tool, ctx, asked } = setup([]);
		const result = await tool.execute(
			"call-4",
			{
				questions: [
					{
						question: "选一个",
						header: "选",
						options: [
							{ label: "Other", description: "保留标签" },
							{ label: "A", description: "普通选项" },
						],
					},
				],
			},
			undefined,
			undefined,
			ctx,
		);
		expect(result.details).toMatchObject({ error: "reserved_label", cancelled: true });
		expect(asked).toEqual([]);
	});

	it("未作答的题按 rpiv 的格式标出", async () => {
		const { tool, ctx } = setup([{ id: "q0", selections: ["A"] }]);
		const result = await tool.execute("call-5", params, undefined, undefined, ctx);
		expect(result.content[0]?.text).toContain('unanswered: "补充说明".');
		expect(result.details.unanswered).toEqual([1]);
	});
});
