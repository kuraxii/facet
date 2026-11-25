/**
 * 提交图谱的列表（满宽）。
 *
 * 纯展示：提交数据、分页状态与回调都由调用方给。每行固定行高，只有三样东西：左侧是按
 * `git-graph-layout.ts` 算出来的 SVG 泳道、中间是提交说明（单行省略）、右端是引用胶囊
 * （`HEAD` / 本地分支 / 远端分支 / Tag）。
 *
 * 作者、短哈希与时间不在行里：一行放不下它们，挤掉的是说明本身。这三样由悬浮卡
 * （`CommitTip`）与提交详情页承担，行因此只剩「这条是谁的分支、说了什么」。
 *
 * 分页是**触底自动加载**：列表底部放一个零高度的哨兵，它进入视口（含提前 `240px` 的余量）
 * 就去要下一页，滚到底不会停在「要不要再点一下」上；正在取时底部给一条读取提示。
 */
import type { GitCommit } from "@facet/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RefreshCw } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { CommitTip } from "./commit-tip.tsx";
import styles from "./git.module.css";
import { GitGraphLanes, GRAPH_ROW_HEIGHT } from "./git-graph-lanes.tsx";
import { layoutGitGraph } from "./git-graph-layout.ts";
import { GitRefs } from "./git-refs.tsx";

/**
 * 触底提前量，按行数算。
 *
 * 一页 200 条，剩下 50 条（约两屏）时就去取下一页：翻到最底之前那一页通常已经回来了，
 * 中途看不到"正在加载"。
 */
const COMMIT_PREFETCH_ROWS = 50;

/** 视口外预渲染行数：快速滚轮不至于先看到空白再来内容 */
const COMMIT_OVERSCAN = 12;

/** 图谱列表的参数。 */
export interface GitGraphListProps {
	/** 从新到旧的提交；分页加载时是累积的那一份 */
	commits: readonly GitCommit[];
	/** 当前分支标识，显示在工具栏上 */
	branch?: string | undefined;
	/** 正在取第一页 */
	isLoading: boolean;
	/** 正在取下一页 */
	isLoadingMore: boolean;
	/** 取历史失败的原因 */
	error: string | undefined;
	/** 后面还有更旧的提交 */
	hasMore: boolean;
	/** 项目根不是 git 仓库 */
	isRepo: boolean;
	/** 远端仓库地址：悬浮卡里给「打开提交页」的链接 */
	webUrl?: string | undefined;
	/** 当前高亮的那条提交 */
	selectedSha?: string | undefined;
	/** 点一条提交：调用方通常切到详情 */
	onSelect: (commit: GitCommit) => void;
	/** 重新取第一页 */
	onRefresh: () => void;
	/** 取下一页：列表滚到底部时自动调用 */
	onLoadMore: () => void;
	/** 滚动容器；调用方用它保存与恢复滚动位置 */
	scrollRef?: RefObject<HTMLDivElement | null> | undefined;
}

