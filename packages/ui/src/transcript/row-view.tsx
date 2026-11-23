/**
 * 面板里的一行。
 *
 * 按行的种类画各自的形状：用户气泡、助手正文、过程组、分叉与分界、错误行。这里只认渲染单元与
 * 回调，行的聚合与收起状态在 `rows.tsx`；过程行里的部件、外壳与消息图片各自一个文件。
 *
 * 内容没变时行对象沿用的是同一个，回调身份也不变，所以整行 `memo` 住：流式期间每帧只有末尾
 * 那一两行真的重建。
 */
import type { MessageImage } from "@facet/client-core";
import { CircleAlert, ListCollapse, Split, Undo2, Wrench } from "lucide-react";
import { memo, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Markdown } from "../markdown/Markdown.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ChevronIcon, TreeChevron } from "./chevron.tsx";
import type { DisplayRow } from "./group.ts";
import { groupLabel, turnDurationText } from "./group.ts";
import { MessageAction } from "./message-action.tsx";
import { imagesOf, MessageImages } from "./message-images.tsx";
import { bodyOf, isAborted, PartView, StoppedNote } from "./row-parts.tsx";
import { CopyButton, Shell, textOf, useUntilFound } from "./row-shell.tsx";

/** 一行要用到的状态与回调。 */
export interface RowViewProps {
	/** 这一行 */
	row: DisplayRow;
	/** 行在虚拟列表里的下标；不虚拟化时不给 */
	rowIndex?: number | undefined;
	/** 测量回调，虚拟化器按它回填实测高度；不虚拟化时不给 */
	measureRef?: ((node: HTMLElement | null) => void) | undefined;
	/** 用户收起过这一行，缺省按行的种类决定 */
	isCollapsed: boolean;
	/** 第一条用户消息的行标识，它前面没有可回退的轮次 */
	firstUserRowId: string | undefined;
	/** 分叉行要复制的原文：这一轮最后一条答复 */
	forkText: string;
	/** 最后一条用户消息的条目 id，重试按它重发 */
	retryEntryId: string | undefined;
	/** 最后一条用户消息的原文 */
	retryText: string;
	/** 最后一条用户消息附带的图片 */
	retryImages: readonly MessageImage[];
	/** 计时的当前时刻，只有分叉行需要 */
	now: number | undefined;
	/** 是否允许分叉 */
	canFork: boolean;
	/** 是否允许回退 */
	canRevert: boolean;
	/** 切换这一行的收起状态 */
	onToggle: (row: DisplayRow) => void;
	onFork: (beforeEntryId: string | undefined) => void;
	onRevert: (entryId: string, text: string, images: readonly MessageImage[]) => void;
	onRetryTurn?: ((entryId: string, text: string, images: readonly MessageImage[]) => void) | undefined;
	onCopyDetails?: ((text: string) => void) | undefined;
	onCopyText?: ((text: string) => void) | undefined;
}

/**
 * 面板里的一行。
 *
 * 内容没变时行对象沿用的是同一个，回调身份也不变，这里直接跳过重渲染：流式期间每帧
 * 只有末尾那一两行真的重建。
 */
