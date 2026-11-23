// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	APPROACH_DISTANCE,
	ARRIVE_MS,
	DEPART_DISTANCE,
	DEPART_MS,
	MOTION_EPSILON,
	planScrollMotion,
	type ScrollMotionPlan,
	SHORT_ARRIVE_MS,
	SHORT_JUMP_VIEWPORTS,
	sampleScrollMotion,
} from "./scroll-motion.ts";

const MAX = 20_000;
const HEIGHT = 800;

/** 规划一次滚动：默认视口 800、可滚上限 20000。 */
function plan(from: number, to: number, extra: Partial<Parameters<typeof planScrollMotion>[0]> = {}) {
	return planScrollMotion({ from, to, clientHeight: HEIGHT, maxScroll: MAX, ...extra });
}

/** 按一串时刻采样（静态目标）。 */
function series(target: ScrollMotionPlan, times: readonly number[], live: number, maxScroll = MAX) {
	return times.map((ms) => sampleScrollMotion(target, ms, live, maxScroll));
}

describe("planScrollMotion", () => {
	it("系统要求减少动效时一律一步落位，长短距离都一样", () => {
		expect(plan(0, 100, { reducedMotion: true }).mode).toBe("instant");
		expect(plan(0, 9000, { reducedMotion: true }).mode).toBe("instant");
	});

	it("位移不超过阈值就一步落位", () => {
		expect(plan(500, 500 + MOTION_EPSILON).mode).toBe("instant");
		expect(plan(500, 500).mode).toBe("instant");
	});

	it("短距离就是一档缓出", () => {
		const short = plan(1000, 1500);
		expect(short.mode).toBe("short");
	});

	it("刚好 1.5 个视口仍算短距离，多一像素才走两段式", () => {
		expect(plan(1000, 1000 + HEIGHT * SHORT_JUMP_VIEWPORTS).mode).toBe("short");
		expect(plan(1000, 1000 + HEIGHT * SHORT_JUMP_VIEWPORTS + 1).mode).toBe("teleport");
	});

	it("长距离给出起步终点与瞬移点，各在目标的两侧", () => {
		const down = plan(1000, 9000);
		if (down.mode !== "teleport") {
			throw new Error("expected teleport");
		}
		expect(down.direction).toBe(1);
		expect(down.departTo).toBe(1000 + DEPART_DISTANCE);
		expect(down.approachPoint).toBe(9000 - APPROACH_DISTANCE);

		const up = plan(9000, 1000);
		if (up.mode !== "teleport") {
			throw new Error("expected teleport");
		}
		expect(up.direction).toBe(-1);
		expect(up.departTo).toBe(9000 - DEPART_DISTANCE);
		expect(up.approachPoint).toBe(1000 + APPROACH_DISTANCE);
	});

	it("起步终点与瞬移点都被夹进可滚范围", () => {
		const toTop = plan(5000, 0);
		if (toTop.mode !== "teleport") {
			throw new Error("expected teleport");
		}
		expect(toTop.departTo).toBeGreaterThanOrEqual(0);
		expect(toTop.approachPoint).toBeGreaterThanOrEqual(0);

		const toEnd = plan(300, MAX + 5000);
		if (toEnd.mode !== "teleport") {
			throw new Error("expected teleport");
		}
		expect(toEnd.to).toBe(MAX);
		expect(toEnd.approachPoint).toBeLessThanOrEqual(MAX);
	});
});

describe("sampleScrollMotion：短距离", () => {
	it("从起点开始，严格单调，按时间收敛到目标", () => {
		const short = plan(1000, 1500);
		const at = [0, 15, 30, 60, 120, SHORT_ARRIVE_MS - 1];
		const tops = series(short, at, 1500).map((sample) => sample.scrollTop);
		expect(tops[0]).toBe(1000);
		for (let index = 1; index < tops.length; index += 1) {
			expect(tops[index] as number).toBeGreaterThan(tops[index - 1] as number);
		}
		expect(tops[tops.length - 1] as number).toBeLessThan(1500);

		const done = sampleScrollMotion(short, SHORT_ARRIVE_MS, 1500, MAX);
		expect(done.phase).toBe("done");
		expect(done.scrollTop).toBe(1500);
		expect(done.didTeleport).toBe(false);
	});

	it("往上滚也是同一档", () => {
		const short = plan(1500, 1000);
		const tops = series(short, [0, 45, 90, 135], 1000).map((sample) => sample.scrollTop);
		for (let index = 1; index < tops.length; index += 1) {
			expect(tops[index] as number).toBeLessThan(tops[index - 1] as number);
		}
		expect(sampleScrollMotion(short, SHORT_ARRIVE_MS, 1000, MAX).scrollTop).toBe(1000);
	});
});

