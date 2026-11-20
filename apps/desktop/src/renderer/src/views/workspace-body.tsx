/**
 * 右栏的三类内容。
 *
 * 文件与变更都是「左预览 + 右索引」：左边是文件内容或补丁，右边是可折叠的文件树或变更
 * 列表。预览在前是阅读与 Tab 顺序的自然方向，索引栏收起来时预览向右长满、左缘不动。
 * 终端独占整宽，两边都没有索引。
 *
 * 三块都留在 DOM 里，只切换显隐：终端藏起来是不让它丢 PTY 会话与回滚，文件树与变更列表
 * 藏起来是为了保住展开状态与滚动位置。
 *
 * 三块里只有终端有真实的副作用（订阅主机输出），所以它必须由「显隐」而不是「挂载与卸载」
 * 来控制生命周期。xterm 的尺寸由 `TerminalView` 自己的 `ResizeObserver` 负责：容器从
 * `display: none` 回到有尺寸时它会重新 fit，切回来与工作区拖宽都覆盖到了。
 */
import type { GitFileChange } from "@facet/protocol";
import {
	ChangesDocument,
	ChangesPane,
	FilesPane,
	type RightPanelTab,
	useHoverTip,
	useI18n,
	WORKSPACE_SPLIT_MIN_WIDTH_PX,
	WorkspaceSplit,
} from "@facet/ui";
import { FileView } from "@facet/ui-editor";
import { TerminalView, type TerminalViewHandle } from "@facet/ui-terminal";
import { PanelRightOpen } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TerminalPanel } from "../hooks/useTerminalPanel.ts";
import { type WorkspaceDocs, workspaceCommitKey, workspaceFileKey } from "../hooks/useWorkspaceDocs.ts";
import { useHostClient, useHostTerminalClient } from "../host-context.tsx";

/** 右栏正文的参数。 */
export interface WorkspaceBodyProps {
	/** 当前分页 */
	tab: RightPanelTab;
	/** 文档与改动 */
	docs: WorkspaceDocs;
	/** 终端域 */
	terminal: TerminalPanel;
	/** 当前会话所在的目录；没有会话时为空 */
	sessionCwd: string | undefined;
	/** 终端分页要显示的那个终端；主机上没有终端时为空 */
	terminalId: string | undefined;
}

