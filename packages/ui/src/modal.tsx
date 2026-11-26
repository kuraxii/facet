/**
 * 模态弹层。
 *
 * 用原生 `<dialog>` 打开：`showModal()` 自带顶部层、页面 inert、焦点包含与关闭后归还焦点，
 * Esc 与（支持的浏览器上）点遮罩关闭由浏览器给，样式只留 `::backdrop` 与内容本身。因此这里
 * 不写 `role="dialog"`、`aria-modal`、焦点陷阱，也不在关闭时手工还焦点。
 */

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MODAL_EXIT_SLACK_MS, modalExitDelayMs } from "./modal-presence.ts";

/** 在浏览器/jsdom 中同步执行以配合 View Transitions 与首帧测距，Node 服务端渲染回退到 `useEffect`。 */
const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

/** 读取文档根样式上的模态退场时长（`--dur-slow`）。 */
function readModalExitDelayMs(): number {
	if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
		return 0;
	}
	return modalExitDelayMs({
		rawDuration: getComputedStyle(document.documentElement).getPropertyValue("--dur-slow"),
		isWindowResizing: document.documentElement.hasAttribute("data-window-resizing"),
	});
}

/**
 * 模态弹层的挂载生命周期：打开时立即挂载，关闭时保留挂载直到 CSS 退场动画与遮罩
 * 淡出播完再卸载；减弱动效或无样式环境下立即卸载。
 */
export function useModalPresence(open: boolean): boolean {
	const [mounted, setMounted] = useState(open);

	useEffect(() => {
		if (open) {
			setMounted(true);
			return;
		}
		const delay = readModalExitDelayMs();
		if (delay <= 0) {
			setMounted(false);
			return;
		}
		const timer = window.setTimeout(() => {
			setMounted(false);
		}, delay + MODAL_EXIT_SLACK_MS);
		return () => window.clearTimeout(timer);
	}, [open]);

	return open || mounted;
}

/** 弹层的参数。 */
export interface ModalProps {
	/** 是否打开；关掉之后组件整体卸载 */
	open: boolean;
	/** 关闭请求：Esc、点遮罩或关闭按钮都走它 */
	onClose: () => void;
	/** 无障碍名字；有标题时传标题文字 */
	label: string;
	/** 叠在 `.dialog` 上的类名，例如 `is-narrow` */
	className?: string;
	children: ReactNode;
}

/** 浏览器是否认 `closedby`：不认的时候自己补一层点遮罩关闭。 */
function supportsClosedBy(): boolean {
	return "closedBy" in HTMLDialogElement.prototype;
}

/** 指针落点是否在弹层矩形之外。判断坐标而不是 `target`：弹层自身的留白与子元素间隙也算「里面」。 */
function isOutside(dialog: HTMLDialogElement, event: PointerEvent): boolean {
	const rect = dialog.getBoundingClientRect();
	return (
		event.clientX < rect.left ||
		event.clientX > rect.right ||
		event.clientY < rect.top ||
		event.clientY > rect.bottom
	);
}

/**
 * 模态弹层。
 *
 * 组件只在 `open` 为真时挂载：每次打开都是一个新节点，`showModal()` 一定处于「未打开」状态。
 */
export function Modal({ open, onClose, label, className, children }: ModalProps): ReactNode {
	const ref = useRef<HTMLDialogElement>(null);
	/** 关闭请求只处理一次：`cancel` 与 `close` 会连着来 */
	const closing = useRef(false);

	// 用 layout effect 让 `showModal()` 在 `flushSync` 内同步生效，保证 `startViewTransition`
	// 拍新快照前 `<dialog>` 已经处于 `[open]` 可见态，缩略图飞入浮层的开场形变才能命中目标图
	useIsomorphicLayoutEffect(() => {
		const dialog = ref.current;
		if (dialog === null) {
			return;
		}
		if (open) {
			closing.current = false;
			if (!dialog.open) {
				dialog.showModal();
				// 标了 `data-autofocus` 的主控件拿初始焦点；没有就交给浏览器挑第一个可聚焦元素
				const primary = dialog.querySelector<HTMLElement>("[data-autofocus]");
				primary?.focus();
			}
			return;
		}
		if (!dialog.open) {
			return;
		}
		const delay = readModalExitDelayMs();
		if (delay <= 0) {
			dialog.close();
			return;
		}
		// 等待 `dialog-out` 退场动画播完再关闭原生顶层，避免遮罩当帧闪失
		const finish = (): void => {
			if (dialog.open) {
				dialog.close();
			}
		};
		const onAnimationEnd = (event: AnimationEvent): void => {
			if (event.target === dialog && event.animationName === "dialog-out") {
				finish();
			}
		};
		dialog.addEventListener("animationend", onAnimationEnd);
		const timer = window.setTimeout(finish, delay + MODAL_EXIT_SLACK_MS);
		return () => {
			dialog.removeEventListener("animationend", onAnimationEnd);
			window.clearTimeout(timer);
		};
	}, [open]);

	// 组件最终卸载时兜底关掉仍开着的顶层 dialog，确保焦点不会遗落在 body 上
	useEffect(() => {
		return () => {
			const dialog = ref.current;
			if (dialog?.open === true) {
				dialog.close();
			}
		};
	}, []);

	useEffect(() => {
		const dialog = ref.current;
		if (!open || dialog === null) {
			return;
		}

		/** 按下与松开都在外面才算点了遮罩：拖选文本时松手落在外面不该关 */
		let pressedOutside = false;
		const onPointerDown = (event: PointerEvent): void => {
			pressedOutside = isOutside(dialog, event);
		};
		const onPointerUp = (event: PointerEvent): void => {
			if (pressedOutside && isOutside(dialog, event) && !closing.current) {
				closing.current = true;
				onClose();
			}
			pressedOutside = false;
		};
		dialog.addEventListener("pointerdown", onPointerDown);
		dialog.addEventListener("pointerup", onPointerUp);
		return () => {
			dialog.removeEventListener("pointerdown", onPointerDown);
			dialog.removeEventListener("pointerup", onPointerUp);
		};
	}, [open, onClose]);

	return (
		<dialog
			ref={ref}
			className={className === undefined ? "dialog" : `dialog ${className}`}
			aria-label={label}
			data-closing={open ? undefined : "true"}
			// 只让浏览器接管 Esc 关窗请求，点击遮罩由外缘指针逻辑延迟放行以播放退场动画
			closedby={supportsClosedBy() ? "closerequest" : undefined}
			onCancel={(event) => {
				// Esc：交给上层决定关不关，浏览器因此不会再自己关一次
				event.preventDefault();
				if (!open || closing.current) {
					return;
				}
				closing.current = true;
				onClose();
			}}
			onClose={() => {
				// 兜底：若原生层面直接关闭，同样只通知上层一次
				if (!open || closing.current) {
					return;
				}
				closing.current = true;
				onClose();
			}}
		>
			{children}
		</dialog>
	);
}
