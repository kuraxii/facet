/**
 * 对话视图的读取状态。
 *
 * 屏幕上的对话由主区域的投影得到；这一层管它周围的东西：提示条、滚动位置、向上补历史
 * 与已读标记。只读会话客户端，不推动任何动作以外的东西。
 */
import type { SessionClient } from "@facet/client-core";
import { createTranscriptCache, toTranscript } from "@facet/client-core";
import type { ScrollEdges, TranscriptAnchor, TranscriptViewport } from "@facet/ui";
import { useStickToBottom } from "@facet/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

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

/** 切回会话时要回到哪儿：贴在底部，或者回到某一行。 */
interface ScrollSnapshot {
	/** 上次离开时是不是贴着底部 */
	readonly atBottom: boolean;
	/** 视口顶部那一行与行内偏移；贴在底部时为 `null` */
	readonly anchor: TranscriptAnchor | null;
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
	/** 面板的定位接口：对话导航与位置记忆都读它 */
	viewport: { current: TranscriptViewport | null };
	/** 忘掉某个会话的滚动位置 */
	forgetScroll: (file: string) => void;
}

export function useTranscript(options: TranscriptOptions): Transcript {
	const { client, chat, activeFile, openedSessionId } = options;
	/** 每个会话文件上次停在哪，切回标签时恢复；按（行标识, 行内偏移）记，不按像素 */
	const snapshots = useRef(new Map<string, ScrollSnapshot>());
	/** 面板的定位接口，由面板在挂载后写进来 */
	const viewport = useRef<TranscriptViewport | null>(null);

	// 投影缓存按条目对象记忆：流式期间每帧只有末尾那条消息换新，其余条目直接沿用
	const transcriptCache = useRef(createTranscriptCache());
	const items = useMemo(() => (chat ? toTranscript(chat, transcriptCache.current) : []), [chat]);

	const {
		scrollRef,
		element: scrollElement,
		isPinned,
		edges,
		scrollToBottom,
		release,
	} = useStickToBottom(items, {
		// 贴底写入交给面板：虚拟化器要知道这次滚动是自己做的，否则后续补偿会按旧位置算
		scrollToEnd: useCallback((behavior: ScrollBehavior) => {
			const api = viewport.current;
			if (api === null) return false;
			api.scrollToEnd(behavior);
			return true;
		}, []),
	});

	// 切会话：原来贴底就继续贴底，否则按记下的那一行摆回去。
	// `openedSessionId` 也在依赖里：面板按会话标识重挂，重挂那一下是一个新的虚拟化器，
	// 得在这次提交之后再摆一次位，否则只有"点会话"那一下的定位，重挂之后无人接手。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 重挂本身就是要重摆一次的信号，函数体里不读它
	useLayoutEffect(() => {
		const saved = activeFile === undefined ? undefined : snapshots.current.get(activeFile);
		if (saved === undefined || saved.atBottom || saved.anchor === null) {
			scrollToBottom("auto");
			return;
		}
		release();
		// 标识迁移（离开期间一轮可能结束并提升为历史消息）由面板按当前映射现算，这里存原样
		viewport.current?.restore(saved.anchor);
	}, [activeFile, openedSessionId, release, scrollToBottom]);

	// 记住每个会话的滚动位置，切回标签时恢复
	useEffect(() => {
		const element = scrollElement;
		if (element === null || activeFile === undefined) return;
		const save = (): void => {
			const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
			const anchor = viewport.current?.capture() ?? null;
			snapshots.current.set(activeFile, {
				atBottom: distance <= 24,
				anchor: distance <= 24 ? null : anchor,
			});
		};
		save();
		element.addEventListener("scroll", save, { passive: true });
		return () => element.removeEventListener("scroll", save);
	}, [activeFile, scrollElement]);

	// 滚动到顶部时自动补更早的历史；已经在贴底时不触发，避免刚打开就连环加载。
	// 补进来的历史由虚拟化器按行锚回原位，这里不用再算像素差。
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
			void client.loadOlder().then(
				() => {
					loadingOlder.current = false;
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
		snapshots.current.delete(file);
	}, []);

	return { items, scrollRef, scrollElement, isPinned, edges, scrollToBottom, viewport, forgetScroll };
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
