/**
 * 会话侧栏。
 *
 * 只做筛选与选择:过滤在本地完成,选中后由调用方打开会话。
 * 会话行展示标题、条数与时间,运行中的会话带一个状态点。
 */
import type { SessionSummary } from "@facet/protocol";
import { useMemo, useState } from "react";
import { PlusIcon, SearchIcon } from "../transcript/icons.tsx";

/** 侧栏参数。 */
export interface SessionSidebarProps {
	/** 会话列表,已按时间倒序 */
	sessions: readonly SessionSummary[];
	/** 当前会话的文件路径,没有打开会话时为空 */
	activeFile: string | undefined;
	/** 正在运行或等待应答的会话路径 */
	runningFile?: string | undefined;
	/** 项目目录,显示在底部 */
	projectDir: string;
	/** 选择一条会话 */
	onSelect: (summary: SessionSummary) => void;
	/** 新建会话 */
	onCreate: () => void;
	/** 新建是否可用,连接未就绪时不可用 */
	canCreate: boolean;
}

/** 相对时间,只到分钟。 */
function relativeTime(value: number): string {
	const diff = Date.now() - value;
	if (diff < 60_000) {
		return "刚刚";
	}
	if (diff < 3_600_000) {
		return `${Math.floor(diff / 60_000)} 分钟前`;
	}
	if (diff < 86_400_000) {
		return `${Math.floor(diff / 3_600_000)} 小时前`;
	}
	return `${Math.floor(diff / 86_400_000)} 天前`;
}

function titleOf(summary: SessionSummary): string {
	const name = summary.name?.trim();
	if (name !== undefined && name.length > 0) {
		return name;
	}
	const first = summary.firstMessage.trim();
	return first.length > 0 ? first.slice(0, 24) : "未命名会话";
}

/** 按标题与首条消息筛选。 */
export function filterSessions(
	sessions: readonly SessionSummary[],
	keyword: string,
): readonly SessionSummary[] {
	const trimmed = keyword.trim().toLowerCase();
	if (trimmed.length === 0) {
		return sessions;
	}
	return sessions.filter((summary) => {
		const haystack = `${summary.name ?? ""}\n${summary.firstMessage}`.toLowerCase();
		return haystack.includes(trimmed);
	});
}

export function SessionSidebar({
	sessions,
	activeFile,
	runningFile,
	projectDir,
	onSelect,
	onCreate,
	canCreate,
}: SessionSidebarProps) {
	const [keyword, setKeyword] = useState("");
	const visible = useMemo(() => filterSessions(sessions, keyword), [sessions, keyword]);
	const folder =
		projectDir
			.split("/")
			.filter((segment) => segment.length > 0)
			.pop() ?? projectDir;

	return (
		<aside className="sidebar">
			<div className="sidebar-head">
				<span className="sidebar-title">Facet</span>
				<button
					type="button"
					className="ib is-raised"
					aria-label="新会话"
					onClick={onCreate}
					disabled={!canCreate}
				>
					<PlusIcon size={16} />
				</button>
			</div>

			<label className="search">
				<SearchIcon size={14} />
				<input
					value={keyword}
					onChange={(event) => setKeyword(event.target.value)}
					placeholder="搜索会话"
					aria-label="搜索会话"
				/>
			</label>

			<div className="group-head">
				<i className="chev is-open" />
				{folder}
				<span className="count">{visible.length}</span>
			</div>

			<ul className="session-list">
				{visible.map((summary) => (
					<li key={summary.path}>
						<button
							type="button"
							className={summary.path === activeFile ? "sess is-active" : "sess"}
							onClick={() => onSelect(summary)}
						>
							{summary.path === runningFile ? <i className="dot pulse" /> : null}
							<b>{titleOf(summary)}</b>
							<span>
								{summary.messageCount} 条 · {relativeTime(summary.modified)}
							</span>
						</button>
					</li>
				))}
			</ul>

			<div className="sidebar-foot" title={projectDir}>
				{projectDir}
			</div>
		</aside>
	);
}
