/**
 * 全局图片预览的入口与宿主。
 *
 * 与轻提示同一套写法：上下文只把「打开」这一半给业务，预览层本身由 provider 挂在树上，
 * 调用方不必知道它长在哪儿、也不必各自维护一份开合状态。没有 provider 时拿到的是空实现，
 * 组件在单独渲染（用例、扩展卡片预览）里不会因此报错。
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ImagePreviewDialog } from "./image-preview-dialog.tsx";
import { type ImagePreviewSession, normalizeRequest } from "./image-preview-state.ts";
import { morphImage } from "./image-preview-transition.ts";
import type { OpenImagePreview } from "./image-preview-types.ts";

const ImagePreviewContext = createContext<OpenImagePreview | undefined>(undefined);

/** 没挂 provider 时的替身：浮层不出现，调用方不被打断。 */
const NOOP: OpenImagePreview = () => undefined;

/** 预览层的提供者：内部持有当前会话，右侧把浮层挂到模态层里。 */
export function ImagePreviewProvider({ children }: { children: ReactNode }): ReactNode {
	const [session, setSession] = useState<ImagePreviewSession | undefined>(undefined);
	/** 点开它的那个元素：关闭时飞回它身上 */
	const sourceRef = useRef<HTMLElement | null>(null);

	const open = useCallback<OpenImagePreview>((request) => {
		const next = normalizeRequest(request);
		if (next === undefined) {
			return;
		}
		sourceRef.current = next.source;
		morphImage(
			next.source,
			() => flushSync(() => setSession(next)),
			() => document.querySelector<HTMLElement>(".image-preview-stage img"),
		);
	}, []);

	const close = useCallback(() => {
		const source = sourceRef.current;
		morphImage(
			document.querySelector<HTMLElement>(".image-preview-stage img"),
			() => flushSync(() => setSession(undefined)),
			() => (source?.isConnected === true ? source : null),
		);
	}, []);

	const value = useMemo(() => open, [open]);

	return (
		<ImagePreviewContext.Provider value={value}>
			{children}
			{session === undefined ? null : (
				<ImagePreviewDialog items={session.items} initialIndex={session.index} onClose={close} />
			)}
		</ImagePreviewContext.Provider>
	);
}

/** 取「打开图片预览」的入口；没有 provider 时是空实现。 */
export function useImagePreview(): OpenImagePreview {
	return useContext(ImagePreviewContext) ?? NOOP;
}
