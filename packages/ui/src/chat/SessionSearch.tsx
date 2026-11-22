/**
 * 会话搜索浮窗。
 *
 * 居中偏上的一层，输入即按标题过滤；上下键选、回车打开、Esc 或点遮罩关闭。会话队列本身不
 * 参与过滤，浮窗关掉之后侧栏还是完整的一份列表。
 */
import type { SessionStatus, SessionSummary } from "@facet/protocol";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "../common/Input.tsx";
import { ListRow } from "../common/ListRow.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { Modal } from "../modal.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { SessionStatusMark } from "./session-status-mark.tsx";
import { type SidebarSession, searchSessions } from "./sidebar-model.ts";

/** 结果最多给这么多条，再多靠打字收窄。 */
const RESULT_LIMIT = 40;

export interface SessionSearchProps {
	/** 是否展开 */
	isOpen: boolean;
	/** 当前主机的会话列表 */
	sessions: readonly SessionSummary[];
	/** 当前会话文件路径，用来标出这一条 */
	activeFile: string | undefined;
	/** 各会话此刻的活动状态，按会话文件路径索引 */
	statuses: ReadonlyMap<string, SessionStatus>;
	/** 关闭浮窗 */
	onClose: () => void;
	/** 选中一条会话 */
	onSelect: (path: string) => void;
}

export function SessionSearch({
	isOpen,
	sessions,
	activeFile,
	statuses,
	onClose,
	onSelect,
}: SessionSearchProps) {
	const { t, i18n } = useI18n();
	const [keyword, setKeyword] = useState("");
	const [selected, setSelected] = useState(0);

	const results = useMemo(() => {
		if (!isOpen) {
			return [];
		}
		return searchSessions({
			sessions,
			projects: [],
			statuses,
			locale: i18n.language as "en" | "zh-CN",
			keyword,
			limit: RESULT_LIMIT,
			untitled: t("sidebar.untitled"),
		});
	}, [isOpen, sessions, statuses, keyword, t, i18n.language]);

	// 每次打开都从空关键词、第一条结果开始
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		setKeyword("");
		setSelected(0);
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
		<Modal open onClose={onClose} label={t("search.title")} className="search-panel">
			<label className="search-field">
				<Search size={ICON_SIZE.lg} />
				<Input
					variant="ghost"
					size="lg"
					data-autofocus
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
						if (event.key === "Enter" && !isComposingKey(event)) {
							const target = results[selected];
							if (target !== undefined) {
								event.preventDefault();
								open(target);
							}
						}
					}}
					placeholder={t("search.placeholder")}
					aria-label={t("search.placeholder")}
				/>
			</label>
			<div className="search-results" role="listbox" aria-label={t("search.results")}>
				{results.length === 0 ? (
					<p className="search-empty">
						{keyword.trim().length === 0 ? t("search.emptyAll") : t("search.empty")}
					</p>
				) : (
					results.map((session, index) => (
						<ListRow
							as="button"
							key={session.path}
							size="md"
							selected={index === selected}
							role="option"
							aria-selected={index === selected}
							className="search-row"
							onPointerMove={() => setSelected(index)}
							onClick={() => open(session)}
							disabled={session.isPlaceholder === true}
						>
							<SessionStatusMark bucket={session.bucket} />
							<span className="search-row-title ell">{session.title}</span>
							<span className="search-row-proj ell">{session.project}</span>
							<span
								className={
									session.path === activeFile ? "search-row-time mono is-active" : "search-row-time mono"
								}
							>
								{session.timeText}
							</span>
						</ListRow>
					))
				)}
			</div>
		</Modal>
	);
}
