/**
 * 右侧栏浏览器标签：把主进程 `WebContentsView`（`bridge.browser`）接到 `BrowserPane`。
 *
 * 自动追踪右栏占位盒子的物理坐标与界面缩放，并在弹窗、下拉浮层或右栏拖动收起/滑移动画
 * 期间临时隐藏原生视图，防止底层原生窗口遮盖上层 React 界面。
 */
import { BrowserPane, type BrowserPaneState, type BrowserViewportBounds } from "@facet/ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { bridge } from "../../bridge.ts";

const INITIAL_STATE: BrowserPaneState = {
	url: "about:blank",
	title: "",
	canGoBack: false,
	canGoForward: false,
	isLoading: false,
};

const OCCLUSION_SELECTOR = [
	"dialog[open]",
	".host-pop",
	".sb-pop",
	".sb-context-menu",
	".tab-menu",
	".text-menu",
	".chip-pop",
	".ctx-pop",
	".app[data-panel-drag-collapsed='true']",
].join(", ");

export interface BrowserTabProps {
	/** 浏览器标签当前是否激活 */
	isActive: boolean;
	/** 上层明确告知正在被模态或拖拽遮挡 */
	isOccluded: boolean;
	/** 应用缩放百分比 */
	uiScale: number;
}

function hasDomOcclusion(): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	return document.querySelector(OCCLUSION_SELECTOR) !== null;
}

export function BrowserTab({ isActive, isOccluded, uiScale }: BrowserTabProps): ReactNode {
	const [state, setState] = useState<BrowserPaneState>(INITIAL_STATE);
	const [domOccluded, setDomOccluded] = useState<boolean>(() => hasDomOcclusion());
	const [panelTransitioning, setPanelTransitioning] = useState(false);

	useEffect(() => {
		const api = bridge.browser;
		if (api === undefined) {
			return;
		}
		return api.onState((next) => setState(next));
	}, []);

	// 组件卸载（如右栏暂时收起）时先隐藏原生视图，真正关掉标签时才在上层调用 dispose 销毁
	useEffect(() => {
		const api = bridge.browser;
		if (api === undefined) {
			return;
		}
		return () => {
			api.syncBounds({ x: 0, y: 0, width: 0, height: 0, visible: false });
		};
	}, []);

	// 监测任意弹层打开与右栏开合滑移过渡，期间先隐藏原生视图防遮挡与拖影
	useEffect(() => {
		if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
			return;
		}
		const check = (): void => setDomOccluded(hasDomOcclusion());
		const observer = new MutationObserver(check);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["open", "data-panel-drag-collapsed"],
		});
		const panel = document.querySelector(".panel");
		const onStart = (e: Event): void => {
			if (e.target === panel) setPanelTransitioning(true);
		};
		const onEnd = (e: Event): void => {
			if (e.target === panel) setPanelTransitioning(false);
		};
		panel?.addEventListener("transitionstart", onStart);
		panel?.addEventListener("transitionend", onEnd);
		panel?.addEventListener("transitioncancel", onEnd);
		return () => {
			observer.disconnect();
			panel?.removeEventListener("transitionstart", onStart);
			panel?.removeEventListener("transitionend", onEnd);
			panel?.removeEventListener("transitioncancel", onEnd);
		};
	}, []);

	const handleViewportChange = useCallback((bounds: BrowserViewportBounds) => {
		bridge.browser?.syncBounds(bounds);
	}, []);

	const handleNavigate = useCallback((url: string) => {
		setState((prev) => ({ ...prev, url }));
		bridge.browser?.navigate(url);
	}, []);

	return (
		<BrowserPane
			state={state}
			isActive={isActive}
			isOccluded={isOccluded || domOccluded || panelTransitioning}
			uiScale={uiScale}
			onNavigate={handleNavigate}
			onBack={() => bridge.browser?.back()}
			onForward={() => bridge.browser?.forward()}
			onReload={() => bridge.browser?.reload()}
			onStop={() => bridge.browser?.stop()}
			onOpenExternal={(url) => bridge.browser?.openExternal(url)}
			onViewportChange={handleViewportChange}
		/>
	);
}
