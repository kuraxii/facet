/**
 * 对话视图的读取状态。
 *
 * 屏幕上的对话由主区域的投影得到；这一层管它周围的东西：提示条、滚动位置、向上补历史
 * 与已读标记。只读会话客户端，不推动任何动作以外的东西。
 */
import type { SessionClient } from "@facet/client-core";
import { createTranscriptCache, toTranscript } from "@facet/client-core";
import type { ScrollEdges, ScrollRestore } from "@facet/ui";
import { useStickToBottom } from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
	/** 两侧是否还有可滚内容：对话视口据此淡入边缘渐隐 */
	edges: ScrollEdges;
	/** 滚到底部 */
	scrollToBottom: (behavior?: ScrollBehavior) => void;
	/** 忘掉某个会话的滚动位置 */
	forgetScroll: (file: string) => void;
	/** 还有没有更早的历史可补 */
	hasMore: boolean;
	/** 是否正在补更早的历史 */
	isLoadingOlder: boolean;
	/** 补一页更早的历史（只由竖轨顶端的「…」调用，滚动位置不触发） */
	loadOlderNow: () => void;
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
		edges,
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

	// 补页只由竖轨顶端的「…」触发，滚动位置不参与：滚到顶部本身不加载任何东西
	const loadingOlder = useRef(false);
	/** 补页在途：静默回收要避开，不然裁完回来的那一页与游标对不上 */
	const [isLoadingOlder, setIsLoadingOlder] = useState(false);
	/** `client.hasMore` 是运行期游标上的取值，补完页不会引起投影变化，所以本地留一份用于重画 */
	const [hasMore, setHasMore] = useState(() => client.hasMore);
	/*
	 * 游标要到首屏那一页回来之后才有值，补完最后一页又归零。这两种变化都不投影到 chat view，
	 * 不在这里每次渲染对一下的话，刚打开的会话里「补一页」会一直灰着（值停在挂载那一刻的 false）。
	 */
	useEffect(() => {
		if (hasMore !== client.hasMore) {
			setHasMore(client.hasMore);
		}
	});
	// 换会话时清掉翻页闸门
	useEffect(() => {
		if (openedSessionId === undefined) return;
		loadingOlder.current = false;
	}, [openedSessionId]);

	/** 补一页，并把"还有没有"的结论同步到本地 */
	const loadOlderNow = useCallback((): void => {
		if (loadingOlder.current || !client.hasMore) return;
		loadingOlder.current = true;
		setIsLoadingOlder(true);
		void client.loadOlder().then(
			(result) => {
				loadingOlder.current = false;
				setIsLoadingOlder(false);
				setHasMore(result.hasMore);
			},
			() => {
				loadingOlder.current = false;
				setIsLoadingOlder(false);
			},
		);
	}, [client]);

	const forgetScroll = useCallback((file: string) => {
		scrollPositions.current.delete(file);
	}, []);

	return {
		items,
		scrollRef,
		scrollElement,
		isPinned,
		edges,
		scrollToBottom,
		forgetScroll,
		hasMore,
		isLoadingOlder,
		loadOlderNow,
	};
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
