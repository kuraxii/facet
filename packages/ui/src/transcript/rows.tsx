/**
 * 对话面板。
 *
 * 行由渲染单元聚合而来,收起状态按行标识保存,所以流式追加内容时不会把用户收起过的行重新展开。
 * 默认只有过程行与文件改动行收起,其余行展开。
 */
import type { Part, ToolCallPart, TranscriptItem } from "@facet/client-core";
import { Split, Undo2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Markdown } from "../markdown/Markdown.tsx";
import { type DiffChunk, type DisplayRow, groupRows, metaSummary } from "./group.ts";
import { foldOutput, toolStatusText, toolTarget } from "./tool-text.ts";

/** 面板参数。 */
export interface ChatTranscriptProps {
	/** 数据侧投影出的渲染单元,顺序即消息顺序 */
	items: readonly TranscriptItem[];
	/** 是否允许分叉,本轮结束前不允许 */
	canFork: boolean;
	/** 在某一轮结束处分叉,传入下一轮开始处条目的 id；缺省表示最后一轮 */
	onFork: (beforeEntryId: string | undefined) => void;
	/** 是否允许回退到某条用户消息之前,本轮结束前不允许 */
	canRevert: boolean;
	/** 回退到这条用户消息之前的一轮末尾,连同这条消息的文本一起带出 */
	onRevert: (entryId: string, text: string) => void;
	/** 正在进行的自动重试,没有则为空 */
	retry?: { attempt: number; maxAttempts: number; delayMs: number } | undefined;
	/** 重试这一轮:按最后一条用户消息重新发一次,不重复添加用户消息 */
	onRetryTurn?: ((entryId: string, text: string) => void) | undefined;
	/** 打开设置里与错误有关的那一页 */
	onOpenSettings?: (() => void) | undefined;
	/** 复制错误详情 */
	onCopyDetails?: ((text: string) => void) | undefined;
	/** 没有任何内容时显示的提示 */
	emptyHint?: string;
	/** 实时消息提升为历史消息时的标识迁移，用来搬动按行标识保存的收起状态 */
	renames?: Readonly<Record<string, string>> | undefined;
}

/**
 * 运行中的计时器。
 *
 * 回合还在跑的时候没有结束时间,界面每秒取一次当前时间自己计时;没有运行中的行时不挂定时器。
 */
/** 重试倒计时的文案,没有剩余时间时为空。 */
function retryDelayText(
	delayMs: number,
	startedAt: number | undefined,
	now: number | undefined,
): string | undefined {
	if (delayMs <= 0 || startedAt === undefined || now === undefined) {
		return undefined;
	}
	const left = Math.ceil((startedAt + delayMs - now) / 1000);
	return left <= 0 ? "正在重试…" : `${left} 秒后重试`;
}

