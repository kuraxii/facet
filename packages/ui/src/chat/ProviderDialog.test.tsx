/**
 * 提供方弹窗的测试。
 *
 * 查两条与模型清单有关的路径：勾好的思考档位有没有被交上去「保存」，以及从上游拉模型时同一
 * 标识的行会不会按拉回来的那份重写、新模型追加在后面。
 */
import type { CustomProviderInfo, ProviderInfo, UpstreamModel } from "@facet/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import { ProviderDialog } from "./ProviderDialog.tsx";
import type { ProviderRow } from "./provider-rows.ts";
import type { SettingsDataSource } from "./settings-data-source.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

/** 自定义提供方的一行。 */
const custom: CustomProviderInfo = {
	id: "aimao",
	name: "aimao",
	baseUrl: "https://gateway.example.com/v1",
	api: "openai-completions",
	models: [
		{
			id: "deepseek-flash",
			name: "DeepSeek V4.1 Flash 1017",
			thinkingLevels: ["off", "high"],
			input: ["text", "image"],
		},
	],
};

const provider: ProviderInfo = {
	id: "aimao",
	name: "aimao",
	authenticated: true,
	modelCount: 1,
};

/** 只会被调用到的那几个方法，其余给不动的桩。 */
function fakeData(overrides: Partial<SettingsDataSource> = {}): SettingsDataSource {
	const off = async (): Promise<never> => {
		throw new Error("不该调用");
	};
	return {
		loadSettings: off,
		saveSettings: off,
		loadAgentDefaults: async () => ({}),
		saveAgentDefaults: async () => ({}),
		loadProviders: async () => [provider],
		loadModels: async () => [],
		saveCredential: async () => [provider],
		deleteCredential: async () => [provider],
		providerLogin: () => undefined,
		subscribeProviderLogin: () => () => {},
		startProviderLogin: async () => "",
		respondProviderLogin: async () => false,
		cancelProviderLogin: async () => false,
		fetchProviderModels: async () => ({ models: [], baseUrl: "" }),
		listCustomProviders: async () => [custom],
		saveCustomProvider: async () => [custom],
		removeCustomProvider: async () => [],
		testModel: async () => ({ ok: true, latencyMs: 0 }),
		diagnostics: async () => "",
		saveText: async () => false,
		...overrides,
	};
}

/** 挂一个弹窗。 */
function mountDialog(data: SettingsDataSource): void {
	const row: ProviderRow = { provider, custom };
	act(() => {
		root.render(
			<I18nProvider language="zh-CN">
				<ProviderDialog row={row} models={[]} data={data} onChanged={() => {}} onClose={() => {}} />
			</I18nProvider>,
		);
	});
}

/** 按文字找按钮。 */
function button(text: string): HTMLButtonElement | undefined {
	return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
		(item) => item.textContent?.trim() === text,
	);
}

describe("提供方弹窗里的模型清单", () => {
	it("勾好的思考档位跟着保存一起交上去", async () => {
		let saved: CustomProviderInfo | undefined;
		const data = fakeData({
			saveCustomProvider: async (input) => {
				saved = input;
				return [input];
			},
		});
		mountDialog(data);

		expect(container.querySelector(".prov-levels-value")?.textContent).toBe("high");
		const low = container.querySelector<HTMLInputElement>('[data-level="low"] input');
		act(() => low?.click());
		expect(container.querySelector(".prov-levels-value")?.textContent).toBe("high");

		await act(async () => button("保存")?.click());
		expect(saved?.models[0]).toEqual({
			id: "deepseek-flash",
			name: "DeepSeek V4.1 Flash 1017",
			thinkingLevels: ["off", "low", "high"],
			input: ["text", "image"],
		});
	});

	it("图片勾选框默认按模型现在的能力显示，勾掉之后保存成只收文字", async () => {
		let saved: CustomProviderInfo | undefined;
		const data = fakeData({
			saveCustomProvider: async (input) => {
				saved = input;
				return [input];
			},
		});
		mountDialog(data);

		const image = container.querySelector<HTMLInputElement>(".prov-flag input");
		expect(image?.checked).toBe(true);
		act(() => image?.click());
		await act(async () => button("保存")?.click());
		expect(saved?.models[0]?.input).toEqual(["text"]);
	});

	it("从上游拉模型：同标识的那行整行重写,新模型补在后面", async () => {
		const fetched: UpstreamModel[] = [
			{
				id: "deepseek-flash",
				name: "DeepSeek Flash",
				contextWindow: 1048576,
				maxTokens: 393216,
				thinkingLevels: ["off", "low", "high", "max"],
				input: ["text", "image"],
			},
			{ id: "glm-5.3", name: "GLM 5.3", contextWindow: 200000, maxTokens: 64000 },
		];
		let saved: CustomProviderInfo | undefined;
		const data = fakeData({
			fetchProviderModels: async () => ({ models: fetched, baseUrl: custom.baseUrl }),
			saveCustomProvider: async (input) => {
				saved = input;
				return [input];
			},
		});
		mountDialog(data);

		await act(async () => button("从上游获取")?.click());
		await act(async () => button("保存")?.click());

		expect(saved?.models).toEqual([
			{
				id: "deepseek-flash",
				name: "DeepSeek Flash",
				contextWindow: 1048576,
				maxTokens: 393216,
				thinkingLevels: ["off", "low", "high", "max"],
				input: ["text", "image"],
			},
			{ id: "glm-5.3", name: "GLM 5.3", contextWindow: 200000, maxTokens: 64000 },
		]);
	});

	it("拉回来的模型已经在表里时不重复加行", async () => {
		const data = fakeData({
			fetchProviderModels: async () => ({ models: [{ id: "deepseek-flash" }], baseUrl: "" }),
		});
		mountDialog(data);

		await act(async () => button("从上游获取")?.click());
		expect(container.querySelectorAll(".prov-model")).toHaveLength(1);
	});
});
