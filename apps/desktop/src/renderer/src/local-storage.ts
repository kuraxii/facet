/**
 * 渲染层分作用域持久化适配（对标 VS Code `StorageScope.APPLICATION` / `WORKSPACE`）。
 *
 * - 桌面端优先通过 `bridge` 与主进程管理的 `desktop.json` 同步（开发与打包同源隔离、不惧缓存清理）；
 * - 若发现旧版残留的 `window.localStorage` 键且新作用域里尚无记录，按需单次迁移进来；
 * - 无桥环境（如脱离外壳的单元测试）自动退回 `globalThis.localStorage`，保证纯 Hook 测试无需额外桩。
 */
import {
	type AppearanceSettings,
	DEFAULT_NOTIFICATION_SETTINGS,
	DEFAULT_SETTINGS,
	DEFAULT_TERMINAL_LOCAL_SETTINGS,
	type InputSettings,
	type NotificationSettings,
	type TerminalLocalSettings,
} from "@facet/protocol";
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

/**
 * 渲染进程内的可写本地状态缓存，按桥对象实例隔离。
 *
 * Electron `contextBridge.exposeInMainWorld` 会深冻结暴露给渲染进程的对象；直接修改
 * `window.facet.localState` 会在严格模式下抛出 `TypeError` 导致首帧崩溃，因此这里始终
 * 拷贝一份普通对象在渲染侧维护，同时通过 IPC 异步同步回主进程。
 */
const stateCache = new WeakMap<Partial<FacetBridge>, BridgeLocalState>();

function cloneLocalState(raw: BridgeLocalState | undefined): BridgeLocalState {
	const workspaces: Record<string, Record<string, string>> = {};
	if (raw?.storage?.workspaces !== undefined) {
		for (const [scope, bucket] of Object.entries(raw.storage.workspaces)) {
			workspaces[scope] = { ...bucket };
		}
	}
	return {
		...(raw?.appearance === undefined ? {} : { appearance: { ...raw.appearance } }),
		...(raw?.input === undefined ? {} : { input: { ...raw.input } }),
		storage: {
			app: { ...raw?.storage?.app },
			workspaces,
		},
	};
}

function ensureLocalState(bridge: Partial<FacetBridge>): BridgeLocalState {
	const cached = stateCache.get(bridge);
	if (cached !== undefined) {
		return cached;
	}
	const cloned = cloneLocalState(bridge.localState);
	stateCache.set(bridge, cloned);
	return cloned;
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
	const bridge = currentBridge();
	return bridge !== undefined && ensureLocalState(bridge).appearance !== undefined;
}

/** 读取本机优先的外观配置，未配置时回落到默认值。 */
export function readLocalAppearance(): AppearanceSettings {
	const bridge = currentBridge();
	return bridge === undefined
		? DEFAULT_SETTINGS.appearance
		: (ensureLocalState(bridge).appearance ?? DEFAULT_SETTINGS.appearance);
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
	const bridge = currentBridge();
	return bridge !== undefined && ensureLocalState(bridge).input !== undefined;
}

/** 读取本机优先的输入偏好，未配置时回落到默认值。 */
export function readLocalInput(): InputSettings {
	const bridge = currentBridge();
	return bridge === undefined
		? DEFAULT_SETTINGS.input
		: (ensureLocalState(bridge).input ?? DEFAULT_SETTINGS.input);
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

const NOTIFICATIONS_KEY = "facet.notifications";
const TERMINAL_LOCAL_KEY = "facet.terminal";
const MIN_TERMINAL_SCROLLBACK = 500;
const MAX_TERMINAL_SCROLLBACK = 50000;
const TERMINAL_SCROLLBACK_STEP = 500;

/** 读取本机优先的桌面通知配置。 */
export function readLocalNotifications(): NotificationSettings {
	try {
		const raw = appStorage.getItem(NOTIFICATIONS_KEY);
		if (raw === null) {
			return DEFAULT_NOTIFICATION_SETTINGS;
		}
		const parsed = JSON.parse(raw) as Partial<NotificationSettings> | null;
		if (typeof parsed !== "object" || parsed === null) {
			return DEFAULT_NOTIFICATION_SETTINGS;
		}
		return {
			enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
			onSettled:
				typeof parsed.onSettled === "boolean" ? parsed.onSettled : DEFAULT_NOTIFICATION_SETTINGS.onSettled,
			onNeedsInput:
				typeof parsed.onNeedsInput === "boolean"
					? parsed.onNeedsInput
					: DEFAULT_NOTIFICATION_SETTINGS.onNeedsInput,
		};
	} catch {
		return DEFAULT_NOTIFICATION_SETTINGS;
	}
}

/** 保存本机优先的桌面通知配置。 */
export function writeLocalNotifications(settings: NotificationSettings): void {
	appStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(settings));
}

/** 读取本机优先的终端交互配置。 */
export function readLocalTerminal(): TerminalLocalSettings {
	try {
		const raw = appStorage.getItem(TERMINAL_LOCAL_KEY);
		if (raw === null) {
			return DEFAULT_TERMINAL_LOCAL_SETTINGS;
		}
		const parsed = JSON.parse(raw) as Partial<TerminalLocalSettings> | null;
		if (typeof parsed !== "object" || parsed === null) {
			return DEFAULT_TERMINAL_LOCAL_SETTINGS;
		}
		const rawScrollback = parsed.scrollback;
		const scrollback =
			typeof rawScrollback === "number" && Number.isFinite(rawScrollback)
				? Math.min(
						MAX_TERMINAL_SCROLLBACK,
						Math.max(
							MIN_TERMINAL_SCROLLBACK,
							Math.round(rawScrollback / TERMINAL_SCROLLBACK_STEP) * TERMINAL_SCROLLBACK_STEP,
						),
					)
				: DEFAULT_TERMINAL_LOCAL_SETTINGS.scrollback;
		return {
			cursorBlink:
				typeof parsed.cursorBlink === "boolean"
					? parsed.cursorBlink
					: DEFAULT_TERMINAL_LOCAL_SETTINGS.cursorBlink,
			scrollback,
		};
	} catch {
		return DEFAULT_TERMINAL_LOCAL_SETTINGS;
	}
}

/** 保存本机优先的终端交互配置。 */
export function writeLocalTerminal(settings: TerminalLocalSettings): void {
	appStorage.setItem(TERMINAL_LOCAL_KEY, JSON.stringify(settings));
}
