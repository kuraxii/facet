/**
 * 提交图谱标签。
 *
 * 两级：默认是满宽的图谱列表（左泳道、右说明），点一条提交就地钻进提交详情。
 *
 * - **按需取数**：历史只在图谱看得见的时候取，一次一页（`COMMIT_PAGE_SIZE`），滚到底自动
 *   取下一页；顶栏的刷新按钮重取第一页。
 * - **详情是一份变更文档**：和变更页同一套——这条提交改到的所有文件排在同一个滚动区里，
 *   文件头吸顶、可折叠，补丁进入视口附近才取。索引栏点一个文件只是把那一段滚到顶上，不换
 *   页面；窄到单栏时才切成「先列表、再满宽改动」，箭头逐级退回。
 * - **返回**：从详情退回图谱时恢复原来的滚动位置与高亮行；`Esc` 逐级返回（改动 → 文件
 *   列表 → 图谱），一次只退一层，不会顺手把整个右抽屉关掉。
 */
import type { GitCommit, GitFileChange, GitStatus } from "@facet/protocol";
import {
	ChangesDocument,
	GitCommitMeta,
	GitFileRow,
	GitGraphList,
	useHoverTip,
	useI18n,
	WorkspaceSplit,
	type WorkspaceSplitView,
} from "@facet/ui";
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
	/** 是不是当前激活的标签：`Esc` 逐级返回只在它激活时接管 */
	isActive: boolean;
	/** 两栏态索引栏的宽度 */
	listWidth: number;
	/** 松手时提交索引栏宽度 */
	onListWidthChange: (width: number) => void;
}

/** 提交图谱标签。 */
export function GitGraphTab({
	docs,
	sessionCwd,
	isActive,
	listWidth,
	onListWidthChange,
}: GitGraphTabProps): ReactNode {
	const { t } = useI18n();
	const client = useHostClient();
	/** 钻进去看的那条提交；为空时停在图谱列表 */
	const [selected, setSelected] = useState<GitCommit | undefined>(undefined);
	/**
	 * 单栏钻取停在哪一层。
	 *
	 * 两栏态忽略它：宽到放得下两栏时改动与索引一起显示，钻取状态留着不影响观感。
	 */
	const [view, setView] = useState<WorkspaceSplitView>("list");
	/** 改动文档里要定位到哪个文件，以及同一次定位的序号 */
	const [focus, setFocus] = useState<{ path: string; requestId: number } | undefined>(undefined);
	const focusSeq = useRef(0);
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
	 * 变更文档要的是一份 `GitStatus`：那条提交的改动清单正好是这个形状。分支留空——提交
	 * 不属于某个分支，工具栏那行字交给上面的二级顶栏。
	 */
	const commitStatus = useMemo<GitStatus>(() => ({ isRepo: true, files }), [files]);

	/** 钻入一条提交：先把列表的滚动位置记下来，再按需取详情。 */
	const openCommit = useCallback(
		(commit: GitCommit) => {
			listScrollTop.current = listRef.current?.scrollTop ?? 0;
			setSelected(commit);
			setView("list");
			setFocus(undefined);
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
	const backToGraph = useCallback(() => {
		setFocus(undefined);
		setView("list");
		setSelected(undefined);
	}, []);

	/** 索引里点一个文件：记一次定位，单栏态同时把改动那一层调出来。 */
	const pickFile = useCallback((file: GitFileChange) => {
		focusSeq.current += 1;
		setFocus({ path: file.path, requestId: focusSeq.current });
		setView("detail");
	}, []);

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
	 * `Esc` 逐级返回。
	 *
	 * 挂在 `document` 的冒泡段：内层浮层（菜单、提示）会先 `preventDefault()`，这里看到
	 * `defaultPrevented` 就让路；抽屉的 `Esc` 在 `window` 上，比这里更外一层。
	 */
	useEffect(() => {
		if (!isActive) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			if (view === "detail") {
				event.preventDefault();
				setView("list");
				return;
			}
			if (selected !== undefined) {
				event.preventDefault();
				backToGraph();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [backToGraph, isActive, selected, view]);

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
			<div className="git-graph-head">
				<BackToGraphButton onBack={backToGraph} />
				<span className="git-graph-title">
					{selected.shortSha} · {selected.subject}
				</span>
			</div>
			<WorkspaceSplit
				className="is-git-graph"
				view={view}
				listWidth={listWidth}
				onListWidthChange={onListWidthChange}
				detail={
					<ChangesDocument
						status={isReady ? commitStatus : undefined}
						error={detail?.error}
						emptyMessage={t("panel.noCommitChanges")}
						focusPath={focus?.path}
						focusRequestId={focus?.requestId}
						loadDiff={(file) =>
							sessionCwd === undefined
								? Promise.reject(new Error(t("app.noSession")))
								: client.gitCommitDiff(sessionCwd, selected.sha, file.path, file.oldPath)
						}
						onRefresh={reloadDetail}
						toolbarLeading={<BackToFilesButton onBack={() => setView("list")} />}
					/>
				}
				list={
					<>
						<GitCommitMeta commit={selected} />
						<ul className="git-graph-files">
							{files.map((changed) => (
								<li key={changed.path}>
									<GitFileRow file={changed} isSelected={focus?.path === changed.path} onSelect={pickFile} />
								</li>
							))}
						</ul>
					</>
				}
			/>
		</div>
	);
}

/**
 * 退回文件列表的小按钮。
 *
 * 复用 `.workspace-back`：单栏钻取时出现，宽到两栏时由容器查询藏起来——那时索引就在旁边，
 * 点一个文件只是把改动滚过去，不需要退路。
 */
function BackToFilesButton({ onBack }: { onBack: () => void }): ReactNode {
	const { t } = useI18n();
	const label = t("panel.backToFileList");
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
				<ArrowLeft size={14} strokeWidth={1.5} />
			</button>
			{tip.render()}
		</>
	);
}

/** 退回图谱的小按钮：详情页二级顶栏左端的那枚箭头。 */
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
				<ArrowLeft size={14} strokeWidth={1.5} />
			</button>
			{tip.render()}
		</>
	);
}
