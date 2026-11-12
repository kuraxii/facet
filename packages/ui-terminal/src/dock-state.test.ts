/**
 * 底部终端面板状态的读写与高度收边。
 */
import { describe, expect, it } from "vitest";
import {
	clampDockHeight,
	DEFAULT_DOCK_STATE,
	type DockStorage,
	readDockState,
	writeDockState,
} from "./dock-state.ts";

/** 内存里的本地存储。 */
function memory(initial: Record<string, string> = {}): DockStorage & { values: Record<string, string> } {
	const values = { ...initial };
	return {
		values,
		getItem: (key) => values[key] ?? null,
		setItem: (key, value) => {
			values[key] = value;
		},
	};
}

describe("终端面板状态", () => {
	it("空存储时拿到缺省状态", () => {
		expect(readDockState(memory())).toEqual(DEFAULT_DOCK_STATE);
	});

	it("写回去的能读回来", () => {
		const storage = memory();
		writeDockState(storage, { open: true, height: 320, activeId: "t1" });
		expect(readDockState(storage)).toEqual({ open: true, height: 320, activeId: "t1" });
	});

	it("空的活动终端读回来是空", () => {
		const storage = memory({ "facet.terminal.active": "" });
		expect(readDockState(storage).activeId).toBeUndefined();
	});

	it("高度收进上下限，上限跟着窗口高度走", () => {
		expect(clampDockHeight(10)).toBe(120);
		expect(clampDockHeight(900, 800)).toBe(480);
		expect(clampDockHeight(300, 800)).toBe(300);
		expect(clampDockHeight(Number.NaN)).toBe(260);
	});
});
