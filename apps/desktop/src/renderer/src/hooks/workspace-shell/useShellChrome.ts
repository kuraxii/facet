/**
 * 外壳的「呈现」部分：聊天 / 设置视图、设置分节、会话搜索、界面缩放与外观。
 *
 * 这一块与档位、抽屉、右栏都没有关系，只跟着设置与窗口走；放成一个叶子 Hook，门面就只剩
 * 接线。
 */
import type { AppearanceSettings } from "@facet/protocol";
import {
	type CodeThemeValue,
	isDarkTheme,
	normalizeUiScale,
	resolveUiTheme,
	type SettingsSection,
	stepUiScale,
} from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../../bridge.ts";
import { prefersLight } from "./appearance.ts";

/** 缩放浮层的停留时间，毫秒。 */
const ZOOM_BADGE_MS = 1200;

/** 外壳呈现的对外形状。 */
export interface ShellChrome {
	/** 会话搜索框是否展开 */
	isSearchOpen: boolean;
	/** 主区域显示对话还是设置 */
	view: "chat" | "settings";
	/** 设置页停在哪一节 */
	settingsSection: SettingsSection;
	/** 本机界面缩放百分比 */
	uiScale: number;
	/** 缩放变化后短暂显示的百分比浮层 */
	zoomBadge: number | undefined;
	/** 代码块主题，浅色与深色各取一份 */
	codeTheme: CodeThemeValue;
	/** 展开或收起会话搜索 */
	setSearchOpen: (open: boolean) => void;
	/** 换设置页的分节 */
	setSettingsSection: (section: SettingsSection) => void;
	/** 打开设置视图 */
	openSettings: () => void;
	/** 回到对话视图 */
	closeSettings: () => void;
	/** 应用本机界面缩放 */
	changeUiScale: (next: number) => void;
}

export function useShellChrome(appearance: AppearanceSettings): ShellChrome {
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [view, setView] = useState<"chat" | "settings">("chat");
	const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
	const [uiScale, setUiScale] = useState(bridge.uiScale);
	const [zoomBadge, setZoomBadge] = useState<number | undefined>(undefined);
	/** 缩放浮层的定时器 */
	const zoomBadgeTimer = useRef<number | undefined>(undefined);

	// ⌘K 打开会话搜索，与页脚提示的快捷键一致
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setIsSearchOpen(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	/** 应用本机界面缩放并让窗口重新测量。 */
	const changeUiScale = useCallback((next: number) => {
		const scale = normalizeUiScale(next);
		setUiScale(scale);
		bridge.setUiScale?.(scale);
		setZoomBadge(scale);
		if (zoomBadgeTimer.current !== undefined) window.clearTimeout(zoomBadgeTimer.current);
		zoomBadgeTimer.current = window.setTimeout(() => setZoomBadge(undefined), ZOOM_BADGE_MS);
		window.requestAnimationFrame(() => window.dispatchEvent(new Event("facet:zoom-changed")));
	}, []);

	// 界面缩放快捷键：Mod+= / Mod+- / Mod+0；0 回到 100%
	useEffect(() => {
		if (bridge.platform === "web") return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
			if (event.key === "0") {
				event.preventDefault();
				changeUiScale(100);
				return;
			}
			const direction =
				event.key === "=" || event.key === "+" ? 1 : event.key === "-" || event.key === "_" ? -1 : 0;
			if (direction === 0) return;
			event.preventDefault();
			changeUiScale(stepUiScale(uiScale, direction));
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [changeUiScale, uiScale]);

	useEffect(() => {
		return () => {
			if (zoomBadgeTimer.current !== undefined) window.clearTimeout(zoomBadgeTimer.current);
		};
	}, []);

	// Electron zoom 改变时 devicePixelRatio 跟着变；通知 xterm 与 CodeMirror 重新量字符网格
	useEffect(() => {
		let query: MediaQueryList | undefined;
		let dispose: (() => void) | undefined;
		const watch = (): void => {
			dispose?.();
			query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
			const onChange = (): void => {
				window.dispatchEvent(new Event("facet:zoom-changed"));
				watch();
			};
			query.addEventListener("change", onChange, { once: true });
			dispose = () => query?.removeEventListener("change", onChange);
		};
		watch();
		return () => dispose?.();
	}, []);

	const setSearchOpen = useCallback((open: boolean) => setIsSearchOpen(open), []);
	const openSettings = useCallback(() => setView("settings"), []);
	const closeSettings = useCallback(() => setView("chat"), []);

	/** 代码块主题跟着本机外观走，浅色与深色分别取一份。 */
	const codeTheme = useMemo(
		() => ({
			theme: appearance.codeTheme,
			isDark: isDarkTheme(resolveUiTheme(appearance.theme, prefersLight())),
		}),
		[appearance.codeTheme, appearance.theme],
	);

	return {
		isSearchOpen,
		view,
		settingsSection,
		uiScale,
		zoomBadge,
		codeTheme,
		setSearchOpen,
		setSettingsSection,
		openSettings,
		closeSettings,
		changeUiScale,
	};
}
