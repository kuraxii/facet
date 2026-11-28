/**
 * 对话区。
 *
 * 上面是投影后的会话内容，下面是提示、排队条与输入区；滚动位置与向上补历史都在对话
 * 状态那一层。
 */
import type { ChatView, SessionView, TextPart, TranscriptItem } from "@facet/client-core";
import type { InputSettings, Message, QueuedInput } from "@facet/protocol";
import {
	ArrowDownIcon,
	Button,
	baseName,
	ChatOutline,
	ChatTranscript,
	Composer,
	type ComposerHandle,
	capabilitiesOf,
	ExtensionPromptCard,
	ICON_SIZE,
	outlineIsActive,
	outlinePrompts,
	QueueStrip,
	SteeringMessages,
	useI18n,
} from "@facet/ui";
import { RotateCcw } from "lucide-react";
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
	/** 本机优先的输入偏好（决定发送键位） */
	localInput: InputSettings;
	/** 当前会话是否已归档（Settled）；为 true 时顶部显示 Reopen 入口并在发送时自动恢复 */
	isSettled?: boolean;
	/** 从 Settled 恢复到活跃 Inbox */
	onReopen?: () => void;
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
		localInput,
		isSettled = false,
		onReopen,
	} = props;
	const { t } = useI18n();
	const client = useHostClient();
	const providerAuth = host.catalog.auth;
	const capabilities = capabilitiesOf(sessionView.state.capabilities);
	/** 已发消息按条记忆：流式期间每帧只有末尾那条换新，回溯用的列表不必重算 */
	const sentHistory = useMemo(() => sentTexts(transcript.items), [transcript.items]);
	const { sessionMessages, streamingChars } = useMemo(() => {
		const messages: Message[] = [];
		let chars = 0;
		for (const item of chat?.items ?? []) {
			if (item.message !== undefined) {
				messages.push(item.message);
			}
			if (item.isStreaming) {
				for (const part of Object.values(item.streaming)) {
					chars += part.text.length;
				}
			}
		}
		return { sessionMessages: messages, streamingChars: chars };
	}, [chat?.items]);
	/*
	 * 导航轨是不是要在：只看有没有可跳的条目，与窗口宽度无关。宽窄由三列网格的右轨兜着，
	 * 消息列与输入区共用同一个标记，两者的左右边缘因此始终对齐。
	 */
	const outlineActive = useMemo(
		() => outlineIsActive(outlinePrompts(transcript.items, () => "")),
		[transcript.items],
	);
	const outlineAttr = outlineActive ? "true" : "false";
	/*
	 * 静默回收的接线：裁剪点由客户端算（刚好在满两页水位时给出保留区首条），执行裁剪也回客户端。
	 * 什么时候真正动手由正文里的定时器按判据决定，这里只把当前的量递给它。
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `chat` 只作重算信号；裁剪点靠视图变化才可能变
	const reclaimCut = useMemo(() => client.historyTrimCut(), [client, chat]);
	const reclaim = useMemo(
		() => ({
			entryCount: chat?.items.length ?? 0,
			// 保留水位跟客户端自己的页大小走，写死数字会与实际装载量脱开
			retainMaxEntries: client.historyWatermark,
			cutViewId: reclaimCut?.cutViewId,
			isStreaming: activity !== "idle",
			isLoadingOlder: transcript.isLoadingOlder,
			sessionKey: sessionView.channel,
			onReclaim: () => {
				client.trimOlderHistory();
			},
		}),
		[chat, reclaimCut, activity, transcript.isLoadingOlder, sessionView.channel, client],
	);
	const composerElement = (
		<Composer
			ref={composerInput}
			value={composer.draft}
			onChange={composer.updateDraft}
			onSend={() => {
				if (isSettled) {
					onReopen?.();
				}
				composer.send();
			}}
			isSending={composer.isSending}
			attachments={composer.pendingImages.map((item) => ({
				id: item.id,
				name: item.name,
				previewUrl: item.previewUrl,
			}))}
			onPickImages={composer.pickImages}
			onAddImages={composer.addImages}
			canAddImages={
				capabilities.configStyle === "acp"
					? capabilities.supportsImages
					: (sessionView.state.model?.input.includes("image") ?? false)
			}
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
			capabilities={capabilities}
			acpMode={sessionView.state.acpMode}
			acpConfigOptions={sessionView.state.acpConfigOptions}
			onAcpModeChange={composer.setAcpMode}
			onAcpConfigOptionChange={composer.setAcpConfigOption}
			shiftEnterToSend={localInput.sendKey === "shiftEnter"}
			isBlocked={isBlocked}
			canStop={host.isOnline && host.host?.role !== "viewer"}
			contextUsage={sessionView.state.contextUsage}
			onLoadContextDetails={capabilities.hasContextBreakdown ? () => client.contextDetails() : undefined}
			sessionStats={sessionView.state.stats}
			sessionMessages={sessionMessages}
			streamingChars={streamingChars}
			isCompacting={activity === "compacting"}
			canCompact={activity === "idle" && capabilities.canCompact}
			onCompact={capabilities.canCompact ? () => client.compact() : undefined}
			mentionFiles={mentionFiles}
			draftKey={composer.draftKey}
			sentHistory={sentHistory}
			onOpenMentionFile={onOpenMentionFile}
			commands={[...composer.commands]}
			onRunCommand={(command, args) => {
				composer.runFacetCommand(command.name, args);
			}}
		/>
	);
	if (
		transcript.items.length === 0 &&
		activity === "idle" &&
		queued.steering.length === 0 &&
		sessionView.state.extensionUi.prompts.length === 0
	) {
		const projectName =
			sessionCwd !== undefined && sessionCwd.length > 0 ? baseName(sessionCwd) || sessionCwd : undefined;
		return (
			<div className="empty-wrap">
				{errorBar}
				{sessionView.state.initialization.kind === "failed" ? (
					<p className="dialog-error">{sessionView.state.initialization.message}</p>
				) : null}
				<div className="empty-main">
					<h1 className="empty-title">
						{projectName === undefined
							? t("empty.title")
							: t("empty.titleInProject", { project: projectName })}
					</h1>
					{composerElement}
				</div>
			</div>
		);
	}
	return (
		<>
			<ChatOutline
				items={transcript.items}
				container={transcript.scrollElement}
				canLoadOlder={transcript.hasMore}
				onLoadOlder={transcript.loadOlderNow}
			/>
			<div
				className="chat-viewport"
				data-can-scroll-top={transcript.edges.top ? "true" : "false"}
				data-can-scroll-bottom={transcript.edges.bottom ? "true" : "false"}
				data-outline-active={outlineAttr}
			>
				<section className="scroll scroll-y-hidden" ref={transcript.scrollRef}>
					{/* 正文打上标记：它里面的文字右键多一项「引用」 */}
					<div className="column chat-grid" data-quote-source>
						<ChatTranscript
							items={transcript.items}
							canFork={canFork && capabilities.canFork}
							onFork={(beforeEntryId) =>
								session.withTrust(sessionCwd, () => {
									void session.runSessionAction(async () => (await client.fork(beforeEntryId)).file);
								})
							}
							canRevert={canFork && capabilities.canRevert}
							onRevert={composer.revertTo}
							maintenance={sessionView.state.maintenance}
							isRunning={activity !== "idle"}
							onRetryTurn={composer.retryTurn}
							onCopyDetails={copyText}
							onCopyText={copyText}
							scrollElement={transcript.scrollElement}
							reclaim={reclaim}
						/>
						<SteeringMessages steering={queued.steering} onDemoteSteering={composer.demoteSteering} />
					</div>
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
					{isSettled && onReopen !== undefined ? (
						<div className="settled-banner">
							<Button variant="secondary" size="sm" onClick={onReopen}>
								<RotateCcw size={ICON_SIZE.sm} />
								{t("inbox.reopen")}
							</Button>
						</div>
					) : null}
					{sessionView.state.initialization.kind === "failed" ? (
						<p className="dialog-error">{sessionView.state.initialization.message}</p>
					) : null}
					{capabilities.supportsFollowUp ? (
						<QueueStrip
							queued={queued}
							onPromoteFollowUp={composer.promoteFollowUp}
							onEditFollowUp={composer.editFollowUp}
							onRemoveFollowUp={composer.removeFollowUp}
						/>
					) : null}
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
					{composerElement}
				</div>
			</div>
		</>
	);
}
