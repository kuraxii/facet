/**
 * 对话面板。
 *
 * 行由渲染单元聚合而来,收起状态按行标识保存,所以流式追加内容时不会把用户收起过的行重新展开。
 * 默认只有过程行与文件改动行收起,其余行展开。
 */
import type { Part, ToolCallPart, TranscriptItem } from "@facet/client-core";
import { type CSSProperties, type ReactNode, useCallback, useMemo, useState } from "react";
import { type DiffChunk, type DisplayRow, formatDuration, groupRows, metaSummary } from "./group.ts";

/** 面板参数。 */
export interface ChatTranscriptProps {
	/** 数据侧投影出的渲染单元,顺序即消息顺序 */
	items: readonly TranscriptItem[];
	/** 是否允许分叉,运行中不允许 */
	canFork: boolean;
	/** 从某条消息分叉,传入消息标识 */
	onFork: (messageId: string) => void;
	/** 没有任何内容时显示的提示 */
	emptyHint?: string;
}

/** 默认收起的行。 */
function isCollapsedByDefault(kind: DisplayRow["kind"]): boolean {
	return kind === "meta" || kind === "diff";
}

function partText(parts: readonly Part[]): string {
	return parts
		.map((part) => (part.kind === "text" ? part.text : ""))
		.join("")
		.trim();
}

/** 收起时显示的一行预览。 */
function preview(text: string, limit = 60): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function roleLabel(row: DisplayRow): string {
	if (row.kind === "user") {
		return "我";
	}
	if (row.kind === "error") {
		return "出错";
	}
	return "助手";
}

/** 一段内容。思考与工具调用各自可折叠。 */
function PartView({ part }: { part: Part }) {
	if (part.kind === "text") {
		return <pre className="t-text">{part.text}</pre>;
	}
	if (part.kind === "thinking") {
		return (
			<details className="t-thinking">
				<summary>思考</summary>
				<pre>{part.text}</pre>
			</details>
		);
	}
	const input = part.input === undefined ? "" : JSON.stringify(part.input, null, 1).slice(0, 400);
	const status = part.status === "running" ? "执行中" : part.status === "failed" ? "失败" : "完成";
	return (
		<details className={`t-tool status-${part.status}`} open={part.status === "running"}>
			<summary>
				<span className="t-tool-name">{part.name}</span>
				<span className="t-tool-status">{status}</span>
				{part.durationMs === undefined ? null : (
					<span className="t-tool-time">{formatDuration(part.durationMs)}</span>
				)}
			</summary>
			{input.length > 0 ? <pre className="t-tool-input">{input}</pre> : null}
			{part.output === undefined ? null : <pre className="t-tool-output">{part.output}</pre>}
		</details>
	);
}

/** 文件改动的摘要,放在行头部。 */
function diffSummary(diff: DiffChunk): string {
	const files = diff.files.length === 0 ? "未命名文件" : diff.files.map(shortPath).join("、");
	return `${files} +${diff.added} −${diff.removed}`;
}

/** 文件改动的补丁正文。 */
function DiffPatch({ diff }: { diff: DiffChunk }) {
	return (
		<pre className="t-diff-patch">
			{patchLines(diff.patch).map(({ key, line }) => (
				<span key={key} className={`t-diff-line ${lineClass(line)}`}>
					{line}
					{"\n"}
				</span>
			))}
		</pre>
	);
}

/** 补丁里的路径是绝对路径,展示时只留末尾两段。 */
function shortPath(path: string): string {
	const parts = path.split("/").filter((segment) => segment.length > 0);
	return parts.length <= 2 ? parts.join("/") : parts.slice(-2).join("/");
}

/** 补丁按行拆开,行的键用累计偏移,补丁刷新时不会错位。 */
function patchLines(patch: string): readonly { key: string; line: string }[] {
	const lines: { key: string; line: string }[] = [];
	let offset = 0;
	for (const line of patch.split("\n")) {
		lines.push({ key: `at-${offset}`, line });
		offset += line.length + 1;
	}
	return lines;
}

function lineClass(line: string): string {
	if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
		return "is-meta";
	}
	if (line.startsWith("+")) {
		return "is-added";
	}
	if (line.startsWith("-")) {
		return "is-removed";
	}
	return "is-plain";
}

