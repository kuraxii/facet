/**
 * 抽屉的键盘与焦点行为。
 *
 * 两件事：Escape 关闭（只在内层浮层没吃完这次按键时）、关闭后把焦点还给打开它的那个按钮。
 * 抽屉自己的状态由调用方持有，这里只挂监听与记焦点。
 */
import { useEffect, useRef } from "react";
import { shouldCloseDrawerOnEscape } from "../drawer-state.ts";

/** 文档里有没有打开的原生弹窗（`Modal` 用 `showModal()` 打开）。 */
function hasOpenDialog(): boolean {
	return document.querySelector("dialog[open]") !== null;
}

/** 抽屉行为参数。 */
export interface DrawerBehaviorOptions {
	/** 抽屉此刻是否打开 */
	isOpen: boolean;
	/** 关闭请求：Escape 与遮罩都走它 */
	onClose: () => void;
}

/**
 * 给一个抽屉挂上 Escape 与焦点归还。
 *
 * Escape 监听挂在 `window` 的冒泡阶段：元素级处理器、监听 `document` 的菜单、以及
 * Portal 到 `body` 的浮层都先跑，抽屉最后才看到这次按键。首行按 `defaultPrevented`
 * 与「有没有开着的弹窗」判断，保证一次 Escape 只关最内层。
 */
export function useDrawerBehavior({ isOpen, onClose }: DrawerBehaviorOptions): void {
	/** 打开抽屉时正在聚焦的元素，关闭后还给它 */
	const returnTarget = useRef<HTMLElement | null>(null);
	/** 关闭回调放 ref 里：它换引用不该重挂键盘监听 */
	const close = useRef(onClose);
	close.current = onClose;

	useEffect(() => {
		if (isOpen) {
			returnTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			return;
		}
		const target = returnTarget.current;
		returnTarget.current = null;
		if (target?.isConnected === true) {
			target.focus();
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent): void => {
			const closeable = shouldCloseDrawerOnEscape({
				defaultPrevented: event.defaultPrevented,
				hasOpenDialog: hasOpenDialog(),
			});
			if (!closeable) {
				return;
			}
			event.preventDefault();
			close.current();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isOpen]);
}