export const RowView = memo(function RowView({
	row,
	rowIndex,
	measureRef,
	isCollapsed,
	firstUserRowId,
	forkText,
	retryEntryId,
	retryText,
	retryImages,
	now,
	canFork,
	canRevert,
	onToggle,
	onFork,
	onRevert,
	onRetryTurn,
	onCopyDetails,
	onCopyText,
}: RowViewProps): ReactNode {
	const { t } = useI18n();
	/*
	 * 收起体常驻 DOM 并标 `hidden="until-found"`：页内查找命中它时自动展开。
	 * 这个 Hook 必须在所有分支之前无条件跑一遍——同一个位置的行会换种类，按分支调用会让
	 * 两次渲染的 Hook 数量对不上。
	 */
	const groupBody = useUntilFound<HTMLDivElement>(!isCollapsed, () => onToggle(row));

	if (row.kind === "fork") {
		const fork = row.fork;
		if (fork === undefined) {
			return null;
		}
		// 收在这一轮的末尾：复制、分叉，右边是这一轮工作了多久；悬停才显形
		return (
			<Shell className="is-fork" rowId={row.id}>
				<div className="turn-foot">
					<div className="turn-actions">
						{onCopyText === undefined || forkText.length === 0 || row.isStreaming ? null : (
							<CopyButton text={forkText} onCopy={onCopyText} />
						)}
						<MessageAction
							action="fork"
							label={t("transcript.fork")}
							disabled={fork.needsSettle && !canFork}
							onClick={() => onFork(fork.beforeEntryId)}
						>
							<Split size={ICON_SIZE.md} />
						</MessageAction>
					</div>
					{turnDurationText(row, now, t).length === 0 ? null : (
						<span className="turn-time">{turnDurationText(row, now, t)}</span>
					)}
				</div>
			</Shell>
		);
	}

	if (row.kind === "divider") {
		const text = row.items
			.flatMap((item) => item.parts)
			.map((part) => (part.kind === "text" ? part.text : ""))
			.join("");
		const label =
			row.items[0]?.kind === "compaction" ? t("transcript.compactionSummary") : t("transcript.branchSummary");
		return (
			<Shell className="is-divider" rowId={row.id}>
				<details className="context-summary">
					<summary className="divider">
						<span className="line" />
						<ListCollapse size={ICON_SIZE.md} aria-hidden="true" />
						<span>{label}</span>
						<span className="context-summary-chevron" aria-hidden="true">
							<ChevronIcon isOpen={false} />
						</span>
						<span className="line" />
					</summary>
					<div className="context-summary-body">
						<Markdown text={text} isStreaming={false} indexKey={`summary:${row.id}`} />
					</div>
				</details>
			</Shell>
		);
	}

	if (row.kind === "error") {
		const text = textOf(row.items.flatMap((item) => item.parts));
		const message = text.length > 0 ? text : t("transcript.runError");
		// 重试按最后一条用户消息重发一次,失败的那条助手消息留在历史里
		const canRetry = onRetryTurn !== undefined && canRevert && retryEntryId !== undefined;
		// 一条带色底的提示：图标固定在左上，正文自己换行，动作是文字按钮
		return (
			<Shell className="is-error" rowId={row.id}>
				<div className="error-line" role="alert">
					<CircleAlert className="error-mark" size={ICON_SIZE.lg} />
					<div className="error-body">
						<div className="error-text">{message}</div>
						{!canRetry && onCopyDetails === undefined ? null : (
							<div className="error-actions">
								{canRetry ? (
									<button
										type="button"
										className="error-btn"
										onClick={() => onRetryTurn(retryEntryId as string, retryText, retryImages)}
									>
										{t("transcript.retry")}
									</button>
								) : null}
								{onCopyDetails === undefined ? null : (
									<button type="button" className="error-btn" onClick={() => onCopyDetails(message)}>
										{t("transcript.copyDetails")}
									</button>
								)}
							</div>
						)}
					</div>
				</div>
			</Shell>
		);
	}

	if (row.kind === "user") {
		const text = textOf(row.items.flatMap((item) => item.parts));
		// 回退要把图片一起带回输入区：只还文本的话，用户截图就悄悄丢了
		const images = imagesOf(row.items);
		// 回退要有落地过的条目:实时消息在提升之前没有条目 id
		const entryId = row.items[0]?.entryId;
		// 第一条用户消息之前没有可回退的轮次
		const canRevertThis = canRevert && entryId !== undefined && row.id !== firstUserRowId;
		return (
			<Shell className="is-user" rowId={row.id} rowIndex={rowIndex} measureRef={measureRef}>
				<MessageImages id={row.id} items={row.items} />
				{/* 只有图片没有文字时不出空气泡 */}
				{text.length === 0 ? null : (
					<div className="user-line">
						<div className="bub">{text}</div>
					</div>
				)}
				{!canRevertThis && onCopyText === undefined ? null : (
					<div className="user-foot">
						{onCopyText === undefined ? null : <CopyButton text={text} onCopy={onCopyText} isReveal />}
						{canRevertThis ? (
							<MessageAction
								action="revert"
								label={t("transcript.revert")}
								isReveal
								onClick={() => onRevert(entryId, text, images)}
							>
								<Undo2 size={ICON_SIZE.md} />
							</MessageAction>
						) : null}
					</div>
				)}
			</Shell>
		);
	}

	if (row.kind === "meta") {
		// 收起时是一行图标加标题，展开时标题变成药丸底、左侧换成下箭头
		return (
			<Shell className="is-process" rowId={row.id} rowIndex={rowIndex} measureRef={measureRef}>
				<div className="group">
					<button
						type="button"
						className={isCollapsed ? "group-head" : "group-head is-open"}
						onClick={() => onToggle(row)}
						aria-expanded={!isCollapsed}
						aria-label={t("transcript.process")}
					>
						<span className="group-icon">
							{isCollapsed ? <Wrench size={ICON_SIZE.md} /> : <TreeChevron isOpen />}
						</span>
						<span className={row.isStreaming ? "group-label is-live" : "group-label"}>
							{groupLabel(row, t)}
						</span>
					</button>
					<div className="group-body" ref={groupBody}>
						{row.items.flatMap((item) =>
							item.parts.map((part) => (
								<PartView key={`${item.id}-${part.partId}`} part={part} isStreaming={item.isStreaming} />
							)),
						)}
					</div>
					{isAborted(row) ? <StoppedNote /> : null}
				</div>
			</Shell>
		);
	}

	return (
		<Shell className="is-assistant" rowId={row.id} rowIndex={rowIndex} measureRef={measureRef}>
			<MessageImages id={row.id} items={row.items} />
			<div className="assistant-body">
				{bodyOf(row)}
				{isAborted(row) ? <StoppedNote /> : null}
			</div>
		</Shell>
	);
});
