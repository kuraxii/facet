/**
 * 模态弹层。
 *
 * 用原生 `<dialog>` 打开：`showModal()` 自带顶部层、页面 inert、焦点包含与关闭后归还焦点，
 * Esc 与（支持的浏览器上）点遮罩关闭由浏览器给，样式只留 `::backdrop` 与内容本身。因此这里
 * 不写 `role="dialog"`、`aria-modal`、焦点陷阱，也不在关闭时手工还焦点。
 */

import { type ReactNode, useEffect, useRef } from "react";

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

	useEffect(() => {
		const dialog = ref.current;
		if (!open || dialog === null) {
			return;
		}
		closing.current = false;
		// 认 `closedby` 的浏览器按属性走；不认的时候 Esc 照旧能用，只是少了点遮罩关闭
		dialog.showModal();
		// 标了 `data-autofocus` 的主控件拿初始焦点；没有就交给浏览器挑第一个可聚焦元素
		const primary = dialog.querySelector<HTMLElement>("[data-autofocus]");
		primary?.focus();
		return () => {
			// 卸载前先收起来：直接移除打开的 dialog 会让焦点停在 body 上
			if (dialog.open) {
				dialog.close();
			}
		};
	}, [open]);

	useEffect(() => {
		const dialog = ref.current;
		if (!open || dialog === null || supportsClosedBy()) {
			return;
		}

		/** 按下与松开都在外面才算点了遮罩：拖选文本时松手落在外面不该关 */
		let pressedOutside = false;
		const onPointerDown = (event: PointerEvent): void => {
			pressedOutside = isOutside(dialog, event);
		};
		const onPointerUp = (event: PointerEvent): void => {
			if (pressedOutside && isOutside(dialog, event)) {
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
			// 认这个属性的浏览器自己处理点遮罩关闭，Esc 始终有效
			closedby="any"
			onCancel={(event) => {
				// Esc：交给上层决定关不关，浏览器因此不会再自己关一次
				event.preventDefault();
				if (closing.current) {
					return;
				}
				closing.current = true;
				onClose();
			}}
			onClose={() => {
				// `close()` 之外还有「点遮罩」这条路径会直接关闭，同样要通知上层
				if (closing.current) {
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
