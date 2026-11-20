/**
 * 布局档位与中档预算折叠。
 *
 * 这里是三档语义的唯一实现（口径见 `docs/layout.md` §2）：纯函数，不碰 DOM、不读窗口，
 * 输入是「视口宽 + 两个偏好宽 + 两个意图位 + 优先级」，输出是「哪一栏此刻该占列」。
 *
 * 意图与结果分开：意图位记录用户想不想开，折叠只改结果，不回写意图。窗口拉宽之后按意图
 * 自动恢复，靠的就是这一点。
 *
 * 预算折叠不挤压列宽：夹紧能吸收的缺口有限，且会让拖动出的宽度与看到的宽度脱耦
 * （`docs/layout.md` §5.1、§5.2）。空间不够时折起一栏，另一栏保持它的偏好宽。
 */

/** 窄档阈值（CSS px）：小于它是窄档，两栏都进抽屉。 */
export const LAYOUT_BREAKPOINT_PX = 880;

/**
 * 宽档阈值（CSS px）：大于等于它是宽档，两栏按意图平铺，不做预算判断。
 *
 * 1240 是「两栏都拉到舒服的宽度还剩得下正文」的那条线：右栏缺省 520、左栏缺省 272、
 * 正文最小可用宽 420，三者相加 1212，留一点余量。
 */
export const LAYOUT_WIDE_BREAKPOINT_PX = 1240;

/**
 * 正文最小可用宽（CSS px）。
 *
 * 与 `base.css` 的 `--main-min` 同一个数：样式表里那份是这个值的渲染兜底，改一处要改两处
 * （`docs/layout.md` §2「数值口径」）。
 */
export const MAIN_MIN_WIDTH = 420;

/** 档位。 */
export type LayoutTier = "narrow" | "mid" | "wide";

/** 边栏标识。 */
export type LayoutPane = "sidebar" | "panel";

/** 折叠判定需要的输入。 */
export interface LayoutInput {
	/** 视口宽（CSS px）；`NaN`、`Infinity`、`<= 0` 按宽档处理 */
	readonly viewportWidth: number;
	/** 侧栏偏好宽（CSS px），非法值按 0 计 */
	readonly sidebarPref: number;
	/** 右栏偏好宽（CSS px），非法值按 0 计 */
	readonly panelPref: number;
	/** 用户想不想开左栏 */
	readonly sidebarIntent: boolean;
	/** 用户想不想开右栏 */
	readonly panelIntent: boolean;
	/**
	 * 右栏是不是固定在三栏里（图钉）。
	 *
	 * 取消了固定时它不参与列预算：定档照旧看视口宽，但右栏在 Grid 里恒为 `false`，展开
	 * 时走窄档那一层全高抽屉（口径见 `docs/layout.md` §2「图钉」）。
	 */
	readonly panelPinned: boolean;
	/** 两栏都想开而预算不够时保留哪一栏：最近一次被用户主动打开或调过宽的那一栏 */
	readonly priorityPane: LayoutPane;
}

/** 一次布局判定的结果。 */
export interface LayoutResolution {
	/** 命中的档位 */
	readonly tier: LayoutTier;
	/** 判定用的视口宽（已修正非法值） */
	readonly viewportWidth: number;
	/** 左栏此刻是否占列；窄档恒为 `false`，由抽屉接管 */
	readonly sidebarVisible: boolean;
	/** 右栏此刻是否占列；窄档恒为 `false`，由抽屉接管 */
	readonly panelVisible: boolean;
	/** 被预算折起的那一栏；没有折叠时为 `undefined` */
	readonly foldedPane: LayoutPane | undefined;
}

/**
 * 把任意输入收成一个可用的正宽度。
 *
 * `NaN`、`Infinity`、负数与 0 都按 0 计：宽度读不懂时宁可当这一栏不占地方，也不要凭空
 * 撑开一列；界面按整像素布局，通过校验的值先四舍五入。
 */
