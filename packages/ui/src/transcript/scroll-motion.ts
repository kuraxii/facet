/**
 * 滚动动效的数学模型。
 *
 * 面板里有两种「程序化滚动」：点导航竖轨跳到某一行、点「回到底部」。它们都可能一次移动上千
 * 像素，而落点附近的行要等挂载、渲染、测量之后才有真高度，所以不能交给浏览器的
 * `behavior: "smooth"`——它中途改不了目标，也看不出哪些行还没量过，表现就是「一边加载一边抖」。
 *
 * 距离分三档处理：
 * - 位移 ≤ `MOTION_EPSILON`：直接落位，没有动画；
 * - 短距离（不到 1.5 个视口）：一次 `easeOutCubic`，180ms 到位；
 * - 长距离：拆三段。**起步** 50ms 朝目标方向挪 `DEPART_DISTANCE`，给一点物理感又不至于把
 *   下一屏的行全挂上；**瞬移**：起步结束的那一帧直接跳到落点来向侧 `APPROACH_DISTANCE` 处，
 *   这一段没有视觉过程，挂载与测量就发生在这里；**落地缓入** 160ms，每帧重读目标坐标，
 *   把瞬移后头一两帧测量出来的估算残差（几十像素量级）吸收在减速段里。
 *
 * 这里只有几何与时间，不碰 DOM、不碰 React：给定起点、目标、视口高度与可滚上限，返回某一
 * 时刻该写什么 `scrollTop`。真正的 rAF 循环在 `scroll-driver.ts`。
 */

/** 短/长距离的分界，单位是视口高度。 */
export const SHORT_JUMP_VIEWPORTS = 1.5;

/** 位移小于它就算原地：动画看不出来，直接落位。 */
export const MOTION_EPSILON = 1;

/** 短距离的到位时间。 */
export const SHORT_ARRIVE_MS = 180;

/** 长距离起步阶段的时长。 */
export const DEPART_MS = 50;

/** 起步阶段朝目标方向移动的距离。 */
export const DEPART_DISTANCE = 48;

/** 瞬移落在目标来向侧多远的地方：留出缓入的减速距离。 */
export const APPROACH_DISTANCE = 180;

/** 长距离落地缓入的时长。 */
export const ARRIVE_MS = 160;

/** 缓出：起步快、落点稳，位移的大部分在头三成时间里走完。 */
export function easeOutCubic(progress: number): number {
	const p = clamp01(progress);
	return 1 - (1 - p) ** 3;
}

/** 缓入：起步慢，挪头几十像素时不至于像被弹了一下。 */
export function easeInQuad(progress: number): number {
	const p = clamp01(progress);
	return p * p;
}

/** 把进度夹到 `[0, 1]`。 */
function clamp01(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.min(value, 1);
}

/** 把滚动位置夹进容器的可滚范围。 */
export function clampScroll(value: number, maxScroll: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return value >= maxScroll ? Math.max(0, maxScroll) : value;
}

/** 一次程序化滚动怎么走。 */
export type ScrollMotionPlan =
	/** 立即落位（`reducedMotion`、或者几乎没位移） */
	| { readonly mode: "instant"; readonly target: number }
	/** 一次缓出到位 */
	| {
			readonly mode: "short";
			readonly from: number;
			readonly to: number;
			readonly maxScroll: number;
	  }
	/** 起步 → 瞬移 → 缓入 */
	| {
			readonly mode: "teleport";
			readonly from: number;
			readonly to: number;
			readonly maxScroll: number;
			/** 起步阶段的终点（已夹进可滚范围） */
			readonly departTo: number;
			/** 瞬移落在哪里（已夹进可滚范围） */
			readonly approachPoint: number;
			/** 行进方向：`1` 往下滚，`-1` 往上滚 */
			readonly direction: 1 | -1;
	  };

/** 某一时刻的采样结果。 */
export interface ScrollMotionSample {
	/** 当前处在哪一段；`done` 表示已经到达，不再需要下一帧 */
	readonly phase: "depart" | "arrive" | "done";
	/** 这一帧该写到 `scrollTop` 的值 */
	readonly scrollTop: number;
	/** 是否已经越过瞬移点（落点是瞬移后的缓入段） */
	readonly didTeleport: boolean;
}

/** 规划一次滚动。`to` 与结果都会被夹进 `[0, maxScroll]`。 */
export function planScrollMotion(input: {
	readonly from: number;
	readonly to: number;
	readonly clientHeight: number;
	readonly maxScroll: number;
	readonly reducedMotion?: boolean | undefined;
}): ScrollMotionPlan {
	const maxScroll = Math.max(0, input.maxScroll);
	const from = clampScroll(input.from, maxScroll);
	const to = clampScroll(input.to, maxScroll);
	const distance = Math.abs(to - from);
	if (input.reducedMotion === true || distance <= MOTION_EPSILON) {
		return { mode: "instant", target: to };
	}
	if (distance <= Math.max(0, input.clientHeight) * SHORT_JUMP_VIEWPORTS) {
		return { mode: "short", from, to, maxScroll };
	}
	const direction: 1 | -1 = to > from ? 1 : -1;
	return {
		mode: "teleport",
		from,
		to,
		maxScroll,
		departTo: clampScroll(from + direction * DEPART_DISTANCE, maxScroll),
		approachPoint: clampScroll(to - direction * APPROACH_DISTANCE, maxScroll),
		direction,
	};
}

/** 按经过的毫秒数采样这一帧的位置。`liveTarget` 由调用方每帧重新读。 */
export function sampleScrollMotion(
	plan: ScrollMotionPlan,
	elapsedMs: number,
	liveTarget: number,
	maxScroll: number,
): ScrollMotionSample {
	if (plan.mode === "instant") {
		return { phase: "done", scrollTop: plan.target, didTeleport: false };
	}
	const bound = Math.max(0, maxScroll);
	const target = clampScroll(liveTarget, bound);
	if (plan.mode === "short") {
		const progress = clamp01(elapsedMs / SHORT_ARRIVE_MS);
		if (progress >= 1) {
			return { phase: "done", scrollTop: target, didTeleport: false };
		}
		const scrollTop = plan.from + (target - plan.from) * easeOutCubic(progress);
		return { phase: "arrive", scrollTop: clampScroll(scrollTop, bound), didTeleport: false };
	}
	// 长距离：起步段走完之前不瞬移
	if (elapsedMs < DEPART_MS) {
		const progress = clamp01(elapsedMs / DEPART_MS);
		const scrollTop = plan.from + (plan.departTo - plan.from) * easeInQuad(progress);
		return { phase: "depart", scrollTop: clampScroll(scrollTop, bound), didTeleport: false };
	}
	/*
	 * 目标已经跑到瞬移点的"身后"：估算误差大过缓入距离，再从瞬移点滑过去就是先反向弹回。
	 * 这种情况直接收敛到目标，有界、不越界、也不来回摆。
	 */
	if ((target - plan.approachPoint) * plan.direction <= 0) {
		return { phase: "done", scrollTop: target, didTeleport: true };
	}
	const progress = clamp01((elapsedMs - DEPART_MS) / ARRIVE_MS);
	if (progress >= 1) {
		return { phase: "done", scrollTop: target, didTeleport: true };
	}
	const scrollTop = plan.approachPoint + (target - plan.approachPoint) * easeOutCubic(progress);
	return { phase: "arrive", scrollTop: clampScroll(scrollTop, bound), didTeleport: true };
}
