/**
 * 对话区。
 *
 * 上面是投影后的会话内容，下面是提示、排队条与输入区；滚动位置与向上补历史都在对话
 * 状态那一层。
 */
import type { ChatView, SessionView, TextPart, TranscriptItem } from "@facet/client-core";
import type { QueuedInput } from "@facet/protocol";
import {
	ArrowDownIcon,
	ChatOutline,
	ChatTranscript,
	Composer,
	type ComposerHandle,
	ExtensionPromptCard,
	ICON_SIZE,
	outlineIsActive,
	outlinePrompts,
	QueueStrip,
	useI18n,
} from "@facet/ui";
import { type ReactNode, type RefObject, useMemo } from "react";
import type { Composer as ComposerState } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import type { SessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import type { Transcript } from "../hooks/useTranscript.ts";
import { useHostClient } from "../host-context.tsx";

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
	/** 可 `@` 引用的文件：项目根下的相对路径 */
	mentionFiles: readonly string[];
	/** 会话错误条 */
	errorBar: ReactNode;
	/** 标签菜单与文本的复制动作 */
	copyText: (text: string) => void;
	/** 输入区的命令式句柄：引用之后把结构插进去、光标放回末尾 */
	composerInput: RefObject<ComposerHandle | null>;
	/** 点输入区里的 `@文件` 胶囊：打开右栏的文件页并把它打开 */
	onOpenMentionFile: (filePath: string) => void;
}

/** 当前会话里用户发过的文字，从旧到新：输入区的 `↑`/`↓` 按它回溯。 */
function sentTexts(items: readonly TranscriptItem[]): string[] {
	const texts: string[] = [];
	for (const item of items) {
		if (item.role !== "user") {
			continue;
		}
		texts.push(
			item.parts
				.filter((part): part is TextPart => part.kind === "text")
				.map((part) => part.text)
				.join("\n")
				.trim(),
		);
	}
	return texts;
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
		composerInput,
		mentionFiles,
		onOpenMentionFile,
	} = props;
	const { t } = useI18n();
	const client = useHostClient();
	const providerAuth = host.catalog.auth;
	/** 已发消息按条记忆：流式期间每帧只有末尾那条换新，回溯用的列表不必重算 */
	const sentHistory = useMemo(() => sentTexts(transcript.items), [transcript.items]);
	/*
	 * 导航轨是不是要在：只看有没有可跳的条目，与窗口宽度无关。宽窄由三列网格的右轨兜着，
	 * 消息列与输入区共用同一个标记，两者的左右边缘因此始终对齐。
	 */
	const outlineActive = useMemo(
		() => outlineIsActive(outlinePrompts(transcript.items, () => "")),
		[transcript.items],
	);
	const outlineAttr = outlineActive ? "true" : "false";
	return (
		<>
			<ChatOutline
				// 换会话重挂：高亮状态属于某一个会话，留着上一轮的索引会先闪一下旧位置
				key={openedSessionId ?? "session"}
				items={transcript.items}
				container={transcript.scrollElement}
				viewport={transcript.viewport}
			/>
			<div
				className="chat-viewport"
				data-can-scroll-top={transcript.edges.top ? "true" : "false"}
				data-can-scroll-bottom={transcript.edges.bottom ? "true" : "false"}
				data-outline-active={outlineAttr}
			>
				<section className="scroll scroll-y-hidden" ref={transcript.scrollRef}>
					<ChatTranscript
						// 换会话一律重挂：实测高度、待恢复的位置与收起状态都只属于某一个会话
						key={openedSessionId ?? "session"}
						items={transcript.items}
						scrollElement={transcript.scrollElement}
						viewportRef={transcript.viewport}
						onRestoreLost={transcript.scrollToBottom}
						// 贴底时由跟随逻辑守底部，虚拟化器不要自己挪位置（否则会被当成用户上翻而脱钩）
						pinned={transcript.isPinned}
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
				</section>
				<div className="chat-fade is-top" aria-hidden="true" />
				<div className="chat-fade is-bottom" aria-hidden="true" />
			</div>

			<div className="footer" data-outline-active={outlineAttr}>
				{transcript.isPinned ? null : (
					<button
						type="button"
						className="to-bottom"
						aria-label={t("app.backToBottom")}
						onClick={() => transcript.scrollToBottom("smooth")}
					>
						<ArrowDownIcon size={ICON_SIZE.lg} />
					</button>
				)}
				<div className="footer-column chat-grid">
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
						ref={composerInput}
						value={composer.draft}
						onChange={composer.updateDraft}
						onSend={composer.send}
						isSending={composer.isSending}
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
						mentionFiles={mentionFiles}
						draftKey={composer.draftKey}
						sentHistory={sentHistory}
						onOpenMentionFile={onOpenMentionFile}
						commands={[...composer.commands]}
						onRunCommand={(command, args) => {
							composer.runFacetCommand(command.name, args);
						}}
					/>
				</div>
			</div>
		</>
	);
}
