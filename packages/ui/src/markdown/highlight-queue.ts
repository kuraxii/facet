/**
 * 高亮的排期。
 *
 * 分词要用 WASM 引擎，一次几十个代码块同时分词会把主线程按住几十毫秒——正好落在"跳到新位置
 * 那一帧"上。这里把分词排进空闲时间，**一次空闲只跑一块**：提交与绘制先发生，颜色随后补上，
 * 代码本身从第一帧起就是可读的纯文本。
 *
 * 没有 `requestIdleCallback`（jsdom、老引擎）时退回 `setTimeout`：语义一样，只是不等空闲。
 * 一次空闲只跑一块是刻意的节流——真卡的时候，宁可颜色晚几帧到，也不要把主线程再占满。
 */

/** 一次排期任务的取消句柄。 */
export type CancelHighlight = () => void;

/** 待办队列，先来先跑。 */
const queue: Array<() => void> = [];

/** 是否已经排上了一次空闲回调，避免重复排。 */
let scheduled = false;

/** 空闲调度器；宿主没给就退回宏任务。 */
function whenIdle(run: () => void): void {
	const idle = (
		globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => unknown }
	).requestIdleCallback;
	if (typeof idle === "function") {
		// `timeout` 保证一直有输入/滚动时也不会被饿死
		idle(run, { timeout: 200 });
		return;
	}
	setTimeout(run, 0);
}

/** 跑一块，然后再排下一块。 */
function pump(): void {
	scheduled = false;
	const task = queue.shift();
	if (task === undefined) {
		return;
	}
	task();
	if (queue.length > 0) {
		schedule();
	}
}

/** 排一次空闲回调。 */
function schedule(): void {
	if (scheduled) {
		return;
	}
	scheduled = true;
	whenIdle(pump);
}

/**
 * 把一次分词排进空闲时间。
 *
 * 返回的取消函数会把它从队列里摘掉：内容变了（流式追加）、配色变了或组件卸载时调用，
 * 排着的那一块就不必再算了。
 */
export function scheduleHighlight(task: () => void): CancelHighlight {
	let done = false;
	const entry = (): void => {
		if (!done) {
			task();
		}
	};
	queue.push(entry);
	schedule();
	return () => {
		done = true;
		const at = queue.indexOf(entry);
		if (at >= 0) {
			queue.splice(at, 1);
		}
	};
}

/**
 * 队列里还剩几块。
 *
 * 只给单测用：确认取消真的把任务摘掉了，而不是留在队列里空转。
 */
export function pendingHighlights(): number {
	return queue.length;
}
