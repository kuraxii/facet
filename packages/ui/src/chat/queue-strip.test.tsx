// @vitest-environment jsdom
/**
 * 后续消息卡片与排队条测试。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { QueueStrip } from "./QueueStrip.tsx";

let unmount: (() => void) | undefined;

beforeAll(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	act(() => unmount?.());
	unmount = undefined;
	document.body.innerHTML = "";
});

describe("QueueStrip 后续消息卡片", () => {
	it("渲染后续消息卡片并触发转插话、编辑与删除回调", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const onPromoteFollowUp = vi.fn();
		const onEditFollowUp = vi.fn();
		const onRemoveFollowUp = vi.fn();

		const root = createRoot(container);
		act(() => {
			root.render(
				<I18nProvider language="zh-CN">
					<QueueStrip
						queued={{ steering: [], followUp: ["后续任务 A", "后续任务 B"] }}
						onClear={() => {}}
						onPromoteFollowUp={onPromoteFollowUp}
						onEditFollowUp={onEditFollowUp}
						onRemoveFollowUp={onRemoveFollowUp}
					/>
				</I18nProvider>,
			);
		});
		unmount = () => root.unmount();

		expect(container.textContent).toContain("后续消息");
		expect(container.textContent).toContain("2");
		expect(container.textContent).toContain("后续任务 A");
		expect(container.textContent).toContain("后续任务 B");

		const promoteButtons = container.querySelectorAll<HTMLButtonElement>(
			'button[aria-label="转为插话立即发送"]',
		);
		const editButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label="编辑"]');
		const removeButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label="删除"]');

		act(() => {
			promoteButtons[1]?.click();
			editButtons[0]?.click();
			removeButtons[1]?.click();
		});

		expect(onPromoteFollowUp).toHaveBeenCalledWith(1);
		expect(onEditFollowUp).toHaveBeenCalledWith(0);
		expect(onRemoveFollowUp).toHaveBeenCalledWith(1);
	});
});
