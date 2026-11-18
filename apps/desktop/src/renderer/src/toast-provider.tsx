/**
 * 轻提示的上下文。
 *
 * 提示要能从任意一层弹：最底层的连接域与最上层的视图都可能是失败源头。上下文放在
 * `App` 根部，各 Hook 通过 `useToast()` 取同一份队列；提示区本身挂在这里，由 provider
 * 负责渲染，业务组件不关心它长在哪儿。
 */
import { ToastHost } from "@facet/ui";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { type Toasts, useToasts } from "./hooks/useToasts.ts";

/** 只把「弹」这一半给业务：队列与暂停归 provider 管。 */
export type ToastApi = Pick<Toasts, "show" | "dismiss">;

const ToastContext = createContext<ToastApi | undefined>(undefined);

/** 轻提示的提供者：内部持有队列，右侧把提示区挂到 body 上。 */
export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
	const { toasts, show, dismiss, setPaused } = useToasts();
	const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);
	const handleDismiss = useCallback((id: string) => dismiss(id), [dismiss]);
	return (
		<ToastContext.Provider value={api}>
			{children}
			<ToastHost toasts={toasts} onDismiss={handleDismiss} onPauseChange={setPaused} />
		</ToastContext.Provider>
	);
}

/** 取轻提示接口。没有 provider 时返回不弹空的替身，组件不必知道自己在不在树里。 */
export function useToast(): ToastApi {
	return useContext(ToastContext) ?? NOOP;
}

/** 没挂 provider 时的替身：提示不出现，但不会把调用方打断。 */
const NOOP: ToastApi = {
	show: () => undefined,
	dismiss: () => undefined,
};