/** 行外壳:头部可点开收起,正文按需渲染。 */
function RowShell({
	row,
	label,
	summary,
	isCollapsed,
	onToggle,
	action,
	children,
}: {
	row: DisplayRow;
	label: string;
	summary: string;
	isCollapsed: boolean;
	onToggle: () => void;
	action?: ReactNode;
	children: ReactNode;
}) {
	const style = { "--row-depth": row.kind === "meta" || row.kind === "diff" ? "1" : "0" } as CSSProperties;
	return (
		<article className={`t-row kind-${row.kind}${isCollapsed ? " is-collapsed" : ""}`} style={style}>
			<div className="t-head">
				<button type="button" className="t-toggle" onClick={onToggle} aria-expanded={!isCollapsed}>
					<span className="t-caret">{isCollapsed ? "▸" : "▾"}</span>
					<span className="t-label">{label}</span>
					{summary.length > 0 ? <span className="t-summary">{summary}</span> : null}
					{row.isStreaming ? <span className="t-live">运行中</span> : null}
				</button>
				{action}
			</div>
			{isCollapsed ? null : <div className="t-body">{children}</div>}
		</article>
	);
}

/**
 * 对话面板。把渲染单元聚合成分行,并维护每行的收起状态。
 */
export function ChatTranscript({ items, canFork, onFork, emptyHint }: ChatTranscriptProps) {
	const rows = useMemo(() => groupRows(items), [items]);
	const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());

	const toggle = useCallback((row: DisplayRow) => {
		setOverrides((previous) => {
			const next = new Map(previous);
			const current = previous.get(row.id) ?? isCollapsedByDefault(row.kind);
			next.set(row.id, !current);
			return next;
		});
	}, []);

	if (rows.length === 0) {
		return <div className="t-empty">{emptyHint ?? "还没有消息"}</div>;
	}

	return (
		<div className="t-transcript">
			{rows.map((row) => {
				const isCollapsed = overrides.get(row.id) ?? isCollapsedByDefault(row.kind);

				if (row.kind === "diff") {
					const diff = row.diffs[0];
					if (!diff) {
						return null;
					}
					return (
						<RowShell
							key={row.id}
							row={row}
							label="文件改动"
							summary={diffSummary(diff)}
							isCollapsed={isCollapsed}
							onToggle={() => toggle(row)}
						>
							<DiffPatch diff={diff} />
						</RowShell>
					);
				}

				if (row.kind === "divider") {
					const text = row.items
						.flatMap((item) => item.parts)
						.map((part) => (part.kind === "text" ? part.text : ""));
					return (
						<div key={row.id} className="t-divider">
							{row.items[0]?.kind === "compaction" ? "上下文已压缩" : "分支摘要"}:{preview(text.join(""), 80)}
						</div>
					);
				}

				const text = partText(row.items.flatMap((item) => item.parts));
				const partViews = row.items.flatMap((item) =>
					item.parts.map((part) => <PartView key={`${item.id}-${part.partId}`} part={part} />),
				);

				return (
					<RowShell
						key={row.id}
						row={row}
						label={row.kind === "meta" ? "" : roleLabel(row)}
						summary={row.kind === "meta" ? metaSummary(row) : isCollapsed ? preview(text, 48) : ""}
						isCollapsed={isCollapsed}
						onToggle={() => toggle(row)}
						action={
							row.forkTarget !== undefined && canFork ? (
								<button type="button" className="t-fork" onClick={() => onFork(row.forkTarget as string)}>
									从这里分叉
								</button>
							) : null
						}
					>
						{partViews.length === 0 ? <pre className="t-text">(无内容)</pre> : partViews}
					</RowShell>
				);
			})}
		</div>
	);
}

/** 工具段的摘要,供外部列表复用。 */
export function toolSummary(part: ToolCallPart): string {
	const status = part.status === "running" ? "执行中" : part.status === "failed" ? "失败" : "完成";
	return part.durationMs === undefined
		? `${part.name} ${status}`
		: `${part.name} ${status} ${formatDuration(part.durationMs)}`;
}
