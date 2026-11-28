/**
 * 主区顶栏外部打开拆分按钮：左半默认图标（VS Code 或系统文件管理器）直达打开，
 * 右侧下拉箭头弹出可选方式菜单并记住用户最近一次的选择。
 */
import { ChevronDown, FolderOpen } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { ListRow } from "../common/ListRow.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE, VISUAL_PX } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import type { ExternalOpenTarget } from "./file-tree-state.ts";

/** 外部打开拆分按钮参数。 */
export interface ExternalOpenButtonProps {
	/** 当前默认选中的外部打开方式 */
	target?: ExternalOpenTarget;
	/** 是否允许使用 VS Code 打开（仅本机桌面端支持） */
	canOpenVsCode?: boolean;
	/** 是否允许在文件管理器中显示 */
	canReveal?: boolean;
	/** 点击主按钮或选择菜单项时回调 */
	onOpen: (target: ExternalOpenTarget) => void;
}

/** VS Code 简洁折带图标。 */
function VsCodeIcon({ className }: { className?: string }): ReactNode {
	return (
		<svg
			width={ICON_SIZE.md}
			height={ICON_SIZE.md}
			viewBox="0 0 24 24"
			fill="currentColor"
			className={className}
			aria-hidden="true"
		>
			<path d="M17.583 2.24a1.25 1.25 0 0 1 1.38.22l2.62 2.38c.265.24.417.582.417.94v12.44c0 .358-.152.7-.417.94l-2.62 2.38a1.25 1.25 0 0 1-1.918-.282l-6.612-6.11-4.38 3.314a.9.9 0 0 1-1.158-.068l-1.56-1.418a.9.9 0 0 1-.01-1.324L6.99 12 3.345 8.348a.9.9 0 0 1 .01-1.324L4.915 5.606a.9.9 0 0 1 1.158-.068l4.38 3.314 6.612-6.11a1.25 1.25 0 0 1 .518-.502Zm.417 4.41-4.96 3.75v3.2l4.96 3.75V6.65Z" />
		</svg>
	);
}

const MENU_EDGE = VISUAL_PX.popover.menuEdge;
const MENU_OFFSET = VISUAL_PX.popover.menuOffset;

/**
 * 外部打开拆分按钮。
 *
 * 没有任何可用打开方式时直接返回 `null`；只有某一种可用时自动把主按钮回落到该方式。
 */
export function ExternalOpenButton({
	target = "vscode",
	canOpenVsCode = true,
	canReveal = true,
	onOpen,
}: ExternalOpenButtonProps): ReactNode {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [menuOpen, setMenuOpen] = useState(false);
	const [placed, setPlaced] = useState<{ left: number; top: number } | undefined>(undefined);
	const caretRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	const closeMenu = useCallback((restoreFocus: boolean): void => {
		setMenuOpen(false);
		setPlaced(undefined);
		if (restoreFocus) {
			caretRef.current?.focus();
		}
	}, []);

	useEffect(() => {
		if (!menuOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			const hit = event.target;
			if (hit instanceof Element && hit.closest(".chrome-open-menu") !== null) {
				return;
			}
			if (hit instanceof Element && hit.closest(".chrome-open-btn.is-caret") !== null) {
				return;
			}
			closeMenu(false);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			closeMenu(true);
		};
		const onResize = (): void => closeMenu(false);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("resize", onResize);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("resize", onResize);
		};
	}, [closeMenu, menuOpen]);

	useLayoutEffect(() => {
		if (!menuOpen) {
			setPlaced(undefined);
			return;
		}
		const anchor = caretRef.current;
		const menu = menuRef.current;
		if (anchor === null || menu === null) {
			return;
		}
		const anchorRect = anchor.getBoundingClientRect();
		const rect = menu.getBoundingClientRect();
		setPlaced({
			left: Math.max(
				MENU_EDGE,
				Math.min(anchorRect.right - rect.width, window.innerWidth - rect.width - MENU_EDGE),
			),
			top: Math.max(
				MENU_EDGE,
				Math.min(anchorRect.bottom + MENU_OFFSET, window.innerHeight - rect.height - MENU_EDGE),
			),
		});
	}, [menuOpen]);

	if (!canOpenVsCode && !canReveal) {
		return null;
	}

	const resolvedTarget: ExternalOpenTarget =
		target === "vscode" && !canOpenVsCode ? "reveal" : target === "reveal" && !canReveal ? "vscode" : target;

	const menuStyle =
		placed === undefined
			? undefined
			: ({ left: `${placed.left}px`, top: `${placed.top}px` } as CSSProperties);

	const mainLabel = resolvedTarget === "vscode" ? t("editor.openInVsCode") : t("editor.openInFileManager");

	return (
		<>
			<div className="chrome-open-split">
				<button
					type="button"
					className="chrome-open-btn is-main"
					aria-label={mainLabel}
					{...tip.handlers(mainLabel)}
					onClick={() => onOpen(resolvedTarget)}
				>
					{resolvedTarget === "vscode" ? (
						<VsCodeIcon className="chrome-open-vscode-icon" />
					) : (
						<FolderOpen size={ICON_SIZE.md} />
					)}
				</button>
				<button
					ref={caretRef}
					type="button"
					className="chrome-open-btn is-caret"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					aria-label={t("editor.openMenu")}
					onClick={() => {
						if (menuOpen) {
							closeMenu(true);
							return;
						}
						setPlaced(undefined);
						setMenuOpen(true);
					}}
				>
					<ChevronDown size={ICON_SIZE.sm} />
				</button>
			</div>

			{!menuOpen
				? null
				: createPortal(
						<div
							ref={menuRef}
							className="chrome-open-menu"
							role="menu"
							aria-label={t("editor.openMenu")}
							style={{ ...menuStyle, visibility: placed === undefined ? "hidden" : undefined }}
						>
							{canOpenVsCode ? (
								<ListRow
									as="button"
									variant="menu"
									role="menuitem"
									className="chrome-open-menu-item"
									onClick={() => {
										closeMenu(true);
										onOpen("vscode");
									}}
								>
									<VsCodeIcon className="chrome-open-vscode-icon" />
									<span className="chrome-open-menu-label">{t("editor.openInVsCode")}</span>
								</ListRow>
							) : null}
							{canReveal ? (
								<ListRow
									as="button"
									variant="menu"
									role="menuitem"
									className="chrome-open-menu-item"
									onClick={() => {
										closeMenu(true);
										onOpen("reveal");
									}}
								>
									<FolderOpen size={ICON_SIZE.md} />
									<span className="chrome-open-menu-label">{t("editor.openInFileManager")}</span>
								</ListRow>
							) : null}
						</div>,
						document.body,
					)}

			{tip.render()}
		</>
	);
}
