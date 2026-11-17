/**
 * 对话区。
 *
 * 上面是投影后的会话内容，下面是提示、排队条与输入区；滚动位置与向上补历史都在对话
 * 状态那一层。
 */
import type { ChatView, SessionView } from "@facet/client-core";
import type { QueuedInput } from "@facet/protocol";
import {
	ArrowDownIcon,
	ChatOutline,
	ChatTranscript,
	Composer,
	ExtensionPromptCard,
	QueueStrip,
	useI18n,
} from "@facet/ui";
import type { ReactNode } from "react";
import type { Composer as ComposerState } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import type { SessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import type { Transcript } from "../hooks/useTranscript.ts";
import { client } from "../runtime.ts";

export interface ChatAreaProps {
	/** 连接域 */
	host: HostConnection;
	/** 会话域 */
	session: SessionLifecycle;
	/** 输入区 */
	composer: ComposerState;
	/** 对话状态 */
	transcript: Transcript;
	/** 当前会话视图 */
	sessionView: SessionView;
	/** 当前对话视图 */
	chat: ChatView | undefined;
	/** 当前会话的标识 */
	openedSessionId: string | undefined;
	/** 对话此刻的状态 */
	activity: "idle" | "running" | "compacting" | "stopping";
	/** 会话所在的目录 */
	sessionCwd: string | undefined;
	/** 能否分叉与回退 */
	canFork: boolean;
	/** 现在不能发送 */
	isBlocked: boolean;
	/** 排队内容 */
	queued: QueuedInput;
	/** 会话错误条 */
	errorBar: ReactNode;
	/** 标签菜单与文本的复制动作 */
	copyText: (text: string) => void;
}

/** 对话区：内容、提示与输入。 */
export function ChatArea(props: ChatAreaProps): ReactNode {
	const {
		host,
		session,
		composer,
		transcript,
		sessionView,
		chat,
		openedSessionId,
		activity,
		sessionCwd,
		canFork,
		isBlocked,
		queued,
		errorBar,
		copyText,
	} = props;
	const { t } = useI18n();
	const providerAuth = host.catalog.auth;
	return (
		<>
			<ChatOutline items={transcript.items} container={transcript.scrollElement} />
			<section className="scroll" ref={transcript.scrollRef}>
				<div className="column">
					<ChatTranscript
						items={transcript.items}
						canFork={canFork}
						onFork={(beforeEntryId) =>
							session.withTrust(sessionCwd, () => {
								void session.runSessionAction(async () => (await client.fork(beforeEntryId)).file);
							})
						}
						canRevert={canFork}
						onRevert={composer.revertTo}
						maintenance={sessionView.state.maintenance}
						isRunning={activity !== "idle"}
						onRetryTurn={composer.retryTurn}
						onCopyDetails={copyText}
						onCopyText={copyText}
						renames={chat?.renames}
						emptyHint={t("app.emptyHint")}
					/>
				</div>
			</section>

			<div className="footer">
				{transcript.isPinned ? null : (
					<button
						type="button"
						className="to-bottom"
						aria-label={t("app.backToBottom")}
						onClick={() => transcript.scrollToBottom("smooth")}
					>
						<ArrowDownIcon size={16} />
					</button>
				)}
				<div className="footer-column">
					{errorBar}
					{sessionView.state.initialization.kind === "failed" ? (
						<p className="dialog-error">{sessionView.state.initialization.message}</p>
					) : null}
					<QueueStrip queued={queued} onClear={composer.takeBackQueue} />
					{sessionView.state.extensionUi.prompts[0] === undefined ? null : (
						<ExtensionPromptCard
							key={`${host.host?.hostId}:${sessionView.channel}:${sessionView.state.extensionUi.prompts[0].requestId}`}
							prompt={sessionView.state.extensionUi.prompts[0]}
							canRespond={host.isOnline && host.host?.role !== "viewer"}
							onRespond={async (response) => {
								await client.respondUi(
									sessionView.state.extensionUi.prompts[0]?.requestId ?? "",
									response,
									openedSessionId,
								);
							}}
						/>
					)}
					<Composer
						value={composer.draft}
						onChange={composer.updateDraft}
						onSend={composer.send}
						attachments={composer.pendingImages.map((item) => ({
							id: item.id,
							name: item.name,
							previewUrl: item.previewUrl,
						}))}
						onPickImages={composer.pickImages}
						onAddImages={composer.addImages}
						canAddImages={sessionView.state.model?.input.includes("image") ?? false}
						onRemoveAttachment={composer.removeImage}
						attachmentNotice={composer.imageNotice}
						onStop={() => client.cancel()}
						activity={activity}
						model={sessionView.state.model}
						thinkingLevel={sessionView.state.thinkingLevel}
						thinkingLevels={sessionView.state.availableThinkingLevels}
						models={host.catalog.models}
						providerAuth={providerAuth}
						onModelChange={(next) => client.setModel({ provider: next.provider, id: next.id })}
						onThinkingLevelChange={(level) => client.setThinkingLevel(level)}
						shiftEnterToSend={host.settings.input.sendKey === "shiftEnter"}
						isBlocked={isBlocked}
						canStop={host.isOnline && host.host?.role !== "viewer"}
						contextUsage={sessionView.state.contextUsage}
						isCompacting={activity === "compacting"}
						canCompact={activity === "idle"}
						onCompact={() => client.compact()}
						commands={[...composer.commands]}
						onRunCommand={(command, args) => {
							composer.runFacetCommand(command.name, args);
						}}
					/>

					{transcript.notices.length > 0 ? (
						<div className="notices">
							{transcript.notices.map((notice) => (
								<span
									key={`${notice.level}:${notice.message}`}
									className={
										notice.level === "error"
											? "chip is-error"
											: notice.level === "warning"
												? "chip is-warn"
												: "chip"
									}
								>
									{notice.message}
								</span>
							))}
						</div>
					) : null}
				</div>
			</div>
		</>
	);
}
