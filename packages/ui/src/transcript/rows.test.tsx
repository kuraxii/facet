import type { TranscriptItem } from "@facet/client-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatTranscript } from "./rows.tsx";

function userItem(id: string, entryId: string | undefined, text: string): TranscriptItem {
	return {
		kind: "message",
		id,
		entryId,
		role: "user",
		stopReason: undefined,
		parts: [{ kind: "text", partId: "text:0", text }],
		isStreaming: false,
		startedAt: 1,
		endedAt: undefined,
	};
}

function assistantItem(id: string, text: string): TranscriptItem {
	return {
		kind: "message",
		id,
		entryId: id,
		role: "assistant",
		stopReason: "stop",
		parts: [{ kind: "text", partId: "text:0", text }],
		isStreaming: false,
		startedAt: 2,
		endedAt: 3,
	};
}

function render(
	items: TranscriptItem[],
	canRevert: boolean,
	reverted: string[] = [],
	options: { withCopy?: boolean } = {},
): string {
	return renderToStaticMarkup(
		createElement(ChatTranscript, {
			items,
			canFork: true,
			onFork: () => {},
			canRevert,
			onRevert: (entryId: string) => reverted.push(entryId),
			...(options.withCopy === true ? { onCopyText: () => {} } : {}),
		}),
	);
}

const twoTurns = [
	userItem("e:u1", "u1", "第一条"),
	assistantItem("e:a1", "答复一"),
	userItem("e:u2", "u2", "第二条"),
	assistantItem("e:a2", "答复二"),
];

describe("用户消息的回退入口", () => {
	it("除第一条之外的用户消息各有一个回退按钮", () => {
		const html = render(twoTurns, true);
		expect((html.match(/revert-btn/g) ?? []).length).toBe(1);
		expect(html).toContain("回退");
	});

	it("本轮未结束时不显示回退", () => {
		const html = render(twoTurns, false);
		expect(html).not.toContain("revert-btn");
	});

	it("还没有条目 id 的实时用户消息不显示回退", () => {
		const html = render([userItem("m1", undefined, "刚发出的"), assistantItem("e:a1", "答复")], true);
		expect(html).not.toContain("revert-btn");
	});

	it("只有一条用户消息时没有回退入口", () => {
		const html = render([userItem("e:u1", "u1", "唯一一条"), assistantItem("e:a1", "答复")], true);
		expect(html).not.toContain("revert-btn");
	});
});

describe("被中止的一轮", () => {
	it("没执行到的工具调用标成未执行", () => {
		const aborted: TranscriptItem = {
			kind: "message",
			id: "e:a1",
			entryId: "a1",
			role: "assistant",
			stopReason: "aborted",
			parts: [
				{ kind: "text", partId: "text:0", text: "我先看看" },
				{
					kind: "toolCall",
					partId: "tool:c1",
					callId: "c1",
					name: "bash",
					input: { command: "ls" },
					status: "skipped",
					output: undefined,
					durationMs: undefined,
					details: undefined,
				},
			],
			isStreaming: false,
			startedAt: 2,
			endedAt: 3,
		};
		const html = render([userItem("e:u1", "u1", "看看文件"), aborted], false);
		expect(html).toContain("is-skipped");
		expect(html).toContain("未执行");
		expect(html).toContain("已停止");
	});
});

describe("错误卡片", () => {
	const errorItem: TranscriptItem = {
		kind: "error",
		id: "e:err",
		entryId: "err",
		role: "assistant",
		stopReason: "error",
		parts: [{ kind: "text", partId: "text:0", text: "429 请求过多" }],
		isStreaming: false,
		startedAt: 1,
		endedAt: 2,
	};

	function renderWithActions(onRetryTurn: (entryId: string, text: string) => void): string {
		return renderToStaticMarkup(
			createElement(ChatTranscript, {
				items: [userItem("e:u1", "u1", "帮我看下日志"), errorItem],
				canFork: true,
				onFork: () => {},
				canRevert: true,
				onRevert: () => {},
				onRetryTurn,
				onOpenSettings: () => {},
				onCopyDetails: () => {},
			}),
		);
	}

	it("显示错误原文与三个动作", () => {
		const html = renderWithActions(() => {});
		expect(html).toContain("429 请求过多");
		expect(html).toContain("重试");
		expect(html).toContain("打开设置");
		expect(html).toContain("复制详情");
	});

	it("运行中不给重试入口", () => {
		const html = renderToStaticMarkup(
			createElement(ChatTranscript, {
				items: [userItem("e:u1", "u1", "帮我看下日志"), errorItem],
				canFork: false,
				onFork: () => {},
				canRevert: false,
				onRevert: () => {},
				onRetryTurn: () => {},
			}),
		);
		expect(html).not.toContain(">重试<");
	});
});

describe("复制原文", () => {
	it("给了复制回调时，用户消息与收尾处各有一个复制按钮", () => {
		const html = render(twoTurns, true, [], { withCopy: true });
		// 两条用户消息 + 两轮的收尾动作区
		expect((html.match(/copy-btn/g) ?? []).length).toBe(4);
		expect((html.match(/user-foot/g) ?? []).length).toBe(2);
		expect(html).toContain("复制原文");
	});

	it("用户消息里复制排在回退左边", () => {
		const html = render(twoTurns, true, [], { withCopy: true });
		const foot = html.slice(html.indexOf("user-foot"));
		expect(foot.indexOf("copy-btn")).toBeLessThan(foot.indexOf("revert-btn"));
	});

	it("没有复制回调时不出现复制按钮", () => {
		expect(render(twoTurns, true)).not.toContain("copy-btn");
	});

	it("每一轮的收尾处也放一个复制按钮，紧挨在分叉左边", () => {
		const html = render(twoTurns, true, [], { withCopy: true });
		// 两轮各一个收尾动作区，复制在分叉之前
		expect((html.match(/turn-actions/g) ?? []).length).toBe(2);
		const actions = html.indexOf("turn-actions");
		expect(html.indexOf("copy-btn", actions)).toBeLessThan(html.indexOf("fork-btn", actions));
	});
});
