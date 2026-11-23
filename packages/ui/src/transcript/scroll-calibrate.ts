/**
 * 落位之后的最后一对。
 *
 * 目标行如果从没量过，它的位置只有估高；等到位置不再变化（曲线走完、目标行也挂上了）之后，
 * 按那一行的实际矩形再补一次差，偏差小于容差就不动。中途用户一动就放弃——他已经在看别处了。
 *
 * 只在没有动画的路径上用：一次性落位（`prefers-reduced-motion`）与切会话恢复位置。走曲线
 * 的跳转不补跳——目标坐标每帧都在重读，残差在减速段里就吸收掉了，落位后再补一下反而看得见。
 */
import { TRANSCRIPT_DATA_ATTRS } from "../layout/layout-contract.ts";

/** 等位置稳定最多看多少帧。 */
const SETTLE_FRAMES = 60;

/** 偏差在这个范围内就不必再补（px）。 */
const TOLERANCE = 2;

/** 连续几帧位置不动就算稳定。 */
const STABLE_FRAMES = 2;

/** 一次落位校准。 */
export interface RowCalibration {
	/** 滚动容器 */
	readonly getElement: () => HTMLElement | null;
	/** 目标行在虚拟列表里的下标 */
	readonly index: number;
	/** 这一行顶边应当停在视口上沿下面多少像素 */
	readonly lead: number;
	/** 返回 `true` 就放弃（用户已经接管了视口） */
	readonly isCancelled: () => boolean;
	/** 对齐时写滚动位置（走虚拟化器，让它知道这次移动是自己做的） */
	readonly write: (scrollTop: number) => void;
}

/** 盯几帧，等位置稳定后按目标行的实际矩形补一次差。 */
export function calibrateRow(options: RowCalibration): void {
	let frames = 0;
	let stable = 0;
	let lastTop = Number.NaN;
	const step = (): void => {
		frames += 1;
		const element = options.getElement();
		if (element === null || options.isCancelled()) {
			return;
		}
		const top = element.scrollTop;
		stable = Math.abs(top - lastTop) < 0.5 ? stable + 1 : 0;
		lastTop = top;
		if (stable < STABLE_FRAMES && frames <= SETTLE_FRAMES) {
			window.requestAnimationFrame(step);
			return;
		}
		const row = element.querySelector<HTMLElement>(`[${TRANSCRIPT_DATA_ATTRS.rowIndex}="${options.index}"]`);
		if (row === null) {
			return;
		}
		const offset = row.getBoundingClientRect().top - element.getBoundingClientRect().top;
		if (Math.abs(offset - options.lead) > TOLERANCE) {
			options.write(top + (offset - options.lead));
		}
	};
	window.requestAnimationFrame(step);
}
