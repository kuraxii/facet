/**
 * 设置窗的测试。
 *
 * 检查它按对话框语义渲染：遮罩、modal 标记、可聚焦的窗口本身。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "./SettingsPage.tsx";

const markup = renderToStaticMarkup(
	createElement(SettingsPage, {
		section: "appearance" as const,
		onSectionChange: () => {},
		onClose: () => {},
		data: {
			loadSettings: async () => {
				throw new Error("不该在渲染时读设置");
			},
			saveSettings: async () => {
				throw new Error("不该在渲染时写设置");
			},
			loadModels: async () => [],
			loadProviders: async () => [],
			testModel: async () => ({ ok: true, latencyMs: 0 }),
			diagnostics: async () => "",
			saveText: async () => false,
			saveCredential: async () => [],
			deleteCredential: async () => [],
			setProviderBaseUrl: async () => [],
			listCustomProviders: async () => [],
			saveCustomProvider: async () => [],
			removeCustomProvider: async () => [],
		},
		about: { appVersion: "0.0.0", runtime: "test", endpoint: "ws://127.0.0.1:1/endpoint" },
	}),
);

describe("设置窗", () => {
	it("渲染成带遮罩的对话框，窗口本身可聚焦", () => {
		expect(markup).toContain('class="dialog-backdrop"');
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup).toContain('aria-label="设置"');
		expect(markup).toContain('tabindex="-1"');
	});

	it("标题栏带关闭按钮", () => {
		expect(markup).toContain('aria-label="关闭设置"');
	});
});
