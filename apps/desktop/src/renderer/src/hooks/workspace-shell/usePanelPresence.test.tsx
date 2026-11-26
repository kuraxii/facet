// @vitest-environment jsdom
/**
 * `usePanelPresence` 的生命周期单测。
 */
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelPresence } from "./panel-presence.ts";
import { usePanelPresence } from "./usePanelPresence.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let latest: PanelPresence | undefined;
let appNode: HTMLDivElement | undefined;

function Probe({ visible }: { visible: boolean }) {
	const shellRef = useRef<HTMLDivElement | null>(null);
	latest = usePanelPresence(visible, shellRef);
	return createElement(
		"div",
		{ className: "app" },
		createElement("div", { ref: shellRef, className: "shell" }),
	);
}

function render(visible: boolean): void {
	if (root === undefined) {
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	}
	act(() => {
		root?.render(createElement(Probe, { visible }));
	});
	appNode = document.querySelector<HTMLDivElement>(".app") ?? undefined;
}

beforeEach(() => {
	vi.useFakeTimers();
	document.documentElement.style.setProperty("--dur-structural", "320ms");
});

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	latest = undefined;
	appNode = undefined;
	document.body.innerHTML = "";
	document.documentElement.style.removeProperty("--dur-structural");
	document.documentElement.removeAttribute("data-window-resizing");
	vi.useRealTimers();
});

describe("usePanelPresence", () => {
	it("关闭前等待过渡完成再卸载，打开时立刻进入过渡并在结束后落定", () => {
		render(false);
		expect(latest).toEqual({ phase: "closed", mounted: false, isAnimating: false });

		render(true);
		expect(latest).toEqual({ phase: "entering", mounted: true, isAnimating: true });

		act(() => {
			vi.advanceTimersByTime(380);
		});
		expect(latest).toEqual({ phase: "open", mounted: true, isAnimating: false });

		render(false);
		expect(latest).toEqual({ phase: "closing", mounted: true, isAnimating: true });

		// 关闭中途再次打开，立即反切回进场而不经过 closed
		render(true);
		expect(latest).toEqual({ phase: "entering", mounted: true, isAnimating: true });

		act(() => {
			vi.advanceTimersByTime(380);
		});
		expect(latest?.phase).toBe("open");

		// 监听 `.app` 上网格轨道的 `transitionend` 提前落定
		render(false);
		expect(latest?.phase).toBe("closing");
		act(() => {
			vi.advanceTimersByTime(310);
			const event = new Event("transitionend");
			Object.defineProperty(event, "propertyName", { value: "grid-template-columns" });
			appNode?.dispatchEvent(event);
		});
		expect(latest).toEqual({ phase: "closed", mounted: false, isAnimating: false });
	});

	it("无动效时长或窗口缩放冻结期间跳过异步等待", () => {
		document.documentElement.style.setProperty("--dur-structural", "0ms");
		render(true);
		expect(latest).toEqual({ phase: "open", mounted: true, isAnimating: false });

		render(false);
		expect(latest).toEqual({ phase: "closed", mounted: false, isAnimating: false });
	});
});
