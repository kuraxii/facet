/**
 * 布局档位与中档预算折叠。
 *
 * 这里是三档语义与宽展开的唯一实现（口径见 `docs/layout.md` §2）：纯函数，不碰 DOM、不读
 * 窗口，输入是「视口宽 + 两个偏好宽 + 两个意图位 + 宽展开位 + 优先级」，输出是「哪一栏此刻
 * 该占列、是不是按宽展开排的」。
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
 * 宽档阈值（CSS px）：大于等于它是宽档，三栏按意图平铺，不做预算判断。
 *
 * 1112 是三栏缺省值刚好放得下的那条线：左栏缺省 272、正文最小可用宽 420、右栏缺省 420，
 * 取整到 1120 留一点余量。宽档即使被两栏一起拉满也挤不坏正文——右栏的实占宽另有
 * `paneMaxWidth()` 收着（见约束 2）。
 */
export const LAYOUT_WIDE_BREAKPOINT_PX = 1120;

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
	 * 右栏是不是正处在 `⤢` 宽展开里。
	 *
	 * 它是临时视图状态，不落盘：命中时右栏**吃掉正文那一列**（最大化就是盖住主栏），左栏
	 * 照旧按意图摆——这个位不动两侧的意图位与偏好宽（口径见 `docs/layout.md` §2「宽展开」）。
	 */
	readonly isPanelExpanded: boolean;
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
	/** 这一帧是不是按宽展开排的（窄档与右栏收起时恒为 `false`） */
	readonly expanded: boolean;
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
 * 判定顺序：窄档两栏都让给抽屉 → 宽展开（右栏盖住正文那一列，左栏照旧）→ 宽档只看意图 →
 * 中档先看意图，再在两栏都想开时核对预算（`侧栏宽 + 正文最小宽 + 右栏宽 <= 视口宽`），超了
 * 就把优先级低的那一栏折起。
 *
 * 宽展开只在右栏想开时生效：右栏都收起了，也就没有「展开它」这回事，那一帧照常按意图平铺。
 * 窄档忽略它——那里本来就是近满宽的抽屉。
 */
export function resolveLayout(input: LayoutInput): LayoutResolution {
	const viewportWidth = usableViewport(input.viewportWidth);
	const tier = layoutTierOf(viewportWidth);
	const panelIntent = input.panelIntent;

	if (tier === "narrow") {
		return {
			tier,
			viewportWidth,
			sidebarVisible: false,
			panelVisible: false,
			foldedPane: undefined,
			expanded: false,
		};
	}

	/*
	 * 宽展开：右栏最大化——盖住正文那一列，预算不做判断。
	 *
	 * 左栏照旧按意图摆（它不在被盖住的那一列里），意图位一个字都不改：退出展开时按原来的
	 * 偏好宽与意图原样恢复。
	 */
	if (input.isPanelExpanded && panelIntent) {
		return {
			tier,
			viewportWidth,
			sidebarVisible: input.sidebarIntent,
			panelVisible: true,
			foldedPane: undefined,
			expanded: true,
		};
	}

	if (tier === "wide") {
		return {
			tier,
			viewportWidth,
			sidebarVisible: input.sidebarIntent,
			panelVisible: panelIntent,
			foldedPane: undefined,
			expanded: false,
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
			expanded: false,
		};
	}

	const budget = usableWidth(input.sidebarPref) + MAIN_MIN_WIDTH + usableWidth(input.panelPref);
	if (budget <= viewportWidth) {
		return {
			tier,
			viewportWidth,
			sidebarVisible: true,
			panelVisible: true,
			foldedPane: undefined,
			expanded: false,
		};
	}

	const keepSidebar = input.priorityPane === "sidebar";
	return {
		tier,
		viewportWidth,
		sidebarVisible: keepSidebar,
		panelVisible: !keepSidebar,
		foldedPane: keepSidebar ? "panel" : "sidebar",
		expanded: false,
	};
}

/** 「给正文留够地方」这个约束的输入。 */
export interface PaneBudgetInput {
	/** 判定用的视口宽（CSS px） */
	readonly viewportWidth: number;
	/** 另一栏此刻占的宽度；它被折起或收起时传 0 */
	readonly otherWidth: number;
	/** 这一栏自己的下限，保证返回的宽度不会被钳到下限以下 */
	readonly min: number;
}

/**
 * 一栏此刻最多能占多宽。
 *
 * 右栏与左栏都没有固定的宽度上限：上限就是「视口宽扣掉正文最小可用宽与另一栏之后剩下
 * 的部分」。窗口越宽它越宽，窗口一缩它跟着收——正文因此永远不小于 `--main-min`，不需要
 * 给右栏再钉一个像素数（口径见 `docs/layout.md` §3 约束 2）。
 *
 * 预算不足时返回下限：宁可让正文窄一点，也不把这一栏钳到它自己的下限以下。
 */
export function paneMaxWidth(input: PaneBudgetInput): number {
	const budget = Math.floor(
		usableViewport(input.viewportWidth) - MAIN_MIN_WIDTH - usableWidth(input.otherWidth),
	);
	return Math.max(input.min, budget);
}

/** 拖动上限的输入。 */
export interface DragMaxInput extends PaneBudgetInput {
	/**
	 * 这一栏自己的固定上限；不给就是不设上限。
	 *
	 * 左栏有（`SIDEBAR_MAX_WIDTH`），右栏没有——它的上限完全由 {@link paneMaxWidth} 现算。
	 */
	readonly max?: number;
}

/**
 * 分隔条拖动的实时上限。
 *
 * 三档一体：扣掉正文最小宽与另一栏之后剩下的宽度就是能拖到的最大值。拖动过程中只钳上限、
 * 不触发折叠，松手提交的宽度一定是折完还放得下的宽度（`docs/layout.md` §5.2）。
 */
export function clampDragMax(input: DragMaxInput): number {
	const ceiling = input.max ?? Number.POSITIVE_INFINITY;
	return Math.min(ceiling, paneMaxWidth(input));
}