function useNow(isTicking: boolean): number | undefined {
	const [now, setNow] = useState<number | undefined>(undefined);
	useEffect(() => {
		if (!isTicking) {
			setNow(undefined);
			return;
		}
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [isTicking]);
	return now;
}

/** 默认收起的行。 */
function isCollapsedByDefault(kind: DisplayRow["kind"]): boolean {
	return kind === "meta" || kind === "diff";
}

function textOf(parts: readonly Part[]): string {
	return parts
		.map((part) => (part.kind === "text" ? part.text : ""))
		.join("")
		.trim();
}

/** 收起时显示的一行预览。 */
function preview(text: string, limit = 48): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** 过程中最近一次工具调用,运行中时显示在过程行右侧。 */
function activeTool(row: DisplayRow): string {
	let name = "";
	for (const item of row.items) {
		for (const part of item.parts) {
			if (part.kind === "toolCall") {
				name = part.name;
			}
		}
	}
	return name;
}

function shortPath(path: string): string {
	const parts = path.split("/").filter((segment) => segment.length > 0);
	return parts.length <= 2 ? parts.join("/") : parts.slice(-2).join("/");
}

function lineClass(line: string): string {
	if (line.startsWith("@@") || line.startsWith("+++ ") || line.startsWith("--- ")) {
		return "is-meta";
	}
	if (line.startsWith("+")) {
		return "is-add";
	}
	if (line.startsWith("-")) {
		return "is-del";
	}
	return "";
}

/** 补丁按行拆开并带上行号,键用累计偏移,刷新时不会错位。 */
function patchLines(patch: string): readonly { key: string; line: string; number: string }[] {
	const lines: { key: string; line: string; number: string }[] = [];
	let offset = 0;
	let oldLine = 0;
	let newLine = 0;
	for (const line of patch.split("\n")) {
		const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
		if (header) {
			oldLine = Number(header[1]);
			newLine = Number(header[2]);
		}
		let number = "";
		if (!header && !line.startsWith("+++ ") && !line.startsWith("--- ") && !line.startsWith("diff ")) {
			if (line.startsWith("-")) {
				number = String(oldLine);
				oldLine += 1;
			} else if (line.startsWith("+")) {
				number = String(newLine);
				newLine += 1;
			} else {
				number = String(newLine);
				oldLine += 1;
				newLine += 1;
			}
		}
		lines.push({ key: `at-${offset}`, line, number });
		offset += line.length + 1;
	}
	return lines;
}

/** 一次工具调用卡。 */
function ToolCard({ part }: { part: ToolCallPart }) {
	const [isOpen, setOpen] = useState(part.status === "running");
	const [isExpanded, setExpanded] = useState(false);
	const output = part.output ?? "";
	const folded = foldOutput(output);
	const isLong = folded.hiddenLines > 0;
	const shown = isLong && !isExpanded ? folded.preview : output;
	const target = toolTarget(part.input);
	const statusText = toolStatusText(part.status, part.durationMs);

	return (
		<div className={`tool is-${part.status}`}>
			<button type="button" className="tool-head" onClick={() => setOpen((open) => !open)}>
				<i className={isOpen ? "chev is-open" : "chev"} />
				<span className="tool-name">{part.name}</span>
				{target.length > 0 ? <span className="tool-arg">{target}</span> : null}
				<span className="tool-status">
					{part.status === "running" ? <i className="dot is-warn pulse" /> : null}
					{statusText}
				</span>
			</button>
			{isOpen && output.length > 0 ? <pre className="tool-out">{shown}</pre> : null}
			{isOpen && isLong && !isExpanded ? (
				<button type="button" className="tool-more" onClick={() => setExpanded(true)}>
					已折叠 {folded.hiddenLines} 行 · 显示全部
				</button>
			) : null}
		</div>
	);
}

/** 一段思考。收起时只留一句预览。 */
function ThinkingLine({ text }: { text: string }) {
	const [isOpen, setOpen] = useState(false);
	return (
		<>
			<button type="button" className="think" onClick={() => setOpen((open) => !open)}>
				<i className={isOpen ? "chev is-open" : "chev"} />
				<em>思考</em>
				{isOpen ? null : <span className="preview">{preview(text, 60)}</span>}
			</button>
			{isOpen ? <pre className="think-text">{text}</pre> : null}
		</>
	);
}

/** 一段内容。正文走 Markdown,思考与工具各自成块。 */
function PartView({ part, isStreaming }: { part: Part; isStreaming: boolean }) {
	if (part.kind === "text") {
		return <Markdown text={part.text} isStreaming={isStreaming} />;
	}
	if (part.kind === "thinking") {
		return <ThinkingLine text={part.text} />;
	}
	return <ToolCard part={part} />;
}

/** 一轮的文件改动。文件是按钮,点开看这一段补丁。 */
function FilesRow({ diffs }: { diffs: readonly DiffChunk[] }) {
	const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
	const toggle = useCallback((callId: string) => {
		setOpened((previous) => {
			const next = new Set(previous);
			if (next.has(callId)) {
				next.delete(callId);
			} else {
				next.add(callId);
			}
			return next;
		});
	}, []);
	const totalAdded = diffs.reduce((sum, diff) => sum + diff.added, 0);
	const totalRemoved = diffs.reduce((sum, diff) => sum + diff.removed, 0);

	return (
		<>
			<div className="files">
				{diffs.map((diff) => {
					const file = diff.files[0];
					const isOpen = opened.has(diff.callId);
					return (
						<button key={diff.callId} type="button" className="fc" onClick={() => toggle(diff.callId)}>
							<i className={isOpen ? "chev is-open" : "chev"} />
							<span className="path" title={file ?? ""}>
								{file === undefined ? "未命名文件" : shortPath(file)}
							</span>
							<b className="add">+{diff.added}</b>
							<b className="del">−{diff.removed}</b>
						</button>
					);
				})}
				<span className="files-meta">
					{diffs.length} 个文件 · <b className="add">+{totalAdded}</b> <b className="del">−{totalRemoved}</b>
				</span>
			</div>
			{diffs
				.filter((diff) => opened.has(diff.callId))
				.map((diff) => (
					<div key={`patch:${diff.callId}`} className="diff-body">
						{patchLines(diff.patch).map(({ key, line, number }) => (
							<div key={key} className={`diff-line ${lineClass(line)}`}>
								<i>{number}</i>
								<span>{line}</span>
							</div>
						))}
					</div>
				))}
		</>
	);
}

/** 这一行是否被用户中止。 */
function isAborted(row: DisplayRow): boolean {
	return row.items.some((item) => item.stopReason === "aborted");
}

/** 中止的提示,挂在被截断的那一行末尾。 */
function StoppedNote(): ReactNode {
	return <div className="stopped-line">已停止</div>;
}

/** 答复行的正文:相邻的正文段合成一块 Markdown,思考与工具按原位置插入。 */
function bodyOf(row: DisplayRow): ReactNode[] {
	const nodes: ReactNode[] = [];
	let buffer: string[] = [];
	let index = 0;
	const flush = (isStreaming: boolean): void => {
		const text = buffer.join("\n\n").trim();
		buffer = [];
		if (text.length === 0) {
			return;
		}
		index += 1;
		nodes.push(
			<Markdown
				key={`md:${row.id}:${index}`}
				text={text}
				isStreaming={isStreaming}
				indexKey={`${row.id}:${index}`}
			/>,
		);
	};
	for (const item of row.items) {
		for (const part of item.parts) {
			if (part.kind === "text") {
				buffer.push(part.text);
				continue;
			}
			flush(item.isStreaming);
			nodes.push(<PartView key={`${item.id}-${part.partId}`} part={part} isStreaming={item.isStreaming} />);
		}
		flush(item.isStreaming);
	}
	if (nodes.length === 0) {
		nodes.push(
			<div key="empty" className="t3">
				(无正文)
			</div>,
		);
	}
	return nodes;
}

/** 一行外壳。 */
function Shell({
	className,
	children,
	outlineKey,
}: {
	className: string;
	children: ReactNode;
	/** 对话导航的定位键，只在用户消息行上给 */
	outlineKey?: string;
}) {
	return (
		<div className={`row ${className}`} data-outline-key={outlineKey}>
			{children}
		</div>
	);
}

/**
 * 对话面板。把渲染单元聚合成分行,并维护每行的收起状态。
 */
export function ChatTranscript({
	items,
	canFork,
	onFork,
	canRevert,
	onRevert,
	retry,
	onRetryTurn,
	onOpenSettings,
	onCopyDetails,
	emptyHint,
	renames,
}: ChatTranscriptProps) {
	const rows = useMemo(() => groupRows(items), [items]);
	// 第一条用户消息之前没有可回退的轮次
	const firstUserRowId = rows.find((row) => row.kind === "user")?.id;
	const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
	const isTicking = rows.some((row) => row.isStreaming && row.startedAt !== undefined);
	const now = useNow(isTicking);
	// 重试开始的时刻,倒计时以它为准;重试结束或次数变化时重新计时
	const retryKey = retry === undefined ? undefined : `${retry.attempt}/${retry.maxAttempts}`;
	const [retryStartedAt, setRetryStartedAt] = useState<number | undefined>(undefined);
	useEffect(() => {
		setRetryStartedAt(retryKey === undefined ? undefined : Date.now());
	}, [retryKey]);

	// 一轮结束、消息提升为历史消息后行标识会变，把按旧标识保存的收起状态搬到新标识上
	useEffect(() => {
		if (renames === undefined) {
			return;
		}
		setOverrides((previous) => {
			let next: Map<string, boolean> | undefined;
			for (const [from, to] of Object.entries(renames)) {
				const value = previous.get(from);
				if (value === undefined) {
					continue;
				}
				next ??= new Map(previous);
				next.delete(from);
				if (!next.has(to)) {
					next.set(to, value);
				}
			}
			return next ?? previous;
		});
	}, [renames]);

	const toggle = useCallback((row: DisplayRow) => {
		setOverrides((previous) => {
			const next = new Map(previous);
			const current = previous.get(row.id) ?? isCollapsedByDefault(row.kind);
			next.set(row.id, !current);
			return next;
		});
	}, []);

	if (rows.length === 0) {
		return <div className="empty">{emptyHint ?? "还没有消息"}</div>;
	}

	return (
		<>
			{rows.map((row) => {
				const isCollapsed = overrides.get(row.id) ?? isCollapsedByDefault(row.kind);

				if (row.kind === "diff") {
					return (
						<Shell key={row.id} className="is-files">
							<FilesRow diffs={row.diffs} />
						</Shell>
					);
				}

				if (row.kind === "fork") {
					const fork = row.fork;
					if (fork === undefined) {
						return null;
					}
					return (
						<Shell key={row.id} className="is-fork">
							<button
								type="button"
								className="fork-btn"
								aria-label="从这一轮往后继续"
								title="从这一轮往后继续"
								disabled={fork.needsSettle && !canFork}
								onClick={() => onFork(fork.beforeEntryId)}
							>
								<Split size={14} strokeWidth={1.5} />
							</button>
						</Shell>
					);
				}

				if (row.kind === "divider") {
					const text = row.items
						.flatMap((item) => item.parts)
						.map((part) => (part.kind === "text" ? part.text : ""))
						.join("");
					const label = row.items[0]?.kind === "compaction" ? "上下文已压缩" : "分支摘要";
					return (
						<Shell key={row.id} className="is-divider">
							<div className="divider">
								<span className="line" />
								{label}
								{text.length > 0 ? ` · ${preview(text, 40)}` : ""}
								<span className="line" />
							</div>
						</Shell>
					);
				}

				if (row.kind === "error") {
					const text = textOf(row.items.flatMap((item) => item.parts));
					const message = text.length > 0 ? text : "运行出错";
					// 重试按最后一条用户消息重发一次,失败的那条助手消息留在历史里
					const lastUser = [...rows].reverse().find((item) => item.kind === "user");
					const retryTarget =
						lastUser === undefined
							? undefined
							: {
									entryId: lastUser.items[0]?.entryId,
									text: textOf(lastUser.items.flatMap((item) => item.parts)),
								};
					const canRetry = onRetryTurn !== undefined && canRevert && retryTarget?.entryId !== undefined;
					return (
						<Shell key={row.id} className="is-error">
							<div className="error-line">
								<b>出错</b>
								<span className="t2">{message}</span>
							</div>
							<div className="error-actions">
								{canRetry ? (
									<button
										type="button"
										className="btn"
										onClick={() => onRetryTurn(retryTarget.entryId as string, retryTarget.text)}
									>
										重试
									</button>
								) : null}
								{onOpenSettings === undefined ? null : (
									<button type="button" className="btn" onClick={onOpenSettings}>
										打开设置
									</button>
								)}
								{onCopyDetails === undefined ? null : (
									<button type="button" className="btn" onClick={() => onCopyDetails(message)}>
										复制详情
									</button>
								)}
							</div>
						</Shell>
					);
				}

				if (row.kind === "user") {
					const text = textOf(row.items.flatMap((item) => item.parts));
					// 回退要有落地过的条目:实时消息在提升之前没有条目 id
					const entryId = row.items[0]?.entryId;
					return (
						<Shell key={row.id} className="is-user" outlineKey={entryId ?? row.id}>
							<div className="user-line">
								<div className="bub">{text}</div>
							</div>
							{canRevert && entryId !== undefined && row.id !== firstUserRowId ? (
								<div className="user-foot">
									<button
										type="button"
										className="revert-btn"
										aria-label="回退到这条消息之前"
										title="回退到这条消息之前"
										onClick={() => onRevert(entryId, text)}
									>
										<Undo2 size={12} strokeWidth={1.5} />
										回退
									</button>
								</div>
							) : null}
						</Shell>
					);
				}

				if (row.kind === "meta") {
					const active = activeTool(row);
					return (
						<Shell key={row.id} className="is-process">
							<div className="proc-box">
								<button
									type="button"
									className="proc"
									onClick={() => toggle(row)}
									aria-expanded={!isCollapsed}
									aria-label="过程"
								>
									<span className="summary">{metaSummary(row, now)}</span>
									{row.isStreaming ? (
										<span className="live">
											<i className="dot pulse" />
											{active.length > 0 ? `第 ${row.toolCount} 次 · ${active}` : "进行中"}
										</span>
									) : null}
								</button>
								{isCollapsed ? null : (
									<div className="proc-body">
										{row.items.flatMap((item) =>
											item.parts.map((part) => (
												<PartView
													key={`${item.id}-${part.partId}`}
													part={part}
													isStreaming={item.isStreaming}
												/>
											)),
										)}
									</div>
								)}
								{isAborted(row) ? <StoppedNote /> : null}
							</div>
						</Shell>
					);
				}

				return (
					<Shell key={row.id} className="is-assistant">
						<div className="assistant-body">
							{bodyOf(row)}
							{isAborted(row) ? <StoppedNote /> : null}
						</div>
					</Shell>
				);
			})}

			{retry ? (
				<Shell className="is-retry" key="retry">
					<div className="retry-line">
						<span className="chip is-warn">
							<i className="dot is-warn pulse" />第 {retry.attempt}/{retry.maxAttempts} 次重试
						</span>
						{retryDelayText(retry.delayMs, retryStartedAt, now) === undefined ? null : (
							<span className="t2">{retryDelayText(retry.delayMs, retryStartedAt, now)}</span>
						)}
					</div>
				</Shell>
			) : null}
		</>
	);
}
