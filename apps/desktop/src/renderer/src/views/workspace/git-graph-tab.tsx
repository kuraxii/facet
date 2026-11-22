/**
 * 提交图谱标签。
 *
 * 两级：默认是满宽的图谱列表（左泳道、右说明），点一条提交就地钻进提交详情。
 *
 * - **按需取数**：历史只在图谱看得见的时候取，一次一页（`COMMIT_PAGE_SIZE`），滚到底自动
 *   取下一页；顶栏的刷新按钮重取第一页。提交的详情（改动清单与逐个文件补丁）也是进了详情
 *   才取。
 * - **详情只有一层**：点一条提交直接给这份改动文档（与变更页同一个 `ChangesDocument`），
 *   这条提交改到的所有文件排在同一个滚动区里，文件头吸顶、可折叠，补丁进入视口附近才按
 *   `gitCommitDiff` 取。没有中间的文件列表，也没有单独的概览块——作者、时间、改动规模这些
 *   在列表里悬停那条提交就能看到（`CommitTip`），进去之后呆在补丁里就够了。
 * - **退回**：顶栏左端一枚箭头回到图谱列表，退回时恢复列表原来的滚动位置；`Esc` 同一条路，
 *   一次退到图谱，不会顺手关掉整个右抽屉。
 */
import type { GitCommit, GitStatus } from "@facet/protocol";
import { ChangesDocument, GitGraphList, ICON_SIZE, useHoverTip, useI18n } from "@facet/ui";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceDocs } from "../../hooks/useWorkspaceDocs.ts";
import { workspaceCommitKey } from "../../hooks/useWorkspaceDocs.ts";
import { useHostClient } from "../../host-context.tsx";

/** 提交图谱标签的参数。 */
export interface GitGraphTabProps {
	/** 文档数据 */
	docs: WorkspaceDocs;
	/** 当前会话所在的目录；没有会话时为空 */
	sessionCwd: string | undefined;
	/** 是不是当前激活的标签：`Esc` 退回图谱只在它激活时接管 */
	isActive: boolean;
}

/** 提交图谱标签。 */
export function GitGraphTab({ docs, sessionCwd, isActive }: GitGraphTabProps): ReactNode {
	const { t } = useI18n();
	const client = useHostClient();
	/** 钻进去看的那条提交；为空时停在图谱列表 */
	const [selected, setSelected] = useState<GitCommit | undefined>(undefined);
	/** 图谱列表滚到哪儿了：退回图谱时按它恢复 */
	const listScrollTop = useRef(0);
	const listRef = useRef<HTMLDivElement | null>(null);

	const detail =
		selected === undefined
			? undefined
			: docs.commitDetails[workspaceCommitKey(sessionCwd ?? "", selected.sha)];
	const isReady = detail?.detail !== undefined && detail.error === undefined;
	const files = useMemo(() => detail?.detail?.files ?? [], [detail?.detail]);
	/*
	 * 改动文档要的是一份 `GitStatus`：那条提交的改动清单正好是这个形状。分支留空——提交不
	 * 属于某个分支，工具栏那行字是上层的「短哈希 · 说明」。
	 */
	const commitStatus = useMemo<GitStatus>(() => ({ isRepo: true, files }), [files]);

	/** 钻入一条提交：先把列表的滚动位置记下来，再按需取详情。 */
	const openCommit = useCallback(
		(commit: GitCommit) => {
			listScrollTop.current = listRef.current?.scrollTop ?? 0;
			setSelected(commit);
			if (sessionCwd === undefined) {
				return;
			}
			const cached = docs.commitDetails[workspaceCommitKey(sessionCwd, commit.sha)];
			if (cached?.isLoading !== true && (cached?.detail === undefined || cached.error !== undefined)) {
				void docs.loadCommit(sessionCwd, commit.sha);
			}
		},
		[docs, sessionCwd],
	);

	/** 退回图谱：清掉钻取状态，下一帧把滚动位置放回去。 */
	const backToGraph = useCallback(() => setSelected(undefined), []);

	const reloadDetail = useCallback(() => {
		if (sessionCwd !== undefined && selected !== undefined) {
			void docs.loadCommit(sessionCwd, selected.sha);
		}
	}, [docs, selected, sessionCwd]);

	// 图谱重新挂上来之后恢复滚动位置：先量后画，用户看不到跳动
	useLayoutEffect(() => {
		if (selected !== undefined) {
			return;
		}
		const node = listRef.current;
		if (node !== null) {
			node.scrollTop = listScrollTop.current;
		}
	}, [selected]);

	/*
	 * `Esc` 退回图谱列表。
	 *
	 * 挂在 `document` 的冒泡段：内层浮层（菜单、提示）会先 `preventDefault()`，这里看到
	 * `defaultPrevented` 就让路；抽屉的 `Esc` 在 `window` 上，比这里更外一层。
	 */
	useEffect(() => {
		if (!isActive || selected === undefined) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			event.preventDefault();
			backToGraph();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [backToGraph, isActive, selected]);

	if (selected === undefined) {
		return (
			<div className="git-graph-view">
				<GitGraphList
					commits={docs.commits.data?.commits ?? []}
					branch={docs.changes.status?.branch}
					isLoading={docs.commits.isLoading}
					isLoadingMore={docs.commits.isLoadingMore === true}
					error={docs.commits.error}
					hasMore={docs.commits.data?.hasMore === true}
					isRepo={docs.commits.data?.isRepo !== false}
					webUrl={docs.commits.data?.webUrl}
					onSelect={openCommit}
					onRefresh={() => void docs.refreshCommits({ force: true })}
					onLoadMore={() => void docs.loadMoreCommits()}
					scrollRef={listRef}
				/>
			</div>
		);
	}

	return (
		<div className="git-graph-view">
			<ChangesDocument
				status={isReady ? commitStatus : undefined}
				title={`${selected.shortSha} · ${selected.subject}`}
				error={detail?.error}
				emptyMessage={t("panel.noCommitChanges")}
				loadDiff={(file) =>
					sessionCwd === undefined
						? Promise.reject(new Error(t("app.noSession")))
						: client.gitCommitDiff(sessionCwd, selected.sha, file.path, file.oldPath)
				}
				onRefresh={reloadDetail}
				toolbarLeading={<BackToGraphButton onBack={backToGraph} />}
			/>
		</div>
	);
}

/**
 * 退回图谱的小按钮。
 *
 * 详情只有一层，这枚箭头是唯一的退路，所以任何宽度都看得见（样式里由
 * `.git-graph-view .workspace-back` 兜住）。
 */
function BackToGraphButton({ onBack }: { onBack: () => void }): ReactNode {
	const { t } = useI18n();
	const label = t("panel.backToGraph");
	const tip = useHoverTip();
	return (
		<>
			<button
				type="button"
				className="workspace-back"
				aria-label={label}
				{...tip.handlers(label)}
				onClick={onBack}
			>
				<ArrowLeft size={ICON_SIZE.md} />
			</button>
			{tip.render()}
		</>
	);
}
