/**
 * 档位判定、右栏让位、中档预算折叠与宽展开。
 *
 * 纯函数：只吃视口宽、偏好宽、意图位与宽展开位，不读窗口、不碰 DOM。边界视口覆盖
 * 三档两界（`879/880`、`1215/1216`）、右栏让位表与「刚好放得下」的预算线。
 */
import { LAYOUT_PX } from "@facet/ui";
import { describe, expect, it } from "vitest";
import {
	clampDragMax,
	fitPanelWidth,
	LAYOUT_WIDE_BREAKPOINT_PX,
	type LayoutInput,
	layoutTierOf,
	MAIN_MIN_WIDTH,
	MAIN_PREFERRED_WIDTH,
	paneMaxWidth,
	resolveLayout,
	sameLayout,
} from "./resolve-layout.ts";

/** 缺省偏好宽：与 `panel-state.ts`、`sidebar-state.ts` 的缺省值一致。 */
const SIDEBAR_PREF = 272;
const PANEL_PREF = 420;
/** 右栏的下限：窗口怎么窄，它也不会比这更窄。 */
const PANEL_MIN = LAYOUT_PX.panel.minWidth;

/** 两栏都摆得下的那条线：左栏 272 + 正文地板 520 + 右栏下限 300。 */
const DEFAULT_BUDGET = SIDEBAR_PREF + MAIN_MIN_WIDTH + PANEL_MIN;

