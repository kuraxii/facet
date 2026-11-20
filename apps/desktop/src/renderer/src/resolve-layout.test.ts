/**
 * 档位判定与中档预算折叠。
 *
 * 纯函数：只吃视口宽、偏好宽与意图位，不读窗口、不碰 DOM。边界视口覆盖三档两界
 * （`879/880`、`1099/1100`）与「刚好放得下」的预算线（`1012`）。
 */
import { describe, expect, it } from "vitest";
import {
	clampDragMax,
	type LayoutInput,
	layoutTierOf,
	MAIN_MIN_WIDTH,
	resolveLayout,
} from "./resolve-layout.ts";

/** 缺省偏好宽：与 `panel-state.ts`、`sidebar-state.ts` 的缺省值一致。 */
const SIDEBAR_PREF = 272;
const PANEL_PREF = 320;

function input(patch: Partial<LayoutInput> = {}): LayoutInput {
	return {
		viewportWidth: 1280,
		sidebarPref: SIDEBAR_PREF,
		panelPref: PANEL_PREF,
		sidebarIntent: true,
		panelIntent: true,
		priorityPane: "sidebar",
		...patch,
	};
}

describe("档位判定", () => {
	it("小于 880 是窄档", () => {
		expect(layoutTierOf(640)).toBe("narrow");
		expect(layoutTierOf(879)).toBe("narrow");
	});

	it("880 到 1099 是中档", () => {
		for (const width of [880, 881, 899, 900, 1012, 1099]) {
			expect(layoutTierOf(width), String(width)).toBe("mid");
		}
	});

	it("1100 起是宽档", () => {
		expect(layoutTierOf(1100)).toBe("wide");
		expect(layoutTierOf(1280)).toBe("wide");
	});

	it("读不懂的视口宽回落到宽档", () => {
		expect(layoutTierOf(Number.NaN)).toBe("wide");
		expect(layoutTierOf(Number.POSITIVE_INFINITY)).toBe("wide");
		expect(layoutTierOf(0)).toBe("wide");
		expect(layoutTierOf(-100)).toBe("wide");
	});
});

describe("窄档", () => {
	it("两栏都让给抽屉，不看意图", () => {
		for (const width of [640, 879]) {
			expect(resolveLayout(input({ viewportWidth: width })), String(width)).toEqual({
				tier: "narrow",
				viewportWidth: width,
				sidebarVisible: false,
				panelVisible: false,
				foldedPane: undefined,
			});
		}
	});
});

describe("宽档", () => {
	it("按意图平铺，两栏同时开时不做预算判断", () => {
		// 420 + 420 + 480 > 1100，宽档仍然两栏都摆：口径是平铺，不是折叠
		expect(
			resolveLayout(input({ viewportWidth: 1100, sidebarPref: 420, panelPref: 480 })).sidebarVisible,
		).toBe(true);
		expect(resolveLayout(input({ viewportWidth: 1100, sidebarPref: 420, panelPref: 480 })).panelVisible).toBe(
			true,
		);
		expect(resolveLayout(input({ viewportWidth: 1280 })).foldedPane).toBeUndefined();
	});

	it("意图位照旧生效", () => {
		expect(resolveLayout(input({ viewportWidth: 1280, panelIntent: false })).panelVisible).toBe(false);
		expect(resolveLayout(input({ viewportWidth: 1280, sidebarIntent: false })).sidebarVisible).toBe(false);
	});
});

