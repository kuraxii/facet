/**
 * 设置窗的测试。
 *
 * 检查它按对话框语义渲染：遮罩、modal 标记、可聚焦的窗口本身。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

const markup = renderToStaticMarkup(
	<I18nProvider language="zh-CN">
		<SettingsPage
			section="appearance"
			onSectionChange={() => {}}
			onClose={() => {}}
			languageSetting="auto"
			onLanguageChange={() => {}}
			data={{
				loadSettings: async () => {
					throw new Error("不该在渲染时读设置");
				},
				saveSettings: async () => {
					throw new Error("不该在渲染时写设置");
				},
				loadModels: async () => [],
				loadProviders: async () => [],
				testModel: async () => ({ ok: true, latencyMs: 0 }),
				loadAgentDefaults: async () => ({}),
				saveAgentDefaults: async () => ({}),
				diagnostics: async () => "",
				saveText: async () => false,
				saveCredential: async () => [],
				deleteCredential: async () => [],
				fetchProviderModels: async () => ({ models: [], baseUrl: "" }),
				listCustomProviders: async () => [],
				saveCustomProvider: async () => [],
				removeCustomProvider: async () => [],
			}}
			about={{ appVersion: "0.0.0", runtime: "test", endpoint: "ws://127.0.0.1:1/endpoint" }}
		/>
	</I18nProvider>,
);

describe("设置窗", () => {
	it("渲染成原生 dialog，遮罩与焦点交给浏览器", () => {
		expect(markup).toContain("<dialog");
		expect(markup).toContain('aria-label="设置"');
		// 原生模态弹层自带这些语义，自己再写一遍会互相打架
		expect(markup).not.toContain('role="dialog"');
		expect(markup).not.toContain("aria-modal");
	});

	it("标题栏带关闭按钮", () => {
		expect(markup).toContain('aria-label="关闭设置"');
	});

	it("外观页提供语言选择", () => {
		expect(markup).toContain('aria-label="语言"');
		expect(markup).toContain("跟随系统");
	});
});
