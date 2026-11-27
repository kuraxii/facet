/**
 * 渲染层分作用域持久化适配（对标 VS Code `StorageScope.APPLICATION` / `WORKSPACE`）。
 *
 * - 桌面端优先通过 `bridge` 与主进程管理的 `desktop.json` 同步（开发与打包同源隔离、不惧缓存清理）；
 * - 若发现旧版残留的 `window.localStorage` 键且新作用域里尚无记录，按需单次迁移进来；
 * - 无桥环境（如脱离外壳的单元测试）自动退回 `globalThis.localStorage`，保证纯 Hook 测试无需额外桩。
 */
import { type AppearanceSettings, DEFAULT_SETTINGS, type InputSettings } from "@facet/protocol";
import type { BridgeLocalState, FacetBridge } from "./bridge.ts";

/** 与 `@facet/ui` 各存储接口兼容的最小读写协议。 */
export interface ScopedStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
}

/** 从运行时读取桥对象；单元测试里 `window.facet` 可能不存在。 */
function currentBridge(): Partial<FacetBridge> | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}
	return (window as { facet?: Partial<FacetBridge> }).facet;
}

function fallbackStorage(): Storage | undefined {
	try {
		return typeof globalThis.localStorage === "object" ? globalThis.localStorage : undefined;
	} catch {
		return undefined;
	}
}

function ensureLocalState(bridge: Partial<FacetBridge>): BridgeLocalState {
	if (bridge.localState === undefined) {
		bridge.localState = {};
	}
	if (bridge.localState.storage === undefined) {
		bridge.localState.storage = {};
	}
	return bridge.localState;
}

function readScopeBucket(state: BridgeLocalState, scope: string): Record<string, string> {
	const storage = state.storage ?? {};
	if (scope === "app") {
		if (storage.app === undefined) {
			storage.app = {};
		}
		return storage.app;
	}
	if (storage.workspaces === undefined) {
		storage.workspaces = {};
	}
	if (storage.workspaces[scope] === undefined) {
		storage.workspaces[scope] = {};
	}
	return storage.workspaces[scope];
}

/**
 * 构造一个作用域存储视图；`legacyFallback` 为真时允许把早期全局 `localStorage` 里同名的键
 * 迁移一次到新作用域下，避免老用户升级丢配置。
 */
function createScopedStorage(scope: string, legacyFallback: boolean): ScopedStorage {
	return {
		getItem: (key: string): string | null => {
			const bridge = currentBridge();
			if (bridge?.setScopedStorage === undefined) {
				return fallbackStorage()?.getItem(key) ?? null;
			}
			const state = ensureLocalState(bridge);
			const bucket = readScopeBucket(state, scope);
			if (Object.hasOwn(bucket, key)) {
				return bucket[key] ?? null;
			}
			if (legacyFallback) {
				const legacy = fallbackStorage()?.getItem(key) ?? null;
				if (legacy !== null) {
					bucket[key] = legacy;
					bridge.setScopedStorage(scope, key, legacy);
					return legacy;
				}
			}
			return null;
		},
		setItem: (key: string, value: string): void => {
			const bridge = currentBridge();
			if (bridge?.setScopedStorage === undefined) {
				fallbackStorage()?.setItem(key, value);
				return;
			}
			const state = ensureLocalState(bridge);
			const bucket = readScopeBucket(state, scope);
			bucket[key] = value;
			bridge.setScopedStorage(scope, key, value);
		},
		removeItem: (key: string): void => {
			const bridge = currentBridge();
			if (bridge?.setScopedStorage === undefined) {
				fallbackStorage()?.removeItem(key);
				return;
			}
			const state = ensureLocalState(bridge);
			const bucket = readScopeBucket(state, scope);
			delete bucket[key];
			bridge.setScopedStorage(scope, key, null);
		},
	};
}

/** 应用级存储（跨主机共享：主机列表、当前激活主机、左栏宽度与收起意图）。 */
export const appStorage: ScopedStorage = createScopedStorage("app", true);

/**
 * 工作区级存储（按主机端点隔离：打开的右栏标签与宽度、文件树开关、上次会话、草稿等）。
 *
 * 仅对本机端点 `"local"` 开放旧全局 `localStorage` 迁移，避免把本机的旧标签或草稿带到远端主机。
 */
export function workspaceStorage(endpoint: string): ScopedStorage {
	return createScopedStorage(endpoint, endpoint === "local");
}

/** 本地是否已经保存过本机外观配置。 */
export function hasLocalAppearance(): boolean {
	return currentBridge()?.localState?.appearance !== undefined;
}

/** 读取本机优先的外观配置，未配置时回落到默认值。 */
export function readLocalAppearance(): AppearanceSettings {
	return currentBridge()?.localState?.appearance ?? DEFAULT_SETTINGS.appearance;
}

/** 保存本机优先的外观配置到本机持久化存储。 */
export function writeLocalAppearance(appearance: AppearanceSettings): void {
	const bridge = currentBridge();
	if (bridge === undefined) {
		return;
	}
	const state = ensureLocalState(bridge);
	state.appearance = appearance;
	bridge.setLocalAppearance?.(appearance);
}

/** 本地是否已经保存过输入偏好。 */
export function hasLocalInput(): boolean {
	return currentBridge()?.localState?.input !== undefined;
}

/** 读取本机优先的输入偏好，未配置时回落到默认值。 */
export function readLocalInput(): InputSettings {
	return currentBridge()?.localState?.input ?? DEFAULT_SETTINGS.input;
}

/** 保存本机优先的输入偏好。 */
export function writeLocalInput(input: InputSettings): void {
	const bridge = currentBridge();
	if (bridge === undefined) {
		return;
	}
	const state = ensureLocalState(bridge);
	state.input = input;
	bridge.setLocalInput?.(input);
}
