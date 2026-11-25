// @vitest-environment jsdom
/**
 * 设置页的终端分节。
 *
 * 只验这一节自己的行为：主机报上来的几种 shell 怎么进下拉、选中的值怎么回到草稿、设置里留着
 * 一个本机没有的标识时界面显示什么。读失败要走原地说事实加重试的那条路。
 */

import type { FacetSettings, TerminalProfileInfo } from "@facet/protocol";
import { DEFAULT_SETTINGS } from "@facet/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider.tsx";
import type { SettingsDataSource } from "./settings-data-source.ts";
import { TerminalSection } from "./settings-terminal-section.tsx";

const PROFILES: TerminalProfileInfo[] = [
	{ id: "pwsh", label: "PowerShell 7", path: "C:\\pwsh.exe" },
	{ id: "git-bash", label: "Git Bash", path: "C:\\bash.exe" },
];

/** 只用到读清单这一条，其余给不动的桩。 */
function fakeData(load = async (): Promise<TerminalProfileInfo[]> => PROFILES): SettingsDataSource {
	const off = async (): Promise<never> => {
		throw new Error("不该调用");
	};
	return {
		loadTerminalProfiles: load,
		loadSettings: off,
		saveSettings: off,
		loadAgentDefaults: off,
		saveAgentDefaults: off,
		loadProviders: async () => [],
		loadModels: async () => [],
		saveCredential: off,
		deleteCredential: off,
		providerLogin: () => undefined,
		subscribeProviderLogin: () => () => {},
		startProviderLogin: off,
		respondProviderLogin: off,
		cancelProviderLogin: off,
		fetchProviderModels: off,
		listCustomProviders: async () => [],
		saveCustomProvider: off,
		removeCustomProvider: off,
		testModel: off,
		diagnostics: async () => "",
		saveText: async () => false,
	};
}

let unmount: (() => void) | undefined;

beforeAll(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	act(() => unmount?.());
	unmount = undefined;
	document.body.innerHTML = "";
});

/** 挂这一节，返回它渲染出来的 select 与最后一次 patch 之后的那份设置。 */
function mount(current: FacetSettings = structuredClone(DEFAULT_SETTINGS)): {
	container: HTMLDivElement;
	settings: () => FacetSettings;
	select: () => HTMLSelectElement | null;
} {
	const container = document.createElement("div");
	document.body.append(container);
	let draft = current;
	const root = createRoot(container);
	const render = (): void => {
		act(() => {
			root.render(
				<I18nProvider language="zh-CN">
					<TerminalSection
						draft={draft}
						patch={(change) => {
							draft = change(draft);
							render();
						}}
						data={fakeData()}
					/>
				</I18nProvider>,
			);
		});
	};
	render();
	unmount = () => root.unmount();
	return {
		container,
		settings: () => draft,
		select: () => container.querySelector("select"),
	};
}

/** 等一次微任务，让读清单那一条回来。 */
async function settle(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
	});
}

describe("终端设置分节", () => {
	it("「自动」排在最前，后面是主机报的几种", async () => {
		const view = mount();
		await settle();
		const options = Array.from(view.select()?.options ?? []).map((option) => option.textContent);
		expect(options).toEqual(["自动", "PowerShell 7", "Git Bash"]);
	});

	it("选一个就把标识写进草稿", async () => {
		const view = mount();
		await settle();
		const select = view.select();
		if (select === null) {
			throw new Error("没有下拉");
		}
		act(() => {
			select.value = "git-bash";
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(view.settings().terminal.profile).toBe("git-bash");
	});

	it("设置里留着本机没有的标识时显示「自动」", async () => {
		const view = mount({ ...structuredClone(DEFAULT_SETTINGS), terminal: { profile: "wt" } });
		await settle();
		expect(view.select()?.value).toBe("");
	});

	it("读不到清单时在原地给事实，重试之后出下拉", async () => {
		let attempts = 0;
		const container = document.createElement("div");
		document.body.append(container);
		let draft = structuredClone(DEFAULT_SETTINGS);
		const root = createRoot(container);
		const render = (): void => {
			act(() => {
				root.render(
					<I18nProvider language="zh-CN">
						<TerminalSection
							draft={draft}
							patch={(change) => {
								draft = change(draft);
							}}
							data={fakeData(async () => {
								attempts += 1;
								if (attempts === 1) {
									throw new Error("连接断了");
								}
								return PROFILES;
							})}
						/>
					</I18nProvider>,
				);
			});
		};
		render();
		unmount = () => root.unmount();
		await settle();
		expect(container.textContent).toContain("连接断了");
		expect(container.querySelector("select")).toBeNull();

		const retry = Array.from(container.querySelectorAll("button")).find((node) =>
			(node.textContent ?? "").includes("重试"),
		);
		act(() => retry?.click());
		await settle();
		expect(container.querySelector("select")).not.toBeNull();
	});
});