function input(patch: Partial<LayoutInput> = {}): LayoutInput {
	return {
		viewportWidth: 1400,
		sidebarPref: SIDEBAR_PREF,
		panelPref: PANEL_PREF,
		panelPrefViewport: undefined,
		sidebarIntent: true,
		panelIntent: true,
		isPanelExpanded: false,
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

	it("宽档一定装得下两栏与正文地板", () => {
		// 272（左栏）+ 520（正文地板）+ 300（右栏下限）
		expect(DEFAULT_BUDGET).toBe(1092);
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
	it("只有左栏让给抽屉，右栏照旧占列", () => {
		for (const width of [640, 879]) {
			expect(resolveLayout(input({ viewportWidth: width })), String(width)).toEqual({
				tier: "narrow",
				viewportWidth: width,
				sidebarVisible: false,
				panelVisible: true,
				foldedPane: undefined,
				expanded: false,
			});
			// 窄档忽略宽展开：那一列本来就已经被挤到接近视口宽
			expect(resolveLayout(input({ viewportWidth: width, isPanelExpanded: true })).expanded).toBe(false);
		}
	});

	it("右栏收起时窄档也不给正文留一列空的", () => {
		expect(resolveLayout(input({ viewportWidth: 640, panelIntent: false })).panelVisible).toBe(false);
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

	it("两栏都想开且右栏让到下限还放得下时两栏都摆", () => {
		// 272 + 520 + 300 = 1092：右栏已经到底，正文还够
		const layout = resolveLayout(input({ viewportWidth: DEFAULT_BUDGET }));
		expect(layout).toMatchObject({
			tier: "mid",
			sidebarVisible: true,
			panelVisible: true,
			foldedPane: undefined,
		});
	});

	it("连右栏的下限都放不下时折起左栏：右栏永远不折", () => {
		const layout = resolveLayout(input({ viewportWidth: DEFAULT_BUDGET - 1 }));
		expect(layout).toMatchObject({
			sidebarVisible: false,
			panelVisible: true,
			foldedPane: "sidebar",
		});
	});

	it("折起不改意图：视口长回去之后按意图恢复两栏", () => {
		const folded = resolveLayout(input({ viewportWidth: 1000 }));
		expect(folded.sidebarVisible).toBe(false);

		// 同一个意图在宽档原样恢复，没有任何「折叠结果被写回意图」的痕迹
		const restored = resolveLayout(input({ viewportWidth: 1200 }));
		expect(restored).toMatchObject({ sidebarVisible: true, panelVisible: true, foldedPane: undefined });
	});

	it("偏好宽拉满时也只折左栏", () => {
		const layout = resolveLayout(input({ viewportWidth: 880, sidebarPref: 420, panelPref: 840 }));
		expect(layout).toMatchObject({ sidebarVisible: false, panelVisible: true, foldedPane: "sidebar" });
	});
});

describe("宽展开", () => {
	it("右栏最大化：正文那一列被盖住，左栏照旧按意图摆", () => {
		const layout = resolveLayout(input({ viewportWidth: 1000, isPanelExpanded: true }));
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

	it("预算拦不住它：一展开就没有折叠这回事", () => {
		const folded = resolveLayout(input({ viewportWidth: 900, sidebarPref: 420, panelPref: 840 }));
		expect(folded.foldedPane).toBe("sidebar");

		const expanded = resolveLayout(
			input({ viewportWidth: 900, sidebarPref: 420, panelPref: 840, isPanelExpanded: true }),
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
			input({ viewportWidth: DEFAULT_BUDGET, sidebarPref: 272.4, panelPref: 419.6 }),
		);
		expect(layout).toMatchObject({ sidebarVisible: true, panelVisible: true });
	});
});

describe("右栏让位：先窄右栏，再窄正文", () => {
	/** 只问右栏实占宽。 */
	function widthAt(viewportWidth: number, patch: Partial<Parameters<typeof fitPanelWidth>[0]> = {}): number {
		return fitPanelWidth({
			viewportWidth,
			sidebarWidth: SIDEBAR_PREF,
			panelPref: PANEL_PREF,
			panelPrefViewport: undefined,
			...patch,
		});
	}

	it("没手动定过宽：右栏只拿「正文阅读上限 + 两侧留白」之后剩下的", () => {
		// 840（正文阅读上限）+ 52（导航轨留白）× 2
		expect(MAIN_PREFERRED_WIDTH).toBe(944);
		// 视口 − 左栏 272 − 基准 944，上限是偏好宽 420
		expect(widthAt(1600)).toBe(384);
		expect(widthAt(1516)).toBe(PANEL_MIN);
		expect(widthAt(1400)).toBe(PANEL_MIN);
		expect(widthAt(1092)).toBe(PANEL_MIN);
	});

	it("右栏到底之后正文才跟着缩，右栏不再变", () => {
		for (const viewportWidth of [1092, 1000, 880, 640]) {
			expect(widthAt(viewportWidth), String(viewportWidth)).toBe(PANEL_MIN);
		}
	});

	it("手动拖过的宽度先照摆，窗口每少一像素右栏还回一像素", () => {
		const dragged = { panelPref: 600, panelPrefViewport: 1400 };
		expect(widthAt(1400, dragged)).toBe(600);
		expect(widthAt(1350, dragged)).toBe(550);
		expect(widthAt(1200, dragged)).toBe(400);
		expect(widthAt(1100, dragged)).toBe(PANEL_MIN);
		// 再窄也不往下压右栏
		expect(widthAt(900, dragged)).toBe(PANEL_MIN);
	});

	it("窗口比定宽时更宽：按偏好宽长回去，不越过它", () => {
		const dragged = { panelPref: 600, panelPrefViewport: 1400 };
		expect(widthAt(1600, dragged)).toBe(600);
		expect(widthAt(2560, dragged)).toBe(600);
	});

	it("拖到头也不能把正文压到地板以下", () => {
		// 900 − 左栏 420 − 正文地板 520 = −40，低于下限
		expect(widthAt(900, { sidebarWidth: 420, panelPref: 840, panelPrefViewport: 1600 })).toBe(PANEL_MIN);
		// 1400 − 272 − 520 = 608：拖到 700 也只给 608
		expect(widthAt(1400, { panelPref: 700, panelPrefViewport: 1400 })).toBe(608);
	});

	it("读不懂的输入按 0 计，结果仍然落在下限与上限之间", () => {
		// 视口读不懂时回落到宽档阈值 1216，那里右栏照样让到下限
		expect(widthAt(Number.NaN)).toBe(PANEL_MIN);
		expect(widthAt(1400, { sidebarWidth: Number.NaN, panelPref: Number.NaN })).toBe(PANEL_MIN);
		expect(widthAt(1400, { panelPrefViewport: Number.NaN })).toBe(PANEL_MIN);
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
		panelPrefViewport: undefined,
		sidebarIntent: true,
		panelIntent: true,
		isPanelExpanded: false,
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
