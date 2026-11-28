/**
 * 右侧栏内嵌浏览器的界面壳。
 *
 * 只负责地址栏、前进/后退/刷新/外链打开控件，以及测量下方占位容器的视口矩形并通过回调
 * 报告给宿主（桌面主进程将原生 `WebContentsView` 对齐贴在该容器矩形上）。
 */
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "../common/IconButton.tsx";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { isAllowedBrowserUrl, normalizeBrowserUrl } from "./browser-url.ts";

/** 浏览器视图的当前导航状态快照。 */
export interface BrowserPaneState {
	/** 当前页面地址 */
	url: string;
	/** 当前页面标题 */
	title: string;
	/** 是否可后退 */
	canGoBack: boolean;
	/** 是否可前进 */
	canGoForward: boolean;
	/** 是否正在加载 */
	isLoading: boolean;
}

/** 向宿主同步原生视图位置与显隐的参数。 */
export interface BrowserViewportBounds {
	/** 窗口内容区左偏移（DIP） */
	x: number;
	/** 窗口内容区顶偏移（DIP） */
	y: number;
	/** 宽度（DIP） */
	width: number;
	/** 高度（DIP） */
	height: number;
	/** 此刻是否应显示原生视图（非活跃、被弹窗遮挡或宽高为 0 时为 false） */
	visible: boolean;
}

export interface BrowserPaneProps {
	/** 当前页面导航状态 */
	state: BrowserPaneState;
	/** 浏览器标签此刻是否处于激活可见态 */
	isActive: boolean;
	/** 是否被全局弹窗/浮层/拖拽收起遮挡 */
	isOccluded?: boolean;
	/** 应用缩放百分比（例如 100 / 125），用于 CSS px 与 DIP 换算 */
	uiScale?: number;
	/** 导航到新地址 */
	onNavigate: (url: string) => void;
	/** 后退 */
	onBack: () => void;
	/** 前进 */
	onForward: () => void;
	/** 刷新当前页 */
	onReload: () => void;
	/** 停止加载 */
	onStop: () => void;
	/** 在系统默认浏览器中打开 */
	onOpenExternal: (url: string) => void;
	/** 占位视口坐标、尺寸或显隐变化时通知宿主 */
	onViewportChange: (bounds: BrowserViewportBounds) => void;
}

export function BrowserPane({
	state,
	isActive,
	isOccluded = false,
	uiScale = 100,
	onNavigate,
	onBack,
	onForward,
	onReload,
	onStop,
	onOpenExternal,
	onViewportChange,
}: BrowserPaneProps): ReactNode {
	const { t } = useI18n();
	const [inputUrl, setInputUrl] = useState(state.url);
	const [editing, setEditing] = useState(false);
	const viewportRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!editing) {
			setInputUrl(state.url);
		}
	}, [editing, state.url]);

	const syncViewport = useCallback(() => {
		const el = viewportRef.current;
		if (el === null) {
			onViewportChange({ x: 0, y: 0, width: 0, height: 0, visible: false });
			return;
		}
		const rect = el.getBoundingClientRect();
		const scale = uiScale > 0 ? uiScale / 100 : 1;
		const visible = isActive && !isOccluded && rect.width > 1 && rect.height > 1;
		onViewportChange({
			x: Math.round(rect.left * scale),
			y: Math.round(rect.top * scale),
			width: Math.round(rect.width * scale),
			height: Math.round(rect.height * scale),
			visible,
		});
	}, [isActive, isOccluded, onViewportChange, uiScale]);

	useEffect(() => {
		syncViewport();
		const el = viewportRef.current;
		if (el === null || typeof ResizeObserver === "undefined") {
			return;
		}
		const observer = new ResizeObserver(syncViewport);
		observer.observe(el);
		window.addEventListener("resize", syncViewport);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", syncViewport);
		};
	}, [syncViewport]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		const target = normalizeBrowserUrl(inputUrl);
		if (target === undefined) {
			return;
		}
		setEditing(false);
		onNavigate(target);
	};

	const canOpenExternal = isAllowedBrowserUrl(state.url) && state.url !== "about:blank";

	return (
		<div className="browser-pane">
			<form className="browser-bar" onSubmit={handleSubmit}>
				<IconButton
					variant="ghost"
					size="sm"
					type="button"
					aria-label={t("browser.back")}
					disabled={!state.canGoBack}
					onClick={onBack}
				>
					<ArrowLeft size={ICON_SIZE.md} />
				</IconButton>
				<IconButton
					variant="ghost"
					size="sm"
					type="button"
					aria-label={t("browser.forward")}
					disabled={!state.canGoForward}
					onClick={onForward}
				>
					<ArrowRight size={ICON_SIZE.md} />
				</IconButton>
				<IconButton
					variant="ghost"
					size="sm"
					type="button"
					aria-label={state.isLoading ? t("browser.stop") : t("browser.reload")}
					onClick={state.isLoading ? onStop : onReload}
				>
					{state.isLoading ? <X size={ICON_SIZE.md} /> : <RotateCw size={ICON_SIZE.md} />}
				</IconButton>
				<Input
					size="sm"
					className="browser-url mono"
					value={inputUrl}
					placeholder={t("browser.urlPlaceholder")}
					aria-label={t("browser.urlPlaceholder")}
					onFocus={(event) => {
						setEditing(true);
						event.currentTarget.select();
					}}
					onBlur={() => setEditing(false)}
					onChange={(event) => setInputUrl(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape" && !isComposingKey(event)) {
							setEditing(false);
							setInputUrl(state.url);
							event.currentTarget.blur();
						}
					}}
				/>
				<IconButton
					variant="ghost"
					size="sm"
					type="button"
					aria-label={t("browser.openExternal")}
					disabled={!canOpenExternal}
					onClick={() => onOpenExternal(state.url)}
				>
					<ExternalLink size={ICON_SIZE.md} />
				</IconButton>
			</form>
			<div
				className={state.isLoading ? "browser-progress is-loading" : "browser-progress"}
				aria-hidden="true"
			/>
			<div className="browser-viewport" ref={viewportRef} />
		</div>
	);
}
