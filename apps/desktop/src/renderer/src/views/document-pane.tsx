/**
 * 主区域的内容。
 *
 * 按当前标签的种类摆文件、提交、变更、终端或会话；会话那一路交给对话区，这里只管
 * 文档与空状态。
 */
import type { SessionView } from "@facet/client-core";
import type { GitFileChange } from "@facet/protocol";
import type { MainTab } from "@facet/ui";
import { ChangesDocument, EmptyState, useI18n } from "@facet/ui";
import { FileView } from "@facet/ui-editor";
import { TerminalView } from "@facet/ui-terminal";
import type { ReactNode } from "react";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import type { MainTabs } from "../hooks/useMainTabs.ts";
import type { SessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import type { TerminalPanel } from "../hooks/useTerminalPanel.ts";
import { useHostClient, useHostTerminalClient } from "../host-context.tsx";

export interface DocumentPaneProps {
	/** 连接域 */
	host: HostConnection;
	/** 会话域 */
	session: SessionLifecycle;
	/** 标签域 */
	tabs: MainTabs;
	/** 终端域 */
	terminal: TerminalPanel;
	/** 当前会话视图 */
	sessionView: SessionView | undefined;
	/** 没有打开会话时新建落在的目录 */
	emptyCreateCwd: string | undefined;
	/** 会话错误条 */
	errorBar: ReactNode;
	/** 会话本身的内容，由对话区给出 */
	chat: ReactNode;
}

/** 摆当前标签指向的文档、终端或空状态。 */
export function DocumentPane(props: DocumentPaneProps): ReactNode {
	const { host, session, tabs, terminal, sessionView, emptyCreateCwd, errorBar, chat } = props;
	const { t } = useI18n();
	const client = useHostClient();
	const terminalClient = useHostTerminalClient();
	const activeTab: MainTab | undefined = tabs.tabs.find((item) => item.id === tabs.activeTabId);
	const fileTab = activeTab?.kind === "file" ? activeTab : undefined;
	const commitTab = activeTab?.kind === "commit" ? activeTab : undefined;
	const changesTab = activeTab?.kind === "changes" ? activeTab : undefined;
	const commitDetail = commitTab === undefined ? undefined : tabs.commitDetails[commitTab.id];
	const fileContent = fileTab === undefined ? undefined : tabs.fileContents[fileTab.id];
	return (
		<>
			{fileTab !== undefined ? (
				<section className="main-view is-file">
					{fileContent === undefined ? null : (
						<FileView
							key={fileTab.id}
							path={fileTab.path}
							content={fileContent}
							onSave={(text, expectedRevision) =>
								client.writeFile(fileTab.cwd, fileTab.path, text, expectedRevision)
							}
							onReload={async () => {
								const next = await client.readFile(fileTab.cwd, fileTab.path);
								tabs.setFileContent(fileTab.id, next);
								return next;
							}}
						/>
					)}
				</section>
			) : commitTab !== undefined ? (
				<section className="main-view is-changes">
					<ChangesDocument
						key={commitTab.id}
						title={`${commitTab.shortSha} · ${commitTab.subject}`}
						emptyMessage={t("panel.noCommitChanges")}
						status={
							commitDetail?.detail === undefined
								? undefined
								: {
										isRepo: true,
										branch: commitTab.shortSha,
										files: commitDetail.detail.files,
									}
						}
						error={commitDetail?.error}
						focusPath={undefined}
						focusRequestId={undefined}
						loadDiff={(file: GitFileChange) =>
							client.gitCommitDiff(commitTab.cwd, commitTab.sha, file.path, file.oldPath)
						}
						onRefresh={() => void tabs.loadCommit(commitTab.id, commitTab.cwd, commitTab.sha)}
						commits={undefined}
						commitsLoading={false}
						commitsError={undefined}
					/>
				</section>
			) : changesTab !== undefined ? (
				<section className="main-view is-changes">
					<ChangesDocument
						key={changesTab.id}
						status={tabs.changes.status}
						error={tabs.changes.error}
						focusPath={changesTab.focusPath}
						focusRequestId={changesTab.focusRequestId}
						loadDiff={(file: GitFileChange) =>
							client.gitDiff(changesTab.cwd, file.path, file.status === "untracked")
						}
						onRefresh={() => void tabs.refreshChanges({ force: true })}
						commits={tabs.commits.data}
						commitsLoading={tabs.commits.isLoading}
						commitsError={tabs.commits.error}
						onCommitPress={(commit) => tabs.openCommit(changesTab.cwd, commit)}
					/>
				</section>
			) : activeTab?.kind === "terminal" ? (
				<section className="main-view is-terminal">
					<TerminalView
						key={activeTab.terminalId}
						terminalId={activeTab.terminalId}
						client={terminalClient}
						appearance={terminal.appearance}
					/>
				</section>
			) : sessionView === undefined ? (
				<div className="empty-wrap">
					{errorBar}
					<EmptyState
						cwd={emptyCreateCwd}
						canCreate={host.phase === "ready"}
						onCreate={() => {
							if (emptyCreateCwd !== undefined) {
								session.createSession(emptyCreateCwd);
							}
						}}
						onAddProject={session.openProjectDialog}
					/>
				</div>
			) : (
				chat
			)}
		</>
	);
}