describe("中档", () => {
	it("只有一栏想开（或都不开）时直接按意图摆，不触发折叠", () => {
		const onlySidebar = resolveLayout(input({ viewportWidth: 900, panelIntent: false }));
		expect(onlySidebar).toMatchObject({ sidebarVisible: true, panelVisible: false, foldedPane: undefined });

		const onlyPanel = resolveLayout(input({ viewportWidth: 900, sidebarIntent: false }));
		expect(onlyPanel).toMatchObject({ sidebarVisible: false, panelVisible: true, foldedPane: undefined });

		const none = resolveLayout(input({ viewportWidth: 900, sidebarIntent: false, panelIntent: false }));
		expect(none).toMatchObject({ sidebarVisible: false, panelVisible: false, foldedPane: undefined });
	});

	it("两栏都想开且刚好放得下时两栏都摆", () => {
		// 272 + 420 + 320 = 1012，预算线恰好够
		const layout = resolveLayout(input({ viewportWidth: 1012 }));
		expect(layout).toMatchObject({
			tier: "mid",
			sidebarVisible: true,
			panelVisible: true,
			foldedPane: undefined,
		});
	});

	it("两栏都想开且放不下时按优先级折起另一栏", () => {
		const keepSidebar = resolveLayout(input({ viewportWidth: 900, priorityPane: "sidebar" }));
		expect(keepSidebar).toMatchObject({
			sidebarVisible: true,
			panelVisible: false,
			foldedPane: "panel",
		});

		const keepPanel = resolveLayout(input({ viewportWidth: 900, priorityPane: "panel" }));
		expect(keepPanel).toMatchObject({
			sidebarVisible: false,
			panelVisible: true,
			foldedPane: "sidebar",
		});
	});

	it("折起不改意图：视口回到宽档后按意图恢复两栏", () => {
		const folded = resolveLayout(input({ viewportWidth: 900, priorityPane: "panel" }));
		expect(folded.panelVisible).toBe(true);
		expect(folded.sidebarVisible).toBe(false);

		// 同一个意图在宽档原样恢复，没有任何「折叠结果被写回意图」的痕迹
		const restored = resolveLayout(input({ viewportWidth: 1280, priorityPane: "panel" }));
		expect(restored).toMatchObject({ sidebarVisible: true, panelVisible: true, foldedPane: undefined });
	});

	it("用户点了另一栏的开关：优先级换边，预算跟着让位", () => {
		const before = resolveLayout(input({ viewportWidth: 900, priorityPane: "panel" }));
		expect(before.sidebarVisible).toBe(false);

		// 用户点开左栏 → 意图已经是 true，优先级换成 sidebar
		const after = resolveLayout(input({ viewportWidth: 900, priorityPane: "sidebar" }));
		expect(after).toMatchObject({ sidebarVisible: true, panelVisible: false, foldedPane: "panel" });
	});

	it("偏好宽超过预算时同样只保留优先级那一栏", () => {
		const layout = resolveLayout(
			input({ viewportWidth: 880, sidebarPref: 420, panelPref: 480, priorityPane: "panel" }),
		);
		expect(layout).toMatchObject({ sidebarVisible: false, panelVisible: true, foldedPane: "sidebar" });
	});
});

describe("非法输入回落", () => {
	it("视口宽读不懂时按宽档平铺", () => {
		for (const viewportWidth of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
			const layout = resolveLayout(input({ viewportWidth }));
			expect(layout, String(viewportWidth)).toMatchObject({
				tier: "wide",
				viewportWidth: 1100,
				sidebarVisible: true,
				panelVisible: true,
			});
		}
	});

	it("偏好宽读不懂时按 0 计，不会因此折起一栏", () => {
		for (const bad of [Number.NaN, -20, Number.NEGATIVE_INFINITY]) {
			const layout = resolveLayout(input({ viewportWidth: 900, sidebarPref: bad, panelPref: bad }));
			expect(layout, String(bad)).toMatchObject({
				sidebarVisible: true,
				panelVisible: true,
				foldedPane: undefined,
			});
		}
	});

	it("小数偏好宽按整像素参与预算", () => {
		const layout = resolveLayout(
			input({ viewportWidth: 1012, sidebarPref: 272.4, panelPref: 319.6, priorityPane: "sidebar" }),
		);
		expect(layout).toMatchObject({ sidebarVisible: true, panelVisible: true });
	});
});

describe("中档拖动上限", () => {
	const bounds = { min: 260, max: 480 };

	it("另一栏收起时让出正文最小宽", () => {
		expect(clampDragMax({ tier: "mid", viewportWidth: 900, otherWidth: 0, ...bounds })).toBe(
			900 - MAIN_MIN_WIDTH,
		);
	});

	it("另一栏也在时再扣掉它", () => {
		expect(clampDragMax({ tier: "mid", viewportWidth: 1099, otherWidth: 272, ...bounds })).toBe(
			1099 - MAIN_MIN_WIDTH - 272,
		);
	});

	it("预算不足时不把上限钳到下限以下", () => {
		expect(clampDragMax({ tier: "mid", viewportWidth: 881, otherWidth: 420, ...bounds })).toBe(bounds.min);
	});

	it("宽档与窄档原样返回上限", () => {
		expect(clampDragMax({ tier: "wide", viewportWidth: 1280, otherWidth: 272, ...bounds })).toBe(bounds.max);
		expect(clampDragMax({ tier: "narrow", viewportWidth: 640, otherWidth: 0, ...bounds })).toBe(bounds.max);
	});

	it("钳制后的上限不会让松手时超预算", () => {
		const other = 272;
		const max = clampDragMax({ tier: "mid", viewportWidth: 1012, otherWidth: other, ...bounds });
		expect(other + MAIN_MIN_WIDTH + max).toBeLessThanOrEqual(1012);
	});
});
