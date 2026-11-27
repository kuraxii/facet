/**
 * 分作用域持久化适配器测试：验证主机隔离、旧 localStorage 迁移与本地外观读写。
 */
import {
	DEFAULT_NOTIFICATION_SETTINGS,
	DEFAULT_SETTINGS,
	DEFAULT_TERMINAL_LOCAL_SETTINGS,
} from "@facet/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	appStorage,
	hasLocalAppearance,
	readLocalAppearance,
	readLocalInput,
	readLocalNotifications,
	readLocalTerminal,
	workspaceStorage,
	writeLocalAppearance,
	writeLocalInput,
	writeLocalNotifications,
	writeLocalTerminal,
} from "./local-storage.ts";

describe("local-storage 分作用域适配", () => {
	const originalWindow = (globalThis as { window?: unknown }).window;
	const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

	afterEach(() => {
		if (originalWindow === undefined) {
			delete (globalThis as { window?: unknown }).window;
		} else {
			Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
		}
		if (originalLocalStorage === undefined) {
			delete (globalThis as { localStorage?: unknown }).localStorage;
		} else {
			Object.defineProperty(globalThis, "localStorage", {
				value: originalLocalStorage,
				configurable: true,
			});
		}
	});

	it("按主机隔离工作区键值，且仅对 local 迁移旧 localStorage", () => {
		const calls: Array<{ scope: string; key: string; value: string | null }> = [];
		const legacyData: Record<string, string> = { "facet.panel.open": "1" };
		Object.defineProperty(globalThis, "localStorage", {
			value: {
				getItem: (k: string) => legacyData[k] ?? null,
				setItem: (k: string, v: string) => {
					legacyData[k] = v;
				},
				removeItem: (k: string) => {
					delete legacyData[k];
				},
			},
			configurable: true,
		});
		Object.defineProperty(globalThis, "window", {
			value: {
				facet: {
					localState: { storage: { app: {}, workspaces: {} } },
					setScopedStorage: (scope: string, key: string, value: string | null) => {
						calls.push({ scope, key, value });
					},
				},
			},
			configurable: true,
		});

		const localWs = workspaceStorage("local");
		const remoteWs = workspaceStorage("ssh://remote");
		expect(localWs.getItem("facet.panel.open")).toBe("1");
		expect(remoteWs.getItem("facet.panel.open")).toBeNull();
		remoteWs.setItem("facet.panel.open", "0");
		expect(localWs.getItem("facet.panel.open")).toBe("1");
		appStorage.setItem("facet.sidebar.collapsed", "1");
		expect(appStorage.getItem("facet.sidebar.collapsed")).toBe("1");
		expect(calls).toEqual([
			{ scope: "local", key: "facet.panel.open", value: "1" },
			{ scope: "ssh://remote", key: "facet.panel.open", value: "0" },
			{ scope: "app", key: "facet.sidebar.collapsed", value: "1" },
		]);
	});

	it("读写本机外观与输入偏好并调用 bridge 写盘", () => {
		const setLocalAppearance = vi.fn();
		const setLocalInput = vi.fn();
		Object.defineProperty(globalThis, "window", {
			value: {
				facet: {
					localState: {},
					setLocalAppearance,
					setLocalInput,
				},
			},
			configurable: true,
		});

		expect(hasLocalAppearance()).toBe(false);
		expect(readLocalAppearance()).toEqual(DEFAULT_SETTINGS.appearance);
		const nextAppearance = { ...DEFAULT_SETTINGS.appearance, theme: "light" as const };
		writeLocalAppearance(nextAppearance);
		expect(hasLocalAppearance()).toBe(true);
		expect(readLocalAppearance().theme).toBe("light");
		expect(setLocalAppearance).toHaveBeenCalledWith(nextAppearance);

		writeLocalInput({ sendKey: "shiftEnter" });
		expect(readLocalInput()).toEqual({ sendKey: "shiftEnter" });
		expect(setLocalInput).toHaveBeenCalledWith({ sendKey: "shiftEnter" });
	});

	it("读写本机通知与终端交互偏好并裁剪非法回滚行数", () => {
		Object.defineProperty(globalThis, "window", {
			value: {
				facet: {
					localState: { storage: { app: {}, workspaces: {} } },
					setScopedStorage: () => {},
				},
			},
			configurable: true,
		});

		expect(readLocalNotifications()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
		writeLocalNotifications({ enabled: false, onSettled: true, onNeedsInput: false });
		expect(readLocalNotifications()).toEqual({ enabled: false, onSettled: true, onNeedsInput: false });

		expect(readLocalTerminal()).toEqual(DEFAULT_TERMINAL_LOCAL_SETTINGS);
		writeLocalTerminal({ cursorBlink: false, scrollback: 999999 });
		expect(readLocalTerminal()).toEqual({ cursorBlink: false, scrollback: 50000 });
	});

	it("bridge.localState 被 contextBridge 深冻结时仍可正常读写而不抛错", () => {
		const frozenBridge = Object.freeze({
			localState: Object.freeze({
				storage: Object.freeze({
					app: Object.freeze({}),
					workspaces: Object.freeze({}),
				}),
			}),
			setScopedStorage: vi.fn(),
			setLocalAppearance: vi.fn(),
			setLocalInput: vi.fn(),
		});
		Object.defineProperty(globalThis, "window", {
			value: { facet: frozenBridge },
			configurable: true,
		});

		appStorage.setItem("facet.sidebar.collapsed", "1");
		expect(appStorage.getItem("facet.sidebar.collapsed")).toBe("1");
		workspaceStorage("local").setItem("facet.panel.open", "1");
		expect(workspaceStorage("local").getItem("facet.panel.open")).toBe("1");
		writeLocalAppearance({ ...DEFAULT_SETTINGS.appearance, theme: "claude" });
		expect(readLocalAppearance().theme).toBe("claude");
		writeLocalInput({ sendKey: "shiftEnter" });
		expect(readLocalInput().sendKey).toBe("shiftEnter");
		expect(frozenBridge.setScopedStorage).toHaveBeenCalledTimes(2);
	});
});