describe("sampleScrollMotion：长距离两段式", () => {
	it("往下跳：起步朝目标挪一小段，50ms 瞬间落到瞬移点，再缓入到目标", () => {
		const jump = plan(1000, 9000);
		if (jump.mode !== "teleport") {
			throw new Error("expected teleport");
		}
		const depart = series(jump, [0, DEPART_MS / 2, DEPART_MS - 1], 9000);
		expect(depart[0]?.phase).toBe("depart");
		expect(depart[0]?.scrollTop).toBe(1000);
		expect(depart[0]?.didTeleport).toBe(false);
		for (const sample of depart) {
			expect(sample.scrollTop).toBeGreaterThanOrEqual(1000);
			expect(sample.scrollTop).toBeLessThanOrEqual(1000 + DEPART_DISTANCE);
		}

		const arrived = sampleScrollMotion(jump, DEPART_MS, 9000, MAX);
		expect(arrived.didTeleport).toBe(true);
		expect(arrived.phase).toBe("arrive");
		expect(arrived.scrollTop).toBe(9000 - APPROACH_DISTANCE);

		// 缓入段单调逼近目标
		const approach = series(jump, [DEPART_MS, DEPART_MS + 40, DEPART_MS + 80, DEPART_MS + 120], 9000).map(
			(sample) => sample.scrollTop,
		);
		for (let index = 1; index < approach.length; index += 1) {
			expect(approach[index] as number).toBeGreaterThan(approach[index - 1] as number);
		}

		const done = sampleScrollMotion(jump, DEPART_MS + ARRIVE_MS, 9000, MAX);
		expect(done.phase).toBe("done");
		expect(done.scrollTop).toBe(9000);
	});

	it("往上跳：方向反过来，瞬移落在目标下方", () => {
		const jump = plan(9000, 1000);
		if (jump.mode !== "teleport") {
			throw new Error("expected teleport");
		}
		const depart = series(jump, [DEPART_MS / 2], 1000);
		expect(depart[0]?.scrollTop).toBeLessThan(9000);
		const arrived = sampleScrollMotion(jump, DEPART_MS, 1000, MAX);
		expect(arrived.didTeleport).toBe(true);
		expect(arrived.scrollTop).toBe(1000 + APPROACH_DISTANCE);
		expect(sampleScrollMotion(jump, DEPART_MS + ARRIVE_MS, 1000, MAX).scrollTop).toBe(1000);
	});

	it("目标坐标在中途漂移：曲线跟着走，落点精确，不反向", () => {
		const jump = plan(1000, 9000);
		/** 逐帧串起来跑：追踪值是上一帧的返回值，与驱动的用法一致 */
		const run = (liveOf: (ms: number) => number, frames: number): number[] => {
			const tops: number[] = [];
			let tracked: number | undefined;
			for (let frame = 0; frame <= frames; frame += 1) {
				const ms = (frame * (DEPART_MS + ARRIVE_MS)) / frames;
				const sample = sampleScrollMotion(jump, ms, liveOf(ms), MAX, tracked);
				tracked = sample.trackedTarget;
				tops.push(sample.scrollTop);
			}
			return tops;
		};
		// 缓入开始 30ms 之后目标被实测修正了 56px
		const tops = run((ms) => (ms >= DEPART_MS + 30 ? 9000 + 56 : 9000), 40);
		for (let index = 1; index < tops.length; index += 1) {
			expect(tops[index] as number).toBeGreaterThanOrEqual(tops[index - 1] as number);
		}
		// 落点精确：终点就是漂移后的目标
		let tracked: number | undefined;
		const last = sampleScrollMotion(jump, DEPART_MS + ARRIVE_MS, 9000 + 56, MAX, tracked);
		tracked = last.trackedTarget;
		expect(last.scrollTop).toBe(9000 + 56);
		expect(tracked).toBe(9000 + 56);
		expect(sampleScrollMotion(jump, DEPART_MS + ARRIVE_MS, 9000 - 56, MAX).scrollTop).toBe(9000 - 56);
	});

	it("台阶式的高度回填被摊成几帧，不在单帧上陡一下", () => {
		const jump = plan(1000, 9000);
		// 第一帧把追踪值定在 9000，第二帧目标突然变成 9060
		const first = sampleScrollMotion(jump, DEPART_MS, 9000, MAX);
		const stepped = sampleScrollMotion(jump, DEPART_MS + 16, 9000 + 60, MAX, first.trackedTarget);
		// 只有 35% 的台阶被这一帧吃掉
		expect(stepped.trackedTarget).toBeCloseTo(9000 + 60 * 0.35, 5);
		// 缓入快结束时直接对齐，落点不带尾巴
		const near = sampleScrollMotion(jump, DEPART_MS + ARRIVE_MS * 0.9, 9000 + 60, MAX, 9000);
		expect(near.trackedTarget).toBe(9000 + 60);
	});

	it("漂移大到越过瞬移点：直接收敛，不先往回弹，也不越界", () => {
		const jump = plan(1000, 9000);
		const overshoot = sampleScrollMotion(jump, DEPART_MS, 9000 - APPROACH_DISTANCE - 80, MAX);
		expect(overshoot.phase).toBe("done");
		expect(overshoot.scrollTop).toBe(9000 - APPROACH_DISTANCE - 80);
		const bounded = sampleScrollMotion(jump, DEPART_MS, -400, MAX);
		expect(bounded.scrollTop).toBe(0);
	});
});

describe("sampleScrollMotion：可滚范围", () => {
	it("跳顶与回底在任何时刻都不越界", () => {
		const times = [0, 10, 25, DEPART_MS, DEPART_MS + 40, DEPART_MS + ARRIVE_MS];
		for (const target of [0, MAX]) {
			const jump = plan(MAX / 2, target);
			for (const sample of series(jump, times, target)) {
				expect(sample.scrollTop).toBeGreaterThanOrEqual(0);
				expect(sample.scrollTop).toBeLessThanOrEqual(MAX);
			}
		}
	});

	it("静态目标时最先与最后的采样都不越界", () => {
		const jump = plan(0, MAX);
		expect(series(jump, [0], MAX)[0]?.scrollTop).toBe(0);
		expect(sampleScrollMotion(jump, DEPART_MS + ARRIVE_MS, MAX, MAX).scrollTop).toBe(MAX);
	});
});