/** 三类内容。 */
export function WorkspaceBody({
	tab,
	docs,
	terminal,
	sessionCwd,
	terminalId,
}: WorkspaceBodyProps): ReactNode {
	const { t } = useI18n();
	const client = useHostClient();
	const terminalClient = useHostTerminalClient();
	/** 文件树与变更列表是不是被手动收起了 */
	const [isFileTreeCollapsed, setFileTreeCollapsed] = useState(false);
	const [isChangesListCollapsed, setChangesListCollapsed] = useState(false);
	/**
	 * 工作区窄到摆不下两栏。
	 *
	 * 只在工作区自己被拖窄或整窗变窄时变，索引栏收起并不会改变这一层的宽度，所以不会
	 * 出现「收起来→变宽→又展开」的来回。宽度判定与样式放在一起说（`WorkspaceSplit`）。
	 */
	const [isNarrowBody, setIsNarrowBody] = useState(false);
	const bodyRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const node = bodyRef.current;
		if (node === null) {
			return;
		}
		const read = (): void => setIsNarrowBody(node.clientWidth < WORKSPACE_SPLIT_MIN_WIDTH_PX);
		read();
		const observer = new ResizeObserver(read);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	/** 索引栏此刻不显示：手动收起，或者窄到放不下 */
	const isFileTreeHidden = isFileTreeCollapsed || isNarrowBody;
	const isChangesListHidden = isChangesListCollapsed || isNarrowBody;
	/** 叫回索引栏的入口只在「手动收起」时给：窄到放不下时给了也展不开 */
	const canShowFileTree = isFileTreeCollapsed && !isNarrowBody;
	const canShowChangesList = isChangesListCollapsed && !isNarrowBody;
	/** 终端本身：切回终端分页时把键盘输入接过去 */
	const terminalView = useRef<TerminalViewHandle | null>(null);

	/*
	 * 切回终端分页就把焦点交给它。
	 *
	 * 终端是保活的，切走再切回来不会重新挂载，`TerminalView` 挂载时那次聚焦也就不会发生；
	 * 面板宽度变化同理，尺寸由它自己的 `ResizeObserver` 重算，这里只管焦点。
	 */
	useEffect(() => {
		if (tab === "terminal") {
			terminalView.current?.focus();
		}
	}, [tab]);

	/** 正在预览的文件：没有它时预览区是空的，等用户从树里点一个 */
	const fileRef = docs.file;
	const fileContent =
		fileRef === undefined ? undefined : docs.fileContents[workspaceFileKey(fileRef.cwd, fileRef.path)];

	/** 变更预览里的提交与它的详情；没在提交上时为空 */
	const commitRef = docs.commit;
	const commitDetail =
		commitRef === undefined
			? undefined
			: docs.commitDetails[workspaceCommitKey(commitRef.cwd, commitRef.sha)];

	/*
	 * 文件预览。
	 *
	 * 取文件失败时把原因摆在预览区：树那边只显示「读取失败」，具体是哪一句只有这里说得清。
	 */
	let fileView: ReactNode = null;
	if (docs.fileError !== undefined) {
		fileView = (
			<p className="chg-note is-error">
				{docs.fileError}
				<button type="button" className="chg-retry" onClick={docs.clearFileError}>
					{t("editor.backToDirectory")}
				</button>
			</p>
		);
	} else if (fileRef !== undefined && fileContent !== undefined) {
		fileView = (
			<FileView
				key={workspaceFileKey(fileRef.cwd, fileRef.path)}
				path={fileRef.path}
				content={fileContent}
				onSave={(text, expectedRevision) =>
					client.writeFile(fileRef.cwd, fileRef.path, text, expectedRevision)
				}
				onReload={async () => {
					const next = await client.readFile(fileRef.cwd, fileRef.path);
					docs.setFileContent(workspaceFileKey(fileRef.cwd, fileRef.path), next);
					return next;
				}}
				// 索引栏收起时，展开入口落在标题行最右端
				headerTrailing={
					canShowFileTree ? (
						<RestoreListButton label={t("panel.showTree")} onShow={() => setFileTreeCollapsed(false)} />
					) : null
				}
			/>
		);
	}

	/*
	 * 预览区的内容。
	 *
	 * 有文件时用 `FileView` 的标题行承载「展开文件树」；空着、或者只剩一条读取失败的原文时
	 * 没有二级顶栏，入口改挂在卡片里，收起之后总归有一个地方能点回去。
	 */
	const fileDetail =
		fileView !== null && docs.fileError === undefined ? (
			fileView
		) : (
			<>
				{fileView}
				{canShowFileTree ? (
					<div className="workspace-split-empty">
						<RestoreListButton label={t("panel.showTree")} onShow={() => setFileTreeCollapsed(false)} />
					</div>
				) : null}
			</>
		);

	/** 变更预览：停在提交上就看那一份补丁，否则看工作树，并定位到刚点的文件。 */
	const changesView =
		commitRef === undefined ? (
			<ChangesDocument
				status={docs.changes.status}
				error={docs.changes.error}
				focusPath={docs.changesFocus?.path}
				focusRequestId={docs.changesFocus?.requestId}
				loadDiff={(file: GitFileChange) =>
					sessionCwd === undefined
						? Promise.reject(new Error(t("app.noSession")))
						: client.gitDiff(sessionCwd, file.path, file.status === "untracked")
				}
				onRefresh={() => void docs.refreshChanges({ force: true })}
				commits={undefined}
				commitsLoading={false}
				commitsError={undefined}
				toolbarTrailing={
					canShowChangesList ? (
						<RestoreListButton label={t("panel.showChanges")} onShow={() => setChangesListCollapsed(false)} />
					) : null
				}
			/>
		) : (
			<ChangesDocument
				key={workspaceCommitKey(commitRef.cwd, commitRef.sha)}
				title={`${commitRef.shortSha} · ${commitRef.subject}`}
				emptyMessage={t("panel.noCommitChanges")}
				status={
					commitDetail?.detail === undefined
						? undefined
						: { isRepo: true, branch: commitRef.shortSha, files: commitDetail.detail.files }
				}
				error={commitDetail?.error}
				focusPath={undefined}
				focusRequestId={undefined}
				loadDiff={(file: GitFileChange) =>
					client.gitCommitDiff(commitRef.cwd, commitRef.sha, file.path, file.oldPath)
				}
				onRefresh={() => {
					void docs.loadCommit(commitRef.cwd, commitRef.sha);
				}}
				commits={undefined}
				commitsLoading={false}
				commitsError={undefined}
				toolbarTrailing={
					canShowChangesList ? (
						<RestoreListButton label={t("panel.showChanges")} onShow={() => setChangesListCollapsed(false)} />
					) : null
				}
			/>
		);

	return (
		<div className="workspace-body" ref={bodyRef}>
			<div className={tab === "files" ? "workspace-view" : "workspace-view is-inactive"}>
				<WorkspaceSplit
					className="is-files"
					isListCollapsed={isFileTreeHidden}
					detail={fileDetail}
					list={
						<FilesPane
							loadDirectory={(path) =>
								sessionCwd === undefined
									? Promise.reject(new Error(t("app.noSession")))
									: client.listDirectory(sessionCwd, path)
							}
							onOpenFile={(path) => {
								if (sessionCwd !== undefined) {
									void docs.openFile(sessionCwd, path);
								}
							}}
							selectedPath={
								docs.file !== undefined && docs.file.cwd === sessionCwd ? docs.file.path : undefined
							}
							onCollapse={() => setFileTreeCollapsed(true)}
						/>
					}
				/>
			</div>
			<div className={tab === "changes" ? "workspace-view" : "workspace-view is-inactive"}>
				<WorkspaceSplit
					className="is-changes"
					isListCollapsed={isChangesListHidden}
					detail={changesView}
					list={
						<ChangesPane
							status={docs.changes.status}
							error={docs.changes.error}
							onRefresh={() => void docs.refreshChanges({ force: true })}
							onOpenDiff={docs.focusDiff}
							commits={docs.commits.data}
							commitsLoading={docs.commits.isLoading}
							commitsError={docs.commits.error}
							onCommitPress={(commit) => {
								if (sessionCwd !== undefined) {
									docs.openCommit(sessionCwd, commit);
								}
							}}
							onCollapse={() => setChangesListCollapsed(true)}
						/>
					}
				/>
			</div>
			{/* 终端只切显隐：卸载会丢掉 PTY 会话与回滚，切回来还要重取一遍历史 */}
			<div className={tab === "terminal" ? "workspace-view" : "workspace-view is-inactive"}>
				{terminalId === undefined ? null : (
					<div className="workspace-term">
						<TerminalView
							key={terminalId}
							ref={terminalView}
							terminalId={terminalId}
							client={terminalClient}
							appearance={terminal.appearance}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * 把索引栏叫回来的小按钮。
 *
 * 图标朝左：索引栏在右边，展开它就是让内容从右侧长出来。文案即无障碍名称，同时用作
 * 悬浮提示（按钮本身只有图标）。
 */
function RestoreListButton({ label, onShow }: { label: string; onShow: () => void }): ReactNode {
	const tip = useHoverTip();
	return (
		<>
			<button
				type="button"
				className="workspace-head-action"
				aria-label={label}
				{...tip.handlers(label)}
				onClick={onShow}
			>
				<PanelRightOpen size={14} strokeWidth={1.5} />
			</button>
			{tip.render()}
		</>
	);
}
