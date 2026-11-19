/**
 * 选中文字的右键菜单。
 *
 * 界面里的正文都可以选中，但右键不会弹出菜单，复制只能靠快捷键。这个组件在文档上收一次
 * contextmenu：有选区就贴光标弹一个小菜单，「复制」把选中的文字交出去；给了 `onQuote` 且
 * 选区落在 `quoteScope` 里时多一项「引用」，把同一段文字做成引用交给输入区。
 *
 * 已经自带右键菜单的地方（侧栏行、标签栏）会先 `preventDefault()`，这里见到就退出，不会
 * 弹出第二份菜单。
 */
import { Copy, Quote } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "./i18n/I18nProvider.tsx";

/** 弹出中的菜单。 */
interface OpenMenu {
	/** 光标横坐标，菜单贴它展开 */
	x: number;
	/** 光标纵坐标 */
	y: number;
	/** 打开那一刻选中的文字，复制与引用都用这一份 */
	text: string;
	/** 选区在可引用区域内，且调用方给了引用的落点 */
	canQuote: boolean;
}

/** 读一个长度类的根变量；没定义或读不懂时用兜底值。 */
function readLength(name: string, fallback: number): number {
	const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
	return Number.isFinite(value) ? value : fallback;
}

/** 一段选区：要拿走的文字，以及它能不能被引用。 */
interface PickedSelection {
	/** 选中的原文 */
	text: string;
	/** 选区在可引用区域内 */
	canQuote: boolean;
}

/**
 * 读出现在选中的文字；没有选中内容时为空。
 *
 * 输入框与文本域的选区存在元素自己的 selectionStart 上，不在 `window.getSelection()` 里，
 * 要分开取；它们不属于对话正文，一律不许引用。
 */
function readSelection(
	target: EventTarget | null,
	quoteScope: string | undefined,
): PickedSelection | undefined {
	if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
		const start = target.selectionStart;
		const end = target.selectionEnd;
		if (start === null || end === null || start === end) {
			return undefined;
		}
		return { text: target.value.slice(start, end), canQuote: false };
	}
	const selection = window.getSelection();
	if (selection === null || selection.isCollapsed) {
		return undefined;
	}
	const text = selection.toString();
	// 只在空白里拖一下不算选中，交给浏览器原来的行为
	if (text.trim().length === 0) {
		return undefined;
	}
	const anchor = selection.anchorNode;
	const element = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
	return {
		text,
		canQuote: quoteScope !== undefined && element !== null && element.closest(quoteScope) !== null,
	};
}

/** 选中文字菜单的参数。 */
export interface TextMenuProps {
	/** 复制一段文字 */
	onCopy: (text: string) => void;
	/** 把选中的文字引用进输入区；缺省时菜单里只有复制 */
	onQuote?: ((text: string) => void) | undefined;
	/** 允许引用的选区容器，CSS 选择器；由界面给对话正文打标记 */
	quoteScope?: string | undefined;
}

/** 选中文字的右键菜单。整棵界面只挂一份，右键落在哪儿由选区自己决定。 */
export function TextMenu({ onCopy, onQuote, quoteScope }: TextMenuProps): React.ReactNode {
	const { t } = useI18n();
	const [menu, setMenu] = useState<OpenMenu | undefined>(undefined);
	/** 量过尺寸之后的落点；没量到时先按光标位置画 */
	const [placed, setPlaced] = useState<{ left: number; top: number } | undefined>(undefined);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onContextMenu = (event: MouseEvent): void => {
			// 别处已经处理过这次右键，让给它
			if (event.defaultPrevented) {
				return;
			}
			const picked = readSelection(event.target, quoteScope);
			if (picked === undefined) {
				setMenu(undefined);
				return;
			}
			event.preventDefault();
			// 先按光标位置画，下一步再量尺寸收进窗口
			setPlaced(undefined);
			setMenu({
				x: event.clientX,
				y: event.clientY,
				text: picked.text,
				canQuote: picked.canQuote && onQuote !== undefined,
			});
		};
		document.addEventListener("contextmenu", onContextMenu);
		return () => document.removeEventListener("contextmenu", onContextMenu);
	}, [onQuote, quoteScope]);

	/** 收起菜单。 */
	const close = useCallback((): void => setMenu(undefined), []);

	// 菜单是浮层：点外面、按 Esc、页面滚动或改窗口大小都收起，打开后焦点落到第一项
	useEffect(() => {
		if (menu === undefined) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (target instanceof Element && target.closest(".text-menu") !== null) {
				return;
			}
			close();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				close();
			}
		};
		const frame = requestAnimationFrame(() => {
			menuRef.current?.querySelector("button")?.focus();
		});
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
		};
	}, [close, menu]);

	// 量出真实尺寸再收进窗口：光标贴在右下角时菜单要往回收，不能画到窗口外面
	useLayoutEffect(() => {
		if (menu === undefined) {
			setPlaced(undefined);
			return;
		}
		const node = menuRef.current;
		if (node === null) {
			return;
		}
		const edge = readLength("--text-menu-edge", 4);
		const rect = node.getBoundingClientRect();
		setPlaced({
			left: Math.max(edge, Math.min(menu.x, window.innerWidth - rect.width - edge)),
			top: Math.max(edge, Math.min(menu.y, window.innerHeight - rect.height - edge)),
		});
	}, [menu]);

	if (menu === undefined) {
		return null;
	}

	return (
		<div
			ref={menuRef}
			role="menu"
			aria-label={t("textMenu.label")}
			className="text-menu"
			style={{ left: placed?.left ?? menu.x, top: placed?.top ?? menu.y }}
			onContextMenu={(event) => event.preventDefault()}
		>
			<button
				type="button"
				role="menuitem"
				className="text-menu-item"
				onClick={() => {
					close();
					onCopy(menu.text);
				}}
			>
				<Copy size={13} strokeWidth={1.5} />
				<span>{t("textMenu.copy")}</span>
			</button>
			{menu.canQuote ? (
				<button
					type="button"
					role="menuitem"
					className="text-menu-item"
					onClick={() => {
						close();
						onQuote?.(menu.text);
					}}
				>
					<Quote size={13} strokeWidth={1.5} />
					<span>{t("textMenu.quote")}</span>
				</button>
			) : null}
		</div>
	);
}
