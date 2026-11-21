/**
 * 右栏的三类内容。
 *
 * 一个标签都没开时这一块是启动清单（图标 + 名字 + 快捷键），开了之后按标签装内容：
 *
 * - 文件与变更都是「预览 + 索引」。右栏宽到 `WORKSPACE_SPLIT_WIDE_WIDTH_PX` 时是两栏并排
 *   （左预览、右索引）；更窄时改成单栏钻取——先满宽看列表，点一条进满宽预览，预览顶栏
 *   左上角的箭头退回列表。哪一层显示由 `WorkspaceSplit` 的 `data-view` 给，样式负责换排布。
 * - 终端独占整宽，两边都没有索引。
 *
 * 三块都留在 DOM 里，只切换显隐：终端藏起来是不让它丢 PTY 会话与回滚，文件树与变更列表
 * 藏起来是为了保住展开状态与滚动位置。关掉一个标签才是真的卸载——终端的 PTY 也就在那
 * 一下结束（外壳在关终端标签时同时关掉终端）。
 *
 * 只有终端有真实的副作用（订阅主机输出），所以它必须由「显隐」而不是「挂载与卸载」来控制
 * 生命周期。xterm 的尺寸由 `TerminalView` 自己的 `ResizeObserver` 负责：容器从 `display:
 * none` 回到有尺寸、或者 `⤢` 宽展开把列宽拉大，它都会重新 fit。
 */
import type { GitFileChange } from "@facet/protocol";
import {
	ChangesDocument,
	ChangesPane,
	FilesPane,
	type RightPanelTab,
	useHoverTip,
	useI18n,
	WorkspaceLauncher,
	WorkspaceSplit,
	type WorkspaceSplitView,
	type WorkspaceTabId,
	type WorkspaceTabItem,
} from "@facet/ui";
import { FileView } from "@facet/ui-editor";
import { TerminalView, type TerminalViewHandle } from "@facet/ui-terminal";
import { ArrowLeft, PanelRightOpen } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TerminalPanel } from "../hooks/useTerminalPanel.ts";
import { type WorkspaceDocs, workspaceCommitKey, workspaceFileKey } from "../hooks/useWorkspaceDocs.ts";
import { useHostClient, useHostTerminalClient } from "../host-context.tsx";

/** 右栏正文的参数。 */
export interface WorkspaceBodyProps {
	/** 已打开的工具标签 */
	openTabs: readonly RightPanelTab[];
	/** 当前激活项；为 `null` 时正文是启动清单 */
	activeTab: RightPanelTab | null;
	/** 全部工具：启动清单用它列出可打开的那几项 */
	items: readonly WorkspaceTabItem[];
	/** 打开一个工具（点启动清单里的一行） */
	onOpenTab: (id: WorkspaceTabId) => void;
	/** 文档与改动 */
	docs: WorkspaceDocs;
	/** 终端域 */
	terminal: TerminalPanel;
	/** 当前会话所在的目录；没有会话时为空 */
	sessionCwd: string | undefined;
	/** 终端标签要显示的那个终端；主机上没有终端时为空 */
	terminalId: string | undefined;
}

