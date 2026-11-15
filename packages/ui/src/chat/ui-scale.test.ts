import { describe, expect, it } from "vitest";
import { normalizeUiScale, stepUiScale } from "./ui-scale.ts";

describe("界面缩放档位", () => {
	it("取最接近的档位", () => {
		expect(normalizeUiScale(84)).toBe(80);
		expect(normalizeUiScale(96)).toBe(100);
		expect(normalizeUiScale(148)).toBe(150);
	});

	it("按方向前进并在两端停住", () => {
		expect(stepUiScale(100, 1)).toBe(110);
		expect(stepUiScale(100, -1)).toBe(90);
		expect(stepUiScale(80, -1)).toBe(80);
		expect(stepUiScale(150, 1)).toBe(150);
	});
});
