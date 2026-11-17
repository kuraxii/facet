/**
 * 标签文字的映射。
 *
 * 纯函数：只把标签数据与它引用的会话、终端信息合成文字，不碰 DOM，也不需要渲染。
 */
import type { MainTab } from "@facet/ui";
import { describe, expect, it } from "vitest";
import { absoluteProjectPath, isCurrentSessionTab, toTabItems } from "./main-tabs.ts";

const text = {
	untitled: "未命名",
	changes: "变更",
	diff: "变更文档",
	commit: (sha: string) => `提交 ${sha}`,
	newTerminal: "新终端",
};

const facts = {
	session: undefined,
	openedSessionId: "s1",
	summaries: [{ path: "/w/a.jsonl", name: "会话甲", firstMessage: "你好" }],
};

describe("absoluteProjectPath", () => {
	it("相对路径拼到目录后面", () => {
		expect(absoluteProjectPath("/w", "a/b.ts")).toBe("/w/a/b.ts");
		expect(absoluteProjectPath("/w/", "a/b.ts")).toBe("/w/a/b.ts");
	});

	it("已经是绝对路径就原样返回", () => {
		expect(absoluteProjectPath("/w", "/etc/x")).toBe("/etc/x");
	});
});

describe("isCurrentSessionTab", () => {
	const tab: MainTab = { id: "session:/s1", kind: "session", file: "/w/a.jsonl", sessionId: "s1" };

	it("没有会话时哪条都不是当前", () => {
		expect(isCurrentSessionTab(tab, facts)).toBe(false);
	});

	it("文件与当前会话一致就是当前", () => {
		const session = { channel: "session:/s1", state: { file: "/w/a.jsonl" } } as never;
		expect(isCurrentSessionTab(tab, { ...facts, session })).toBe(true);
	});

	it("两边都没有文件时算同一个会话", () => {
		const session = { channel: "session:/other", state: { file: undefined } } as never;
		const unsaved: MainTab = { id: "session:/s1", kind: "session", file: undefined, sessionId: "s1" };
		expect(isCurrentSessionTab(unsaved, { ...facts, session })).toBe(true);
	});

	it("会话已有文件时，没写盘的标签按标识比", () => {
		const session = { channel: "session:/other", state: { file: "/w/b.jsonl" } } as never;
		const unsaved: MainTab = { id: "session:/s1", kind: "session", file: undefined, sessionId: "s1" };
		expect(isCurrentSessionTab(unsaved, { ...facts, session, openedSessionId: undefined })).toBe(false);
		expect(isCurrentSessionTab(unsaved, { ...facts, session })).toBe(true);
	});
});

describe("toTabItems", () => {
	it("会话标签用清单里的名字与首条消息", () => {
		const items = toTabItems(
			[{ id: "session:/s1", kind: "session", file: "/w/a.jsonl", sessionId: "s1" }],
			[],
			facts,
			text,
		);
		expect(items[0]).toMatchObject({ id: "session:/s1", label: "会话甲", title: "/w/a.jsonl" });
	});

	it("文件与变更文档带绝对路径", () => {
		const items = toTabItems(
			[
				{ id: "file:1", kind: "file", cwd: "/w", path: "a/b.ts" },
				{ id: "diff:1", kind: "diff", cwd: "/w", path: "a/b.ts", untracked: false },
			],
			[],
			facts,
			text,
		);
		expect(items[0]?.copyPath).toEqual({ absolute: "/w/a/b.ts", relative: "a/b.ts" });
		expect(items[1]?.label).toBe("变更文档 · b.ts");
	});

	it("终端标签用终端的目录与 shell", () => {
		const items = toTabItems(
			[{ id: "terminal:t1", kind: "terminal", terminalId: "t1" }],
			[{ id: "t1", cwd: "/w", shell: "bash", restored: false } as never],
			facts,
			text,
		);
		expect(items[0]).toMatchObject({ label: "w", title: "bash · /w" });
	});

	it("终端还没进清单时用占位文字", () => {
		const items = toTabItems([{ id: "terminal:t9", kind: "terminal", terminalId: "t9" }], [], facts, text);
		expect(items[0]).toMatchObject({ label: "新终端", title: "t9" });
	});
});
