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
				loadTerminalProfiles: async () => [],
				loadAgentDefaults: async () => ({}),
				saveAgentDefaults: async () => ({}),
				diagnostics: async () => "",
				saveText: async () => false,
				saveCredential: async () => [],
				deleteCredential: async () => [],
				providerLogin: () => undefined,
				subscribeProviderLogin: () => () => {},
				startProviderLogin: async () => "",
				respondProviderLogin: async () => false,
				cancelProviderLogin: async () => false,
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

	it("标题栏带关闭按钮，两段式布局在右侧头部展示当前分类标题", () => {
		expect(markup).toContain('aria-label="关闭设置"');
		expect(markup).toContain('<h2 class="set-main-title">外观</h2>');
	});

	it("外观页提供语言选择", () => {
		expect(markup).toContain('aria-label="语言"');
		expect(markup).toContain("跟随系统");
	});

	it("传入本地外观配置时不受 canEdit 限制且直接渲染本地外观控件", () => {
		const localMarkup = renderToStaticMarkup(
			<I18nProvider language="zh-CN">
				<SettingsPage
					section="appearance"
					onSectionChange={() => {}}
					onClose={() => {}}
					canEdit={false}
					localAppearance={{
						theme: "claude",
						codeTheme: "github",
						codeFont: "",
						editorFont: "",
						editorFontSize: 13,
						terminalFont: "",
						terminalFontSize: 12.5,
						reducedMotion: false,
						liveMotion: "pulse",
						outlineScale: 100,
					}}
					onLocalAppearanceChange={() => {}}
					data={{
						loadSettings: async () => {
							throw new Error("本地外观不应触发加载主机设置");
						},
						saveSettings: async () => {
							throw new Error("本地外观不应触发保存主机设置");
						},
						loadModels: async () => [],
						loadProviders: async () => [],
						testModel: async () => ({ ok: true, latencyMs: 0 }),
						loadTerminalProfiles: async () => [],
						loadAgentDefaults: async () => ({}),
						saveAgentDefaults: async () => ({}),
						diagnostics: async () => "",
						saveText: async () => false,
						saveCredential: async () => [],
						deleteCredential: async () => [],
						providerLogin: () => undefined,
						subscribeProviderLogin: () => () => {},
						startProviderLogin: async () => "",
						respondProviderLogin: async () => false,
						cancelProviderLogin: async () => false,
						fetchProviderModels: async () => ({ models: [], baseUrl: "" }),
						listCustomProviders: async () => [],
						saveCustomProvider: async () => [],
						removeCustomProvider: async () => [],
					}}
					about={{ appVersion: "0.0.0", runtime: "test", endpoint: "ws://127.0.0.1:1/endpoint" }}
				/>
			</I18nProvider>,
		);
		expect(localMarkup).toContain("Claude");
		expect(localMarkup).not.toContain('<fieldset class="set-lock" disabled');
	});
});
