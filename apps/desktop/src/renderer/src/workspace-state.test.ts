/**
 * 会话级工作区内存状态的隔离与回收测试。
 */
import { describe, expect, it } from "vitest";
import {
	createWorkspaceSnapshot,
	DRAFT_SESSION_KEY,
	evictSessionWorkspaceState,
	getSessionWorkspaceState,
	setSessionWorkspaceFile,
	setSessionWorkspacePanel,
	workspaceSessionKey,
} from "./workspace-state.ts";

describe("workspace-state", () => {
	it("不同会话各自持有独立的右栏标签与文件预览，互不串台", () => {
		const snapshot = createWorkspaceSnapshot();
		const keyA = workspaceSessionKey("/w/a.jsonl");
		const keyB = workspaceSessionKey("/w/b.jsonl");

		setSessionWorkspacePanel(snapshot, keyA, {
			open: true,
			openTabs: ["files", "changes"],
			activeTab: "files",
		});
		setSessionWorkspaceFile(snapshot, keyA, { cwd: "/w", path: "src/a.ts" });

		expect(getSessionWorkspaceState(snapshot, keyB)).toEqual({
			panel: { open: false, openTabs: [], activeTab: null },
			file: undefined,
		});
		expect(getSessionWorkspaceState(snapshot, keyA)).toEqual({
			panel: { open: true, openTabs: ["files", "changes"], activeTab: "files" },
			file: { cwd: "/w", path: "src/a.ts" },
		});
	});

	it("会话被回收后清空其关联的标签与文件引用，再次读取回到默认收起态", () => {
		const snapshot = createWorkspaceSnapshot();
		const keyA = workspaceSessionKey("/w/a.jsonl");
		setSessionWorkspacePanel(snapshot, keyA, {
			open: true,
			openTabs: ["git-graph"],
			activeTab: "git-graph",
		});
		setSessionWorkspaceFile(snapshot, keyA, { cwd: "/w", path: "README.md" });

		expect(evictSessionWorkspaceState(snapshot, keyA)).toBe(true);
		expect(evictSessionWorkspaceState(snapshot, keyA)).toBe(false);
		expect(getSessionWorkspaceState(snapshot, keyA)).toEqual({
			panel: { open: false, openTabs: [], activeTab: null },
			file: undefined,
		});
	});

	it("无会话路径映射到草稿键", () => {
		expect(workspaceSessionKey(undefined)).toBe(DRAFT_SESSION_KEY);
		expect(workspaceSessionKey("")).toBe(DRAFT_SESSION_KEY);
	});
});
