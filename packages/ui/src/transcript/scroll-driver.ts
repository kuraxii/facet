/**
 * 滚动动效的 rAF 驱动。
 *
 * 只做三件事：按 `scroll-motion.ts` 算出来的曲线逐帧写 `scrollTop`、每帧重读一次目标坐标、
 * 结束或被取消时收手。曲线与时间都在纯逻辑里，这里不掺数学。
 *
 * 写入是**每帧绝对定位**（直接写 `scrollTop`），不经过虚拟化器：动画期间行还在陆续测量，
 * 虚拟机自己的补偿可能和曲线打架，绝对写入每帧都会把位置拉回曲线上，落点因此只由曲线决定。
 * 虚拟化器读到的是普通的滚动事件，视口跟着走，没有额外状态要对齐。
 *
 * 取消由外部发起（用户滚轮/触摸/按键、新的程序化滚动、卸载）：这里不挂监听，避免和
 * `transcript-viewport.ts` 里的用户意图判定重复绑一遍。
 */
import { useCallback, useEffect, useRef } from "react";
import { SCROLL_UP_KEYS } from "../chat/use-stick-to-bottom.ts";
import { clampScroll, planScrollMotion, sampleScrollMotion } from "./scroll-motion.ts";

/**
 * 会自己改变滚动位置的按键。
 *
 * 按下这些键就说明用户在操作视口，正在跑的动画要当场让路。集合以贴底那边的「往上走」那组
 * 为基础，补上往下走的与翻页、到顶到底、空格（浏览器里同样翻一屏）。
 */
export const SCROLL_INTERRUPT_KEYS: ReadonlySet<string> = new Set([
	...SCROLL_UP_KEYS,
	"ArrowDown",
	"PageDown",
	"End",
	" ",
]);

/** 驱动句柄。 */
export interface ScrollDriver {
	/**
	 * 用统一曲线滚到 `readLive()` 给出的位置。
	 *
	 * `readLive` 每帧都会被调一次，返回当前该去的地方（滚动坐标）；`onSettle` 在真正落位后
	 * 调一次，用来做收尾（比如贴底时再补一次底边）。
	 */
	run(readLive: () => number, onSettle?: () => void): void;
	/** 立刻停下：取消下一帧，不再写任何 `scrollTop` */
	cancel(): void;
}

/** 建驱动需要的东西。 */
export interface ScrollDriverOptions {
	/** 滚动容器；换了容器就换一个驱动 */
	readonly getElement: () => HTMLElement | null;
	/** 系统是否要求减少动效（`prefers-reduced-motion`） */
	readonly prefersReducedMotion: () => boolean;
	/**
	 * 曲线开始与结束时各通知一次。
	 *
	 * 调用方用它停掉虚拟化器的尺寸补偿：补偿每次量到高度变化都会写一次 `scrollTop`，与曲线的
	 * 每帧写入抢同一帧，画面就会在两者之间抖一下。曲线本来就每帧按目标行的真实矩形重算落点，
	 * 这些高度变化已经被吃掉了；跑完再让补偿恢复默认。
	 */
	readonly onRunningChange?: ((running: boolean) => void) | undefined;
}

/** 一次进行中的滚动。 */
interface Running {
	readonly readLive: () => number;
	readonly onSettle: (() => void) | undefined;
	/** 首帧的时间戳，用来算经过了多少毫秒 */
	startedAt: number;
	/** 位移规划，首帧建立 */
	plan: ReturnType<typeof planScrollMotion> | undefined;
	/** 阻尼追踪后的目标坐标，上一帧的采样值原样带回来 */
	tracked: number | undefined;
}

/**
 * 建一个 rAF 驱动的滚动器。
 *
 * 同一时间只有一次滚动在进行；再次 `run` 会把上一次丢掉（新的程序化滚动打断旧的）。
 */
export function useScrollDriver(options: ScrollDriverOptions): ScrollDriver {
	const latest = useRef(options);
	latest.current = options;
	const frame = useRef(0);
	const running = useRef<Running | null>(null);

	const cancel = useCallback(() => {
		if (frame.current !== 0) {
			window.cancelAnimationFrame(frame.current);
			frame.current = 0;
		}
		if (running.current !== null) {
			running.current = null;
			latest.current.onRunningChange?.(false);
		}
	}, []);

	const run = useCallback(
		(readLive: () => number, onSettle?: () => void) => {
			cancel();
			const element = latest.current.getElement();
			if (element === null) {
				return;
			}
			const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
			const plan = planScrollMotion({
				from: element.scrollTop,
				to: readLive(),
				clientHeight: element.clientHeight,
				maxScroll,
				reducedMotion: latest.current.prefersReducedMotion(),
			});
			if (plan.mode === "instant") {
				element.scrollTop = plan.target;
				onSettle?.();
				return;
			}
			const state: Running = { readLive, onSettle, startedAt: 0, plan, tracked: undefined };
			running.current = state;
			latest.current.onRunningChange?.(true);

			const step = (now: number): void => {
				frame.current = 0;
				const current = running.current;
				const target = latest.current.getElement();
				if (current === null || target === null) {
					return;
				}
				if (current.startedAt === 0) {
					current.startedAt = now;
				}
				if (current.plan === undefined) {
					return;
				}
				const bound = Math.max(0, target.scrollHeight - target.clientHeight);
				const sample = sampleScrollMotion(
					current.plan,
					now - current.startedAt,
					current.readLive(),
					bound,
					current.tracked,
				);
				current.tracked = sample.trackedTarget;
				target.scrollTop = clampScroll(sample.scrollTop, bound);
				if (sample.phase === "done") {
					running.current = null;
					latest.current.onRunningChange?.(false);
					current.onSettle?.();
					return;
				}
				frame.current = window.requestAnimationFrame(step);
			};
			frame.current = window.requestAnimationFrame(step);
		},
		[cancel],
	);

	// 卸载（含切会话时的整体重挂）时收掉下一帧
	useEffect(() => cancel, [cancel]);

	return { run, cancel };
}

/**
 * 用户自己动手就通知一次。
 *
 * 绑在滚动容器上：滚轮（两个方向都算——往上滚要脱离贴底，往下滚同样不该被曲线按在原来的
 * 轨道上）、触摸按下与滑动、指针按下，以及会让视口自己走的按键。这里只说「有人接管了」，
 * 具体做什么由调用方决定（取消曲线、放弃挂着的恢复）。
 */
export function useScrollInterrupt(element: HTMLElement | null, onInterrupt: () => void): void {
	const handler = useRef(onInterrupt);
	handler.current = onInterrupt;
	useEffect(() => {
		if (element === null) {
			return;
		}
		const fire = (): void => handler.current();
		const onKeyDown = (event: KeyboardEvent): void => {
			if (SCROLL_INTERRUPT_KEYS.has(event.key)) {
				fire();
			}
		};
		element.addEventListener("wheel", fire, { passive: true });
		element.addEventListener("touchstart", fire, { passive: true });
		element.addEventListener("touchmove", fire, { passive: true });
		element.addEventListener("pointerdown", fire, { passive: true });
		element.addEventListener("keydown", onKeyDown);
		return () => {
			element.removeEventListener("wheel", fire);
			element.removeEventListener("touchstart", fire);
			element.removeEventListener("touchmove", fire);
			element.removeEventListener("pointerdown", fire);
			element.removeEventListener("keydown", onKeyDown);
		};
	}, [element]);
}
