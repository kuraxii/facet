/**
 * 轻提示队列的纯函数：合并、上限、过期与暂停补时。
 */
import { describe, expect, it } from "vitest";
import {
	dismissToast,
	expireToasts,
	pushToast,
	shiftToastExpiry,
	TOAST_LIMIT,
	toastDuration,
} from "./toast.ts";

const NOW = 1_000_000;

describe("入队", () => {
	it("新提示排在后面并按等级计时", () => {
		const toasts = pushToast([], { level: "error", message: "写盘失败 EACCES", now: NOW });
		expect(toasts).toHaveLength(1);
		expect(toasts[0]).toMatchObject({
			id: "error:写盘失败 EACCES",
			level: "error",
			count: 1,
			createdAt: NOW,
			expiresAt: NOW + toastDuration("error"),
		});
	});

	it("同一句话再出现时只累加次数并重新计时", () => {
		const first = pushToast([], { level: "warning", message: "终端退出", now: NOW });
		const second = pushToast(first, { level: "warning", message: "终端退出", now: NOW + 1000 });
		expect(second).toHaveLength(1);
		expect(second[0]).toMatchObject({ count: 2, createdAt: NOW + 1000 });
		expect(second[0]?.expiresAt).toBe(NOW + 1000 + toastDuration("warning"));
	});

	it("同内容不同等级算两条", () => {
		const first = pushToast([], { level: "info", message: "已复制", now: NOW });
		const second = pushToast(first, { level: "error", message: "已复制", now: NOW });
		expect(second.map((toast) => toast.level)).toEqual(["info", "error"]);
	});

	it("超过上限时丢掉最旧的一条", () => {
		let toasts = pushToast([], { level: "info", message: "一", now: NOW });
		toasts = pushToast(toasts, { level: "info", message: "二", now: NOW });
		toasts = pushToast(toasts, { level: "info", message: "三", now: NOW });
		toasts = pushToast(toasts, { level: "info", message: "四", now: NOW });
		expect(toasts).toHaveLength(TOAST_LIMIT);
		expect(toasts.map((toast) => toast.message)).toEqual(["二", "三", "四"]);
	});
});

describe("过期与手动收掉", () => {
	it("到点的出队，没到点原样返回入参", () => {
		const toasts = pushToast([], { level: "info", message: "已复制", now: NOW });
		expect(expireToasts(toasts, NOW + 1)).toBe(toasts);
		expect(expireToasts(toasts, NOW + toastDuration("info"))).toHaveLength(0);
	});

	it("按 id 收掉，一条都没有时原样返回", () => {
		const toasts = pushToast([], { level: "info", message: "已复制", now: NOW });
		expect(dismissToast(toasts, "info:别的")).toBe(toasts);
		expect(dismissToast(toasts, "info:已复制")).toHaveLength(0);
	});
});

describe("暂停补时", () => {
	it("按暂停时长把到期时刻整体后移", () => {
		const toasts = pushToast([], { level: "info", message: "已复制", now: NOW });
		const shifted = shiftToastExpiry(toasts, 2000);
		expect(shifted[0]?.expiresAt).toBe(NOW + toastDuration("info") + 2000);
	});

	it("时长为零或没有提示时原样返回", () => {
		const toasts = pushToast([], { level: "info", message: "已复制", now: NOW });
		expect(shiftToastExpiry(toasts, 0)).toBe(toasts);
		expect(shiftToastExpiry([], 1000)).toEqual([]);
	});
});
