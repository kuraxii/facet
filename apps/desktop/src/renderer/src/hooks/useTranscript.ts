/**
 * 对话视图的读取状态。
 *
 * 屏幕上的对话由主区域的投影得到；这一层管它周围的东西：提示条、滚动位置、向上补历史
 * 与已读标记。只读会话客户端，不推动任何动作以外的东西。
 */
import type { SessionClient } from "@facet/client-core";
import { createTranscriptCache, toTranscript } from "@facet/client-core";
import type { ScrollRestore } from "@facet/ui";
import { useStickToBottom } from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";

export interface TranscriptOptions {
	/** 会话客户端 */
	client: SessionClient;
	/** 当前对话视图 */
	chat: ReturnType<SessionClient["chatView"]>;
	/** 当前会话文件，滚动位置按它保存 */
	activeFile: string | undefined;
	/** 当前会话标识，换会话时重置补历史的闸门 */
	openedSessionId: string | undefined;
}

export interface Transcript {
	/** 投影后的对话条目 */
	items: ReturnType<typeof toTranscript>;
	/** 滚动容器的引用与元素 */
	scrollRef: (element: HTMLDivElement | null) => void;
	scrollElement: HTMLDivElement | null;
	/** 是否贴着底部 */
	isPinned: boolean;
	/** 滚到底部 */
	scrollToBottom: (behavior?: ScrollBehavior) => void;
	/** 忘掉某个会话的滚动位置 */
	forgetScroll: (file: string) => void;
}

export function useTranscript(options: TranscriptOptions): Transcript {
	const { client, chat, activeFile, openedSessionId } = options;
	/** 每个会话文件上次的滚动位置，切回标签时恢复 */
	const scrollPositions = useRef(new Map<string, ScrollRestore>());

	// 投影缓存按条目对象记忆：流式期间每帧只有末尾那条消息换新，其余条目直接沿用
	const transcriptCache = useRef(createTranscriptCache());
	const items = useMemo(() => (chat ? toTranscript(chat, transcriptCache.current) : []), [chat]);

	const restoreScroll = useCallback(
		(key: unknown): ScrollRestore | undefined =>
			typeof key === "string" ? scrollPositions.current.get(key) : undefined,
		[],
	);
	const {
		scrollRef,
		element: scrollElement,
		isPinned,
		scrollToBottom,
	} = useStickToBottom(items, activeFile, {
		restore: restoreScroll,
	});

	// 记住每个会话的滚动位置，切回标签时恢复
	useEffect(() => {
		const element = scrollElement;
		if (element === null || activeFile === undefined) return;
		const save = (): void => {
			const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
			scrollPositions.current.set(activeFile, {
				top: element.scrollTop,
				atBottom: distance <= 24,
			});
		};
		save();
		element.addEventListener("scroll", save, { passive: true });
		return () => element.removeEventListener("scroll", save);
	}, [activeFile, scrollElement]);

	// 滚动到顶部时自动补更早的历史；已经在贴底时不触发，避免刚打开就连环加载
	const loadingOlder = useRef(false);
	useEffect(() => {
		if (openedSessionId !== undefined) loadingOlder.current = false;
	}, [openedSessionId]);
	useEffect(() => {
		const element = scrollElement;
		if (element === null || isPinned) return;
		const loadOlder = (): void => {
			if (element.scrollTop > 96 || loadingOlder.current || !client.hasMore) return;
			loadingOlder.current = true;
			const distanceFromBottom = element.scrollHeight - element.scrollTop;
			void client.loadOlder().then(
				({ loaded }) => {
					if (loaded === 0) {
						loadingOlder.current = false;
						return;
					}
					requestAnimationFrame(() => {
						element.scrollTop = element.scrollHeight - distanceFromBottom;
						loadingOlder.current = false;
					});
				},
				() => {
					loadingOlder.current = false;
				},
			);
		};
		element.addEventListener("scroll", loadOlder, { passive: true });
		// 用户上一帧已经停在顶部时不会再触发 scroll，挂上监听后补一次判断
		loadOlder();
		return () => element.removeEventListener("scroll", loadOlder);
	}, [client, isPinned, scrollElement]);

	const forgetScroll = useCallback((file: string) => {
		scrollPositions.current.delete(file);
	}, []);

	return { items, scrollRef, scrollElement, isPinned, scrollToBottom, forgetScroll };
}

export interface ReadMarkerOptions {
	/** 会话客户端 */
	client: SessionClient;
	/** 当前会话文件 */
	activeFile: string | undefined;
	/** 对话此刻的状态 */
	activity: "idle" | "running" | "compacting" | "stopping";
	/** 一轮结束时要不要顺带重取变更页 */
	refreshChanges: () => void;
	/** 变更页是否正在显示 */
	isChangesVisible: boolean;
}

/**
 * 已读标记与一轮结束后的刷新。
 *
 * 一轮在前台结束时立刻记已读，侧栏不会先闪一下未读再变回去；窗口在后台时留着未读，
 * 等用户切回来再由聚焦事件清掉。
 */
export function useReadMarker(options: ReadMarkerOptions): void {
	const { client, activeFile, activity, refreshChanges, isChangesVisible } = options;
	const lastActivity = useRef(activity);
	useEffect(() => {
		if (lastActivity.current !== "idle" && activity === "idle") {
			if (activeFile !== undefined && document.hasFocus()) {
				void client.markSessionsSeen([activeFile]).catch(() => undefined);
			}
			if (isChangesVisible) {
				void refreshChanges();
			}
		}
		lastActivity.current = activity;
	}, [activeFile, activity, client, isChangesVisible, refreshChanges]);

	// 从后台切回来时把当前会话记为已读：离开期间跑完的那一轮，回来后不该还挂着未读
	useEffect(() => {
		const onFocus = (): void => {
			if (activeFile !== undefined) {
				void client.markSessionsSeen([activeFile]).catch(() => undefined);
			}
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [activeFile, client]);
}
