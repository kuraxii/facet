import { describe, expect, it } from "vitest";
import { isComposingKey } from "./keys.ts";

/**
 * 组词判定。
 *
 * 这里只喂最小的形状：React 合成事件带 `nativeEvent`，窗口事件本身就是原生事件，
 * 两条路径都要挡。
 */
describe("组词期间的按键", () => {
	it("React 事件按 nativeEvent.isComposing 判", () => {
		const event = { nativeEvent: { isComposing: true, keyCode: 13 }, keyCode: 13 };
		expect(isComposingKey(event as unknown as Parameters<typeof isComposingKey>[0])).toBe(true);
	});

	it("只给 keyCode 229 的老路径也算组词", () => {
		const event = { nativeEvent: { isComposing: false, keyCode: 229 }, keyCode: 229 };
		expect(isComposingKey(event as unknown as Parameters<typeof isComposingKey>[0])).toBe(true);
	});

	it("原生窗口事件直接看自身", () => {
		expect(isComposingKey({ isComposing: true, keyCode: 13 } as KeyboardEvent)).toBe(true);
		expect(isComposingKey({ isComposing: false, keyCode: 13 } as KeyboardEvent)).toBe(false);
	});
});
