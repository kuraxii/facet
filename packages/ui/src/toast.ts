/**
 * 轻提示的纯数据模型。
 *
 * 提示只承担临时反馈：操作被拒、后台事件、插件的 `ctx.ui.notify`。它不替代需要用户决策的
 * 弹层、需要一直看得见的连接状态，也不替代可重试错误条——那些各有自己的面。
 *
 * 这里只做入队、合并、过期与容量裁剪，全是纯函数；计时器与 portal 挂载留在渲染层。
 * 提示上不带按钮：它只负责说事实，要动手的事由用户回到原来的地方做。
 */

/** 轻提示等级：只决定图标与配色，不写进文字。 */
export type ToastLevel = "info" | "success" | "warning" | "error";

/** 轻提示末尾可选的快捷动作（如 Settle 撤销）。 */
export interface ToastAction {
	/** 按钮文字 */
	label: string;
	/** 点击触发 */
	onClick: () => void;
}

/** 一条正在显示的提示。 */
export interface Toast {
	/** 去重键，等于「等级 + 事实内容」，同一句话不会叠出两条 */
	id: string;
	/** 等级，决定图标与配色 */
	level: ToastLevel;
	/** 事实内容：谁、发生了什么，不写「错误」「成功」这类标签 */
	message: string;
	/** 同一句话又出现了一次的次数，用来折叠重复提示 */
	count: number;
	/** 入队或最近一次重复出现的时刻，Unix 毫秒 */
	createdAt: number;
	/** 到点出队，Unix 毫秒 */
	expiresAt: number;
	/** 可选交互按钮 */
	action?: ToastAction | undefined;
}

/** 同时最多显示几条，超出的丢最旧的。 */
export const TOAST_LIMIT = 3;

/** 各等级的停留时长，毫秒。错误留得久一些，因为读的时间更长。 */
const TOAST_DURATIONS: Record<ToastLevel, number> = {
	success: 3000,
	info: 3500,
	warning: 5000,
	error: 6000,
};

/** 一条提示该停多久。 */
export function toastDuration(level: ToastLevel): number {
	return TOAST_DURATIONS[level];
}

/** 入队参数；`now` 由调用方给，方便纯函数测试。 */
export interface ToastInput {
	/** 等级 */
	level: ToastLevel;
	/** 事实内容 */
	message: string;
	/** 当前时刻，Unix 毫秒 */
	now: number;
	/** 可选交互按钮 */
	action?: ToastAction | undefined;
}

/** 同等级同内容的提示算同一条。 */
function toastId(level: ToastLevel, message: string): string {
	return `${level}:${message}`;
}

/**
 * 入队一条提示。
 *
 * 同一句话再出现时不新增，而是把已有那条重新计时、次数加一；这样插件连着报同一件事只会
 * 看到一条提示，不会堆满屏幕。
 */
export function pushToast(toasts: readonly Toast[], input: ToastInput): readonly Toast[] {
	const id = toastId(input.level, input.message);
	const existing = toasts.findIndex((toast) => toast.id === id);
	const expiresAt = input.now + toastDuration(input.level);
	if (existing >= 0) {
		const previous = toasts[existing] as Toast;
		const next = [...toasts];
		next[existing] = {
			...previous,
			count: previous.count + 1,
			createdAt: input.now,
			expiresAt,
			...(input.action === undefined ? {} : { action: input.action }),
		};
		return next;
	}
	const toast: Toast = {
		id,
		level: input.level,
		message: input.message,
		count: 1,
		createdAt: input.now,
		expiresAt,
		...(input.action === undefined ? {} : { action: input.action }),
	};
	const next = [...toasts, toast];
	return next.length > TOAST_LIMIT ? next.slice(next.length - TOAST_LIMIT) : next;
}

/**
 * 出队已经到点的提示。
 *
 * 一条都没到点时原样返回入参引用，调用方据此跳过重绘。
 */
export function expireToasts(toasts: readonly Toast[], now: number): readonly Toast[] {
	const next = toasts.filter((toast) => toast.expiresAt > now);
	return next.length === toasts.length ? toasts : next;
}

/** 手动收掉一条提示；不存在时原样返回。 */
export function dismissToast(toasts: readonly Toast[], id: string): readonly Toast[] {
	const next = toasts.filter((toast) => toast.id !== id);
	return next.length === toasts.length ? toasts : next;
}

/**
 * 把每条提示的到期时刻整体后移。
 *
 * 指针停在提示上时计时暂停：恢复时按暂停的时长把 deadline 一起推后，剩余时间不会被吃掉。
 */
export function shiftToastExpiry(toasts: readonly Toast[], deltaMs: number): readonly Toast[] {
	if (deltaMs <= 0 || toasts.length === 0) {
		return toasts;
	}
	return toasts.map((toast) => ({ ...toast, expiresAt: toast.expiresAt + deltaMs }));
}