/** 三类内容。 */
export function WorkspaceBody(props: WorkspaceBodyProps): ReactNode {
	const { openTabs, activeTab, items, onOpenTab, docs, terminal, sessionCwd, terminalId } = props;
	const { t } = useI18n();
	const client = useHostClient();
	const terminalClient = useHostTerminalClient();
	/** 文件树与变更列表是不是被手动收起了（只在两栏态有意义） */
	const [isFileTreeCollapsed, setFileTreeCollapsed] = useState(false);
	const [isChangesListCollapsed, setChangesListCollapsed] = useState(false);
	/**
	 * 单栏钻取停在哪一层。
	 *
	 * 两栏态忽略它：宽到放得下两栏时预览与索引一起显示，钻取状态留着不影响观感，缩窄回来
	 * 还停在用户最后看的那一层。
	 */
	const [filesView, setFilesView] = useState<WorkspaceSplitView>("list");
	const [changesView, setChangesView] = useState<WorkspaceSplitView>("list");
	/** 终端本身：切回终端标签时把键盘输入接过去 */
	const terminalView = useRef<TerminalViewHandle | null>(null);

	/*
	 * 切回终端标签就把焦点交给它。
	 *
	 * 终端是保活的，切走再切回来不会重新挂载，`TerminalView` 挂载时那次聚焦也就不会发生；
	 * 面板宽度变化同理，尺寸由它自己的 `ResizeObserver` 重算，这里只管焦点。
	 */
	useEffect(() => {
		if (activeTab === "terminal") {
			terminalView.current?.focus();
		}
	}, [activeTab]);

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
	 * 顶栏左端的那枚箭头只在单栏态出现（样式按容器宽度藏），它就是把列表叫回来的入口。
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
				headerLeading={<BackToListButton onBack={() => setFilesView("list")} />}
				// 索引收起时，展开入口落在标题行最右端
				headerTrailing={
					isFileTreeCollapsed ? (
						<RestoreListButton label={t("panel.showTree")} onShow={() => setFileTreeCollapsed(false)} />
					) : null
				}
			/>
		);
	}

	/*
	 * 预览区的内容。
	 *
	 * 有文件时用 `FileView` 的标题行承载「返回列表」；空着、或者只剩一条读取失败的原文时
	 * 没有二级顶栏，入口改挂在卡片里，钻取到空预览之后总归有一个地方能点回去。
	 */
	const fileDetail =
		fileView !== null && docs.fileError === undefined ? (
			fileView
		) : (
			<>
				{fileView}
				<div className="workspace-split-empty">
					<BackToListButton onBack={() => setFilesView("list")} />
				</div>
			</>
		);

	/** 变更预览：停在提交上就看那一份补丁，否则看工作树，并定位到刚点的文件。 */
	const changesViewNode =
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
				toolbarLeading={<BackToListButton onBack={() => setChangesView("list")} />}
				toolbarTrailing={
					isChangesListCollapsed ? (
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
				toolbarLeading={<BackToListButton onBack={() => setChangesView("list")} />}
				toolbarTrailing={
					isChangesListCollapsed ? (
						<RestoreListButton label={t("panel.showChanges")} onShow={() => setChangesListCollapsed(false)} />
					) : null
				}
			/>
		);

	if (activeTab === null) {
		return <WorkspaceLauncher items={items} onPick={onOpenTab} />;
	}

	return (
		<div className="workspace-body">
			{openTabs.includes("files") ? (
				<div className={activeTab === "files" ? "workspace-view" : "workspace-view is-inactive"}>
					<WorkspaceSplit
						className="is-files"
						view={filesView}
						isListCollapsed={isFileTreeCollapsed}
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
										setFilesView("detail");
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
			) : null}
			{openTabs.includes("changes") ? (
				<div className={activeTab === "changes" ? "workspace-view" : "workspace-view is-inactive"}>
					<WorkspaceSplit
						className="is-changes"
						view={changesView}
						isListCollapsed={isChangesListCollapsed}
						detail={changesViewNode}
						list={
							<ChangesPane
								status={docs.changes.status}
								error={docs.changes.error}
								onRefresh={() => void docs.refreshChanges({ force: true })}
								onOpenDiff={(file) => {
									docs.focusDiff(file);
									setChangesView("detail");
								}}
								commits={docs.commits.data}
								commitsLoading={docs.commits.isLoading}
								commitsError={docs.commits.error}
								onCommitPress={(commit) => {
									if (sessionCwd !== undefined) {
										docs.openCommit(sessionCwd, commit);
										setChangesView("detail");
									}
								}}
								onCollapse={() => setChangesListCollapsed(true)}
							/>
						}
					/>
				</div>
			) : null}
			{/* 终端只切显隐：卸载会丢掉 PTY 会话与回滚，切回来还要重取一遍历史 */}
			{openTabs.includes("terminal") ? (
				<div className={activeTab === "terminal" ? "workspace-view" : "workspace-view is-inactive"}>
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
			) : null}
		</div>
	);
}

/**
 * 退回列表的小按钮。
 *
 * 只在单栏钻取时出现（两栏态由容器查询藏起来）：那时列表不在屏幕上，路径前面这枚向左的
 * 箭头就是唯一的退路。
 */
function BackToListButton({ onBack }: { onBack: () => void }): ReactNode {
	const { t } = useI18n();
	const label = t("panel.backToList");
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

/**
 * 把索引栏叫回来的小按钮。
 *
 * 图标指向右侧：索引栏在右边，展开它就是让内容从右侧长出来。文案即无障碍名称，同时用作
 * 悬浮提示（按钮本身只有图标）。两栏态才有「收起」这回事，单栏态由容器查询藏起来。
 */
function RestoreListButton({ label, onShow }: { label: string; onShow: () => void }): ReactNode {
	const tip = useHoverTip();
	return (
		<>
			<button
				type="button"
				className="workspace-head-action workspace-restore-list"
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
