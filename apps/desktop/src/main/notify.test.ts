/**
 * 系统通知出口的三条规矩。
 *
 * 用例盯的就是这三件：窗口在前台时不弹（用户已经看着了）、系统不支持通知时不炸、点了通知
 * 才把会话文件交回调用方（点之前什么都不发生）。
 */
import { describe, expect, it, vi } from "vitest";
import { createNotifier, type NotificationLike, shouldNotify } from "./notify.ts";

/** 造一个记录调用的假通知对象。 */
function fakeNotification(): NotificationLike & {
	readonly listeners: Map<string, () => void>;
} {
	const listeners = new Map<string, () => void>();
	return {
		listeners,
		on: (event, listener) => {
			listeners.set(event, listener);
		},
		show: () => undefined,
	};
}

describe("系统通知", () => {
	it("窗口在前台时不弹，最小化或被盖住时弹", () => {
		expect(shouldNotify({ focused: true })).toBe(false);
		expect(shouldNotify({ focused: false })).toBe(true);
	});

	it("系统不支持通知时返回 false，不抛错", () => {
		const onClick = vi.fn();
		const notifier = createNotifier({ createNotification: undefined, onClick, title: "Facet" });
		expect(notifier.show({ file: "a.jsonl", body: "回复结束" }, { focused: false })).toBe(false);
		expect(onClick).not.toHaveBeenCalled();
	});

	it("弹出去的通知带固定标题与状态词，点击后把会话文件交回去", () => {
		const created: { title: string; body: string }[] = [];
		const notification = fakeNotification();
		const onClick = vi.fn();
		const notifier = createNotifier({
			createNotification: (options) => {
				created.push(options);
				return notification;
			},
			onClick,
			title: "Facet",
		});
		expect(notifier.show({ file: "a.jsonl", body: "需要你回答" }, { focused: false })).toBe(true);
		expect(created).toEqual([{ title: "Facet", body: "需要你回答" }]);
		// 点之前什么都不发生
		expect(onClick).not.toHaveBeenCalled();
		notification.listeners.get("click")?.();
		expect(onClick).toHaveBeenCalledWith("a.jsonl");
	});

	it("窗口在前台时连通知对象都不造", () => {
		const create = vi.fn(() => fakeNotification());
		const notifier = createNotifier({ createNotification: create, onClick: vi.fn(), title: "Facet" });
		expect(notifier.show({ file: "a.jsonl", body: "出错" }, { focused: true })).toBe(false);
		expect(create).not.toHaveBeenCalled();
	});
});