/** 提交图谱列表。 */
export function GitGraphList({
	commits,
	branch,
	isLoading,
	isLoadingMore,
	error,
	hasMore,
	isRepo,
	webUrl,
	selectedSha,
	onSelect,
	onRefresh,
	onLoadMore,
	scrollRef,
}: GitGraphListProps): ReactNode {
	const { t } = useI18n();
	// 提交悬浮卡内容偏高，里面还要滚：指针离开后留一段宽限才收（见 `HoverTipOptions`）。
	// 卡片自带分段内边距与通栏分隔线，外层浮层不再垫一圈留白（`flush`）
	const tip = useHoverTip({ holdOnLeave: true, flush: true });
	// 布局只跟哈希与父提交有关：换标题、换引用不必重算泳道
	const layout = useMemo(
		() => layoutGitGraph(commits.map((commit) => ({ sha: commit.sha, parents: commit.parents }))),
		[commits],
	);
	/** 滚动节点自己留一份：哨兵的观察根是它，调用方也用它保存滚动位置 */
	const scrollNode = useRef<HTMLDivElement | null>(null);
	/** 列表底部那个零高度哨兵 */
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	/** 滚动节点同时交给调用方：它用同一个节点保存与恢复滚动位置 */
	const attachScroll = useCallback(
		(node: HTMLDivElement | null) => {
			scrollNode.current = node;
			if (scrollRef !== undefined) {
				scrollRef.current = node;
			}
		},
		[scrollRef],
	);
	/** 触底时要用最新的回调，但不该因为父组件每次重渲染就重建观察者 */
	const loadMoreRef = useRef(onLoadMore);
	loadMoreRef.current = onLoadMore;

	/*
	 * 触底自动取下一页。
	 *
	 * 观察的是列表底部那个零高度哨兵，提前 `240px` 就算「快到底」——一页 50 条滚到底时下一页
	 * 往往已经回来了，看不到空白。观察者随「已加载条数」重建：追加一页之后如果哨兵仍在视口里
	 * （比如一屏放得下两页），会立刻再触发一次。
	 */
	const loadedCount = commits.length;
	useEffect(() => {
		// 一条都还没有时没有可观察的对象，等第一页回来再挂
		if (!hasMore || loadedCount === 0) {
			return;
		}
		const root = scrollNode.current;
		const sentinel = sentinelRef.current;
		if (root === null || sentinel === null) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					loadMoreRef.current();
				}
			},
			{ root, rootMargin: `0px 0px ${COMMIT_PREFETCH_ROWS * GRAPH_ROW_HEIGHT}px 0px`, threshold: 0 },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasMore, loadedCount]);

	/**
	 * 定高虚拟化：行高恒定（`GRAPH_ROW_HEIGHT`），纯算术定位，不绑 `measureElement`。
	 *
	 * 滚动容器就是这个列表自己，不需要 `scrollMargin`；整表高度仍是 `条数 × 行高`，退回列表
	 * 时按 `scrollTop` 恢复位置的逻辑原样成立。
	 */
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
		count: commits.length,
		getScrollElement: () => scrollNode.current,
		overscan: COMMIT_OVERSCAN,
		estimateSize: () => GRAPH_ROW_HEIGHT,
	});
	const items = virtualizer.getVirtualItems();
	const totalSize = commits.length * GRAPH_ROW_HEIGHT;

	const bar = (
		<div className={styles.graphBar}>
			<span className={styles.graphBranch}>{branch ?? "…"}</span>
			<button
				type="button"
				className={styles.graphRefresh}
				aria-label={t("panel.refreshCommits")}
				onClick={onRefresh}
			>
				<RefreshCw size={ICON_SIZE.md} data-spinning={isLoading} />
			</button>
		</div>
	);

	if (error !== undefined) {
		return (
			<div className={styles.graph}>
				{bar}
				<p className={`${styles.note} ${styles.noteError}`}>
					{error}
					<button type="button" className={styles.retry} onClick={onRefresh}>
						{t("common.retry")}
					</button>
				</p>
			</div>
		);
	}
	if (!isRepo) {
		return (
			<div className={styles.graph}>
				{bar}
				<p className={styles.note}>{t("panel.notRepo")}</p>
			</div>
		);
	}
	if (isLoading && commits.length === 0) {
		return (
			<div className={styles.graph}>
				{bar}
				<p className={styles.note}>{t("panel.loadingCommits")}</p>
			</div>
		);
	}
	if (commits.length === 0) {
		return (
			<div className={styles.graph}>
				{bar}
				<p className={styles.note}>{t("panel.noCommits")}</p>
			</div>
		);
	}

	return (
		<div className={styles.graph}>
			{bar}
			<div className={`scroll-y ${styles.graphScroll}`} ref={attachScroll}>
				{/*
				 * 行高恒定（`GRAPH_ROW_HEIGHT`），所以是定高虚拟化：只挂视口附近的行，纯算术定位、
				 * 不绑 `measureElement`。几千条的深历史也只挂几十个 `<li>`，泳道 svg 跟着少。
				 * 整表高度仍是 `条数 × 行高`，触底哨兵与退回时的滚动位置都不受影响。
				 */}
				<ol className={styles.graphList} style={{ height: totalSize }}>
					{items.map((item) => {
						const commit = commits[item.index];
						const row = layout.rows[item.index];
						if (commit === undefined) {
							return null;
						}
						return (
							<li
								key={commit.sha}
								className={styles.graphItem}
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									transform: `translateY(${item.start}px)`,
								}}
							>
								<button
									type="button"
									className={styles.graphRow}
									data-selected={selectedSha === commit.sha}
									data-sha={commit.sha}
									style={{ height: GRAPH_ROW_HEIGHT }}
									{...tip.handlers(<CommitTip commit={commit} webUrl={webUrl} />)}
									onClick={() => onSelect(commit)}
								>
									{row === undefined ? null : <GitGraphLanes row={row} maxLanes={layout.maxLanes} />}
									<span className={styles.graphSubject}>{commit.subject}</span>
									{/* 引用贴右端：泳道与说明在左，分支与 Tag 在右，扫视时各看一边 */}
									<GitRefs refs={commit.refs ?? []} />
								</button>
							</li>
						);
					})}
				</ol>
				{/*
				 * 底部的两种形态：还有更旧的提交时放一个零高度哨兵（进视口就自动取下一页），
				 * 正在取时换成一条读取提示——没有「加载更多」按钮，滚到底不该再要一次点击。
				 */}
				{hasMore ? <div className={styles.graphSentinel} ref={sentinelRef} aria-hidden /> : null}
				{isLoadingMore ? (
					<p className={styles.note} role="status" aria-live="polite">
						{t("panel.loadingCommits")}
					</p>
				) : null}
				{tip.render()}
			</div>
		</div>
	);
}
