/**
 * 桌面本地状态存储引擎测试：验证防抖合并、并发串行不丢更新、以及 close() 退出前冲刷。
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLocalSettings } from "./local-settings.ts";
import { LocalStateStore } from "./state-store.ts";

describe("LocalStateStore", () => {
	it("合并短时间内的多次修改并在 close 时保证落盘完成", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-state-store-"));
		const file = join(root, "desktop.json");
		const store = new LocalStateStore({ file, flushDelayMs: 500 });
		await store.init();

		store.update((current) => ({ ...current, uiScale: 110 }));
		store.setScopedItem("app", "facet.sidebar.collapsed", "1");
		store.setScopedItem("ssh://dev", "facet.panel.open", "1");
		store.setAppearance({ theme: "claude", codeTheme: "nord" });
		store.setInput({ sendKey: "shiftEnter" });

		// 即使防抖未到期，close() 也必须立即把完整最新状态冲刷到盘
		await store.close();

		const saved = await readLocalSettings(file);
		expect(saved.uiScale).toBe(110);
		expect(saved.appearance?.theme).toBe("claude");
		expect(saved.appearance?.codeTheme).toBe("nord");
		expect(saved.input?.sendKey).toBe("shiftEnter");
		expect(saved.storage?.app?.["facet.sidebar.collapsed"]).toBe("1");
		expect(saved.storage?.workspaces?.["ssh://dev"]?.["facet.panel.open"]).toBe("1");
	});

	it("支持删除作用域键，删空工作区后自动回收空表", async () => {
		const root = await mkdtemp(join(tmpdir(), "facet-state-store-"));
		const file = join(root, "desktop.json");
		const store = new LocalStateStore({ file, flushDelayMs: 10 });
		await store.init();

		store.setScopedItem("local", "draft", "hello");
		store.setScopedItem("local", "draft", null);
		await store.close();

		const saved = await readLocalSettings(file);
		expect(saved.storage).toBeUndefined();
	});
});
