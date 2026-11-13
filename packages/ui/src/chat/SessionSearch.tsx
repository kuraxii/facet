/**
 * 会话搜索浮窗。
 *
 * 居中偏上的一层，输入即按标题过滤；上下键选、回车打开、Esc 或点遮罩关闭。会话队列本身不
 * 参与过滤，浮窗关掉之后侧栏还是完整的一份列表。
 */
import type { SessionSummary } from "@facet/protocol";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SidebarSession, searchSessions, shortTime } from "./sidebar-model.ts";

/** 结果最多给这么多条，再多靠打字收窄。 */
const RESULT_LIMIT = 40;

export interface SessionSearchProps {
	/** 是否展开 */
	isOpen: boolean;
	/** 当前主机的会话列表 */
	sessions: readonly SessionSummary[];
	/** 当前会话文件路径，用来标出这一条 */
	activeFile: string | undefined;
	/** 正在运行的会话文件路径 */
	runningFile: string | undefined;
	/** 关闭浮窗 */
	onClose: () => void;
	/** 选中一条会话 */
	onSelect: (path: string) => void;
}

export function SessionSearch({
	isOpen,
	sessions,
	activeFile,
	runningFile,
	onClose,
	onSelect,
}: SessionSearchProps) {
	const [keyword, setKeyword] = useState("");
	const [selected, setSelected] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const results = useMemo(() => {
		if (!isOpen) {
			return [];
		}
		return searchSessions({
			sessions,
			projects: [],
			runningFile,
			keyword,
			limit: RESULT_LIMIT,
		});
	}, [isOpen, sessions, runningFile, keyword]);

	// 每次打开都从空关键词、第一条结果开始
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		setKeyword("");
		setSelected(0);
		const frame = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [isOpen]);

	// 结果变了之后选中项可能越界，收回最后一条
	useEffect(() => {
		setSelected((current) => (results.length === 0 ? 0 : Math.min(current, results.length - 1)));
	}, [results]);

	const open = useCallback(
		(session: SidebarSession) => {
			if (session.isPlaceholder === true) {
				return;
			}
			onSelect(session.path);
			onClose();
		},
		[onSelect, onClose],
	);

	if (!isOpen) {
		return null;
	}

	return (
		<div
			className="search-overlay"
			role="dialog"
			aria-modal="true"
			aria-label="搜索会话"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<div className="search-panel">
				<label className="search-field">
					<Search size={16} strokeWidth={1.5} />
					<input
						ref={inputRef}
						value={keyword}
						onChange={(event) => setKeyword(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								onClose();
								return;
							}
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setSelected((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
								return;
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								setSelected((current) =>
									results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
								);
								return;
							}
							if (event.key === "Enter") {
								const target = results[selected];
								if (target !== undefined) {
									event.preventDefault();
									open(target);
								}
							}
						}}
						placeholder="搜索会话"
						aria-label="搜索会话"
					/>
				</label>
				<div className="search-results" role="listbox" aria-label="搜索结果">
					{results.length === 0 ? (
						<p className="search-empty">{keyword.trim().length === 0 ? "还没有会话" : "没有匹配的会话"}</p>
					) : (
						results.map((session, index) => (
							<button
								key={session.path}
								type="button"
								role="option"
								aria-selected={index === selected}
								className={index === selected ? "search-row is-selected" : "search-row"}
								onPointerMove={() => setSelected(index)}
								onClick={() => open(session)}
								disabled={session.isPlaceholder === true}
							>
								<i className={session.dot === "running" ? "dot is-run pulse" : "dot is-off"} />
								<span className="search-row-title ell">{session.title}</span>
								<span className="search-row-proj ell">{session.project}</span>
								<span
									className={
										session.path === activeFile ? "search-row-time mono is-active" : "search-row-time mono"
									}
								>
									{shortTime(session.modified)}
								</span>
							</button>
						))
					)}
				</div>
			</div>
		</div>
	);
}