function usableWidth(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * 把视口宽收成可用的值。
 *
 * 读不懂时回落到宽档阈值（1100）：平铺是按意图排布，不会替用户折起一栏。宁可多占地方，
 * 也不要在一个不知道多大的窗口里让某一栏凭空消失。
 */
function usableViewport(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.round(value) : LAYOUT_WIDE_BREAKPOINT_PX;
}

/** 视口宽属于哪一档。 */
export function layoutTierOf(viewportWidth: number): LayoutTier {
	const viewport = usableViewport(viewportWidth);
	if (viewport < LAYOUT_BREAKPOINT_PX) {
		return "narrow";
	}
	return viewport >= LAYOUT_WIDE_BREAKPOINT_PX ? "wide" : "mid";
}

/**
 * 算出这一刻哪一栏占列。
 *
 * 判定顺序：窄档两栏都让给抽屉 → 未固定时右栏不参与（它是一层浮层，不占列）→ 宽档只看
 * 意图 → 中档先看意图，再在两栏都想开时核对预算（`侧栏宽 + 正文最小宽 + 右栏宽 <=
 * 视口宽`），超了就把优先级低的那一栏折起。
 *
 * 图钉只在宽档与中档有意义：窄档本来就用抽屉，`pinned` 不改变结果。
 */
export function resolveLayout(input: LayoutInput): LayoutResolution {
	const viewportWidth = usableViewport(input.viewportWidth);
	const tier = layoutTierOf(viewportWidth);
	/** 右栏此刻参不参与平铺：先看不固定，再看意图 */
	const panelIntent = input.panelIntent && input.panelPinned;

	if (tier === "narrow") {
		return { tier, viewportWidth, sidebarVisible: false, panelVisible: false, foldedPane: undefined };
	}

	if (tier === "wide") {
		return {
			tier,
			viewportWidth,
			sidebarVisible: input.sidebarIntent,
			panelVisible: panelIntent,
			foldedPane: undefined,
		};
	}

	// 中档：只有一栏想开时没有预算之争，直接按意图摆
	if (!input.sidebarIntent || !panelIntent) {
		return {
			tier,
			viewportWidth,
			sidebarVisible: input.sidebarIntent,
			panelVisible: panelIntent,
			foldedPane: undefined,
		};
	}

	const budget = usableWidth(input.sidebarPref) + MAIN_MIN_WIDTH + usableWidth(input.panelPref);
	if (budget <= viewportWidth) {
		return { tier, viewportWidth, sidebarVisible: true, panelVisible: true, foldedPane: undefined };
	}

	const keepSidebar = input.priorityPane === "sidebar";
	return {
		tier,
		viewportWidth,
		sidebarVisible: keepSidebar,
		panelVisible: !keepSidebar,
		foldedPane: keepSidebar ? "panel" : "sidebar",
	};
}

/** 拖动上限的输入。 */
export interface DragMaxInput {
	/** 当前档位；只有中档钳制 */
	readonly tier: LayoutTier;
	/** 判定用的视口宽（CSS px） */
	readonly viewportWidth: number;
	/** 另一栏此刻占的宽度；它被折起或收起时传 0 */
	readonly otherWidth: number;
	/** 这一栏自己的下限，保证返回的宽度不会被钳到下限以下 */
	readonly min: number;
	/** 这一栏自己的上限 */
	readonly max: number;
}

/**
 * 中档拖动的实时上限。
 *
 * 预算里先扣掉正文最小宽与另一栏的宽度，剩下的才是这一栏能拖到的最大宽度；松手时因此
 * 不会立刻触发折叠，也就不会出现「拖完就被折起」的观感。宽档按意图平铺、窄档不渲染分隔条，
 * 两者都原样返回 `max`。
 */
export function clampDragMax(input: DragMaxInput): number {
	if (input.tier !== "mid") {
		return input.max;
	}
	const budget = Math.floor(
		usableViewport(input.viewportWidth) - MAIN_MIN_WIDTH - usableWidth(input.otherWidth),
	);
	return Math.max(input.min, Math.min(input.max, budget));
}
