/**
 * 右栏的三类内容。
 *
 * 文件是「可折叠文件树 + 文件预览」，变更是「可折叠文件列表 + 补丁预览」，终端独占整宽。
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
	useI18n,
	WorkspaceSplit,
} from "@facet/ui";
import { FileView } from "@facet/ui-editor";
import { TerminalView, type TerminalViewHandle } from "@facet/ui-terminal";
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
			/>
		);
	}

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
			/>
		);

	return (
		<div className="workspace-body">
			<div className={tab === "files" ? "workspace-view" : "workspace-view is-inactive"}>
				<WorkspaceSplit
					className="is-files"
					isListCollapsed={isFileTreeCollapsed}
					showListLabel={t("panel.showTree")}
					onShowList={() => setFileTreeCollapsed(false)}
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
					detail={fileView}
				/>
			</div>
			<div className={tab === "changes" ? "workspace-view" : "workspace-view is-inactive"}>
				<WorkspaceSplit
					className="is-changes"
					isListCollapsed={isChangesListCollapsed}
					showListLabel={t("panel.showChanges")}
					onShowList={() => setChangesListCollapsed(false)}
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
					detail={changesView}
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
