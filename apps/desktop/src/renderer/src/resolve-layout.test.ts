/**
 * 档位判定、中档预算折叠与宽展开。
 *
 * 纯函数：只吃视口宽、偏好宽、意图位、宽展开位与优先级，不读窗口、不碰 DOM。边界视口覆盖
 * 三档两界（`879/880`、`1119/1120`）与「刚好放得下」的预算线。
 */
import { describe, expect, it } from "vitest";
import {
	clampDragMax,
	LAYOUT_WIDE_BREAKPOINT_PX,
	type LayoutInput,
	layoutTierOf,
	MAIN_MIN_WIDTH,
	paneMaxWidth,
	resolveLayout,
	sameLayout,
} from "./resolve-layout.ts";

/** 缺省偏好宽：与 `panel-state.ts`、`sidebar-state.ts` 的缺省值一致。 */
const SIDEBAR_PREF = 272;
const PANEL_PREF = 420;

/** 「两栏都按缺省宽摆开还放得下正文」的那条线：272 + 420 + 420。 */
const DEFAULT_BUDGET = SIDEBAR_PREF + MAIN_MIN_WIDTH + PANEL_PREF;

function input(patch: Partial<LayoutInput> = {}): LayoutInput {
	return {
		viewportWidth: 1400,
		sidebarPref: SIDEBAR_PREF,
		panelPref: PANEL_PREF,
		sidebarIntent: true,
		panelIntent: true,
		isPanelExpanded: false,
		priorityPane: "sidebar",
		...patch,
	};
}

describe("档位判定", () => {
	it("小于 880 是窄档", () => {
		expect(layoutTierOf(640)).toBe("narrow");
		expect(layoutTierOf(879)).toBe("narrow");
	});

	it("880 到 1215 是中档", () => {
		for (const width of [880, 881, 899, 900, 1012, 1099, 1112, 1215]) {
			expect(layoutTierOf(width), String(width)).toBe("mid");
		}
	});

	it("1216 起是宽档", () => {
		expect(layoutTierOf(1216)).toBe("wide");
		expect(layoutTierOf(1400)).toBe("wide");
	});

	it("宽档阈值就是三栏缺省宽刚好放得下的那条线", () => {
		// 272（左栏）+ 520（正文最小）+ 420（右栏）
		expect(DEFAULT_BUDGET).toBe(1212);
		expect(LAYOUT_WIDE_BREAKPOINT_PX).toBeGreaterThanOrEqual(DEFAULT_BUDGET);
	});

	it("读不懂的视口宽回落到宽档", () => {
		expect(layoutTierOf(Number.NaN)).toBe("wide");
		expect(layoutTierOf(Number.POSITIVE_INFINITY)).toBe("wide");
		expect(layoutTierOf(0)).toBe("wide");
		expect(layoutTierOf(-100)).toBe("wide");
	});
});

describe("窄档", () => {
	it("两栏都让给抽屉，不看意图与宽展开", () => {
		for (const width of [640, 879]) {
			expect(resolveLayout(input({ viewportWidth: width })), String(width)).toEqual({
				tier: "narrow",
				viewportWidth: width,
				sidebarVisible: false,
				panelVisible: false,
				foldedPane: undefined,
				expanded: false,
			});
			// 窄档忽略宽展开：那里本来就是近满宽的抽屉
			expect(resolveLayout(input({ viewportWidth: width, isPanelExpanded: true })).expanded).toBe(false);
		}
	});
});

