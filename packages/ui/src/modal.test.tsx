// @vitest-environment jsdom
/**
 * 模态弹层退场挂载测试：关闭时先挂 `data-closing="true"` 播放退场动画，结束后再关闭与卸载。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal, useModalPresence } from "./modal.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function Host({ open }: { open: boolean }) {
	const mounted = useModalPresence(open);
	if (!mounted) {
		return null;
	}
	return (
		<Modal open={open} onClose={() => {}} label="设置">
			content
		</Modal>
	);
}

function renderHost(open: boolean): void {
	if (container === undefined) {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	}
	act(() => {
		root?.render(<Host open={open} />);
	});
}

afterEach(() => {
	vi.useRealTimers();
	document.documentElement.style.removeProperty("--dur-slow");
	act(() => root?.unmount());
	root = undefined;
	container?.remove();
	container = undefined;
});

describe("Modal 退场动画与挂载", () => {
	it("带 --dur-slow 时先保留 dialog 打开并挂 data-closing，播完后才卸载", () => {
		vi.useFakeTimers();
		document.documentElement.style.setProperty("--dur-slow", "180ms");

		renderHost(true);
		const dialog = container?.querySelector<HTMLDialogElement>("dialog.dialog");
		expect(dialog?.open).toBe(true);
		expect(dialog?.getAttribute("data-closing")).toBeNull();

		renderHost(false);
		expect(dialog?.isConnected).toBe(true);
		expect(dialog?.open).toBe(true);
		expect(dialog?.getAttribute("data-closing")).toBe("true");

		act(() => {
			vi.advanceTimersByTime(179);
		});
		expect(container?.querySelector("dialog")).toBe(dialog);

		act(() => {
			vi.advanceTimersByTime(30);
		});
		expect(container?.querySelector("dialog")).toBeNull();
	});
});