describe("宽档", () => {
	it("按意图平铺，两栏同时开时不做预算判断", () => {
		// 420 + 420 + 840 > 1216，宽档仍然两栏都摆：口径是平铺，不是折叠
		const layout = resolveLayout(input({ viewportWidth: 1216, sidebarPref: 420, panelPref: 840 }));
		expect(layout.sidebarVisible).toBe(true);
		expect(layout.panelVisible).toBe(true);
		expect(resolveLayout(input({ viewportWidth: 1400 })).foldedPane).toBeUndefined();
	});

	it("意图位照旧生效", () => {
		expect(resolveLayout(input({ viewportWidth: 1400, panelIntent: false })).panelVisible).toBe(false);
		expect(resolveLayout(input({ viewportWidth: 1400, sidebarIntent: false })).sidebarVisible).toBe(false);
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
		// 272 + 420 + 420 = 1112，预算线恰好够
		const layout = resolveLayout(input({ viewportWidth: DEFAULT_BUDGET }));
		expect(layout).toMatchObject({
			tier: "mid",
			sidebarVisible: true,
			panelVisible: true,
			foldedPane: undefined,
		});
	});

	it("两栏都想开且放不下时按优先级折起另一栏", () => {
		const keepSidebar = resolveLayout(input({ viewportWidth: 1000, priorityPane: "sidebar" }));
		expect(keepSidebar).toMatchObject({
			sidebarVisible: true,
			panelVisible: false,
			foldedPane: "panel",
		});

		const keepPanel = resolveLayout(input({ viewportWidth: 1000, priorityPane: "panel" }));
		expect(keepPanel).toMatchObject({
			sidebarVisible: false,
			panelVisible: true,
			foldedPane: "sidebar",
		});
	});

	it("折起不改意图：视口回到宽档后按意图恢复两栏", () => {
		const folded = resolveLayout(input({ viewportWidth: 1000, priorityPane: "panel" }));
		expect(folded.panelVisible).toBe(true);
		expect(folded.sidebarVisible).toBe(false);

		// 同一个意图在宽档原样恢复，没有任何「折叠结果被写回意图」的痕迹
		const restored = resolveLayout(input({ viewportWidth: 1400, priorityPane: "panel" }));
		expect(restored).toMatchObject({ sidebarVisible: true, panelVisible: true, foldedPane: undefined });
	});

	it("用户点了另一栏的开关：优先级换边，预算跟着让位", () => {
		const before = resolveLayout(input({ viewportWidth: 1000, priorityPane: "panel" }));
		expect(before.sidebarVisible).toBe(false);

		// 用户点开左栏 → 意图已经是 true，优先级换成 sidebar
		const after = resolveLayout(input({ viewportWidth: 1000, priorityPane: "sidebar" }));
		expect(after).toMatchObject({ sidebarVisible: true, panelVisible: false, foldedPane: "panel" });
	});

	it("偏好宽超过预算时同样只保留优先级那一栏", () => {
		const layout = resolveLayout(
			input({ viewportWidth: 880, sidebarPref: 420, panelPref: 840, priorityPane: "panel" }),
		);
		expect(layout).toMatchObject({ sidebarVisible: false, panelVisible: true, foldedPane: "sidebar" });
	});
});

describe("宽展开", () => {
	it("右栏最大化：正文那一列被盖住，左栏照旧按意图摆", () => {
		const layout = resolveLayout(
			input({ viewportWidth: 1000, isPanelExpanded: true, priorityPane: "sidebar" }),
		);
		expect(layout).toEqual({
			tier: "mid",
			viewportWidth: 1000,
			sidebarVisible: true,
			panelVisible: true,
			foldedPane: undefined,
			expanded: true,
		});
	});

	it("左栏收起时也不替它打开：展开只管右栏那一列", () => {
		const layout = resolveLayout(input({ viewportWidth: 1600, isPanelExpanded: true, sidebarIntent: false }));
		expect(layout).toMatchObject({ sidebarVisible: false, panelVisible: true, expanded: true });
	});

	it("宽档同样展开", () => {
		const layout = resolveLayout(input({ viewportWidth: 1600, isPanelExpanded: true }));
		expect(layout).toMatchObject({ tier: "wide", sidebarVisible: true, panelVisible: true, expanded: true });
	});

	it("优先级与预算都拦不住它：一展开就没有折叠这回事", () => {
		const folded = resolveLayout(
			input({ viewportWidth: 900, sidebarPref: 420, panelPref: 840, priorityPane: "sidebar" }),
		);
		expect(folded.foldedPane).toBe("panel");

		const expanded = resolveLayout(
			input({
				viewportWidth: 900,
				sidebarPref: 420,
				panelPref: 840,
				isPanelExpanded: true,
				priorityPane: "sidebar",
			}),
		);
		expect(expanded).toMatchObject({
			sidebarVisible: true,
			panelVisible: true,
			foldedPane: undefined,
			expanded: true,
		});
	});

	it("右栏自己收起时宽展开不生效（没有可展开的东西）", () => {
		const layout = resolveLayout(input({ viewportWidth: 1600, panelIntent: false, isPanelExpanded: true }));
		expect(layout).toMatchObject({ sidebarVisible: true, panelVisible: false, expanded: false });
	});

	it("两侧的意图位都不被改写：退出展开后按原样恢复", () => {
		// 同一个输入，只切宽展开位——意图位在两种结果里都是「想开」
		const expanded = resolveLayout(input({ viewportWidth: 1600, isPanelExpanded: true }));
		const restored = resolveLayout(input({ viewportWidth: 1600, isPanelExpanded: false }));
		expect(expanded).toMatchObject({ sidebarVisible: true, panelVisible: true, expanded: true });
		expect(restored).toMatchObject({ sidebarVisible: true, panelVisible: true, expanded: false });
	});

	it("窄档不认它：那里是抽屉", () => {
		expect(resolveLayout(input({ viewportWidth: 640, isPanelExpanded: true })).expanded).toBe(false);
	});
});

describe("非法输入回落", () => {
	it("视口宽读不懂时按宽档平铺", () => {
		for (const viewportWidth of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
			const layout = resolveLayout(input({ viewportWidth }));
			expect(layout, String(viewportWidth)).toMatchObject({
				tier: "wide",
				viewportWidth: LAYOUT_WIDE_BREAKPOINT_PX,
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
			input({ viewportWidth: DEFAULT_BUDGET, sidebarPref: 272.4, panelPref: 419.6, priorityPane: "sidebar" }),
		);
		expect(layout).toMatchObject({ sidebarVisible: true, panelVisible: true });
	});
});

describe("拖动上限：给正文留出最小可用宽", () => {
	/** 右栏：没有固定上限 */
	const panel = { min: 300 };
	/** 左栏：自己有固定的上限 */
	const sidebar = { min: 260, max: 420 };

	it("另一栏收起时让出正文最小宽", () => {
		expect(clampDragMax({ viewportWidth: 900, otherWidth: 0, ...panel })).toBe(900 - MAIN_MIN_WIDTH);
	});

	it("另一栏也在时再扣掉它", () => {
		expect(clampDragMax({ viewportWidth: 1099, otherWidth: 272, ...panel })).toBe(
			1099 - MAIN_MIN_WIDTH - 272,
		);
	});

	it("预算不足时不把上限钳到下限以下", () => {
		expect(clampDragMax({ viewportWidth: 881, otherWidth: 420, ...panel })).toBe(panel.min);
	});

	it("三档一体：宽档也按正文的约束钳住，不再原样返回", () => {
		// 1400 的视口里，左栏 272 之后右栏最多 708，正文仍是 420
		expect(clampDragMax({ viewportWidth: 1400, otherWidth: 272, ...panel })).toBe(
			1400 - MAIN_MIN_WIDTH - 272,
		);
		expect(clampDragMax({ viewportWidth: 2560, otherWidth: 272, ...panel })).toBe(
			2560 - MAIN_MIN_WIDTH - 272,
		);
	});

	it("有固定上限的一栏再与正文的约束取小", () => {
		// 左栏：宽视口下被它自己的 420 收住
		expect(clampDragMax({ viewportWidth: 2560, otherWidth: 0, ...sidebar })).toBe(420);
		// 窄一点的视口里被正文的约束收住（900 − 520 = 380，比左栏自己的 420 上限更紧）
		expect(clampDragMax({ viewportWidth: 900, otherWidth: 0, ...sidebar })).toBe(380);
		// 再窄就压到这一栏自己的下限，不再跟着正文的预算往下走
		expect(clampDragMax({ viewportWidth: 700, otherWidth: 0, ...sidebar })).toBe(sidebar.min);
	});

	it("钳制后的上限不会让松手时超预算", () => {
		const other = 272;
		const max = clampDragMax({ viewportWidth: DEFAULT_BUDGET, otherWidth: other, ...panel });
		expect(other + MAIN_MIN_WIDTH + max).toBeLessThanOrEqual(DEFAULT_BUDGET);
	});
});

describe("右栏实占宽", () => {
	it("偏好宽比预算宽时按预算走，偏好宽本身不变", () => {
		// 1400 − 正文最小 520 − 左栏 272 = 608
		const budget = paneMaxWidth({ viewportWidth: 1400, otherWidth: 272, min: 300 });
		expect(budget).toBe(608);
		expect(Math.min(2400, budget)).toBe(608);
	});

	it("窗口变大之后按偏好宽长回去", () => {
		// 偏好宽 2400：2560 的视口仍然放不下，3200 才完全容得下
		const narrow = paneMaxWidth({ viewportWidth: 2560, otherWidth: 272, min: 300 });
		expect(Math.min(2400, narrow)).toBe(2560 - MAIN_MIN_WIDTH - 272);
		const wide = paneMaxWidth({ viewportWidth: 3200, otherWidth: 272, min: 300 });
		expect(Math.min(2400, wide)).toBe(2400);
	});

	it("正文最小宽是这条上限的全部来源，没有别的固定上限", () => {
		for (const viewportWidth of [880, 1120, 1920, 3840]) {
			const max = paneMaxWidth({ viewportWidth, otherWidth: 0, min: 300 });
			expect(max, String(viewportWidth)).toBe(Math.max(300, viewportWidth - MAIN_MIN_WIDTH));
		}
	});

	it("预算不足时回落到下限", () => {
		expect(paneMaxWidth({ viewportWidth: 700, otherWidth: 420, min: 300 })).toBe(300);
	});
});

describe("两份布局结果是否等价", () => {
	const layout = resolveLayout({
		viewportWidth: 1400,
		sidebarPref: 272,
		panelPref: 420,
		sidebarIntent: true,
		panelIntent: true,
		isPanelExpanded: false,
		priorityPane: "sidebar",
	});

	it("同一份输入算出来的结果等价", () => {
		expect(sameLayout(layout, { ...layout })).toBe(true);
	});

	it("任一字段变了就不等价", () => {
		expect(sameLayout(layout, { ...layout, tier: layout.tier === "wide" ? "mid" : "wide" })).toBe(false);
		expect(sameLayout(layout, { ...layout, viewportWidth: layout.viewportWidth + 1 })).toBe(false);
		expect(sameLayout(layout, { ...layout, panelVisible: !layout.panelVisible })).toBe(false);
		expect(sameLayout(layout, { ...layout, expanded: !layout.expanded })).toBe(false);
	});
});
