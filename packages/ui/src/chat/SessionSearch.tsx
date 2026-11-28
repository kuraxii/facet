/**
 * 跨主机全局任务搜索浮窗（`Cmd/Ctrl + K`）。
 *
 * 同时检索全部已连主机的活跃 Inbox 卡片、离线缓存与底部 `Settled` 归档会话，
 * 支持按项目快速过滤；键盘上下选择、回车直达对应主机与会话。
 */
import { Archive, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "../common/Input.tsx";
import { ListRow } from "../common/ListRow.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { Modal, useModalPresence } from "../modal.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import {
	collectInboxProjects,
	type InboxSearchEntry,
	type SidebarSettledItem,
	type SidebarTaskCard,
	searchInboxEntries,
} from "./inbox-model.ts";
import { SessionStatusMark } from "./session-status-mark.tsx";

/** 结果最多给这么多条，再多靠打字或项目过滤收窄。 */
const RESULT_LIMIT = 40;

export interface SessionSearchProps {
	/** 是否展开 */
	isOpen: boolean;
	/** 全部主机的活跃任务卡片 */
	activeCards: readonly SidebarTaskCard[];
	/** 已归档会话条目 */
	settledItems: readonly SidebarSettledItem[];
	/** 当前选中的联合键 `endpoint::file` */
	activeKey: string | undefined;
	/** 关闭浮窗 */
	onClose: () => void;
	/** 选中一条跨主机任务 */
	onSelectTarget: (endpoint: string, file: string, knownCwd?: string) => void;
}

export function SessionSearch({
	isOpen,
	activeCards,
	settledItems,
	activeKey,
	onClose,
	onSelectTarget,
}: SessionSearchProps) {
	const { t } = useI18n();
	const [keyword, setKeyword] = useState("");
	const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);
	const [selected, setSelected] = useState(0);

	const projectOptions = useMemo(
		() => (isOpen ? collectInboxProjects(activeCards, settledItems) : []),
		[activeCards, isOpen, settledItems],
	);

	const results = useMemo(() => {
		if (!isOpen) {
			return [];
		}
		return searchInboxEntries({
			activeCards,
			settledItems,
			keyword,
			projectFilter,
			limit: RESULT_LIMIT,
		});
	}, [activeCards, isOpen, keyword, projectFilter, settledItems]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		setKeyword("");
		setProjectFilter(undefined);
		setSelected(0);
	}, [isOpen]);

	useEffect(() => {
		setSelected((current) => (results.length === 0 ? 0 : Math.min(current, results.length - 1)));
	}, [results]);

	const open = useCallback(
		(entry: InboxSearchEntry) => {
			onSelectTarget(entry.endpoint, entry.file, entry.cwd);
			onClose();
		},
		[onClose, onSelectTarget],
	);

	const mounted = useModalPresence(isOpen);

	if (!mounted) {
		return null;
	}

	return (
		<Modal open={isOpen} onClose={onClose} label={t("search.title")} className="search-panel">
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
			{projectOptions.length > 0 ? (
				// biome-ignore lint/a11y/useSemanticElements: 搜索浮窗按项目过滤芯片条
				<div className="search-filters" role="group" aria-label={t("search.allProjects")}>
					<button
						type="button"
						className={projectFilter === undefined ? "search-filter-chip is-on" : "search-filter-chip"}
						onClick={() => setProjectFilter(undefined)}
					>
						{t("search.allProjects")}
					</button>
					{projectOptions.map((item) => (
						<button
							type="button"
							key={item.projectName}
							className={
								projectFilter === item.projectName ? "search-filter-chip is-on" : "search-filter-chip"
							}
							onClick={() =>
								setProjectFilter((current) => (current === item.projectName ? undefined : item.projectName))
							}
						>
							{item.projectName}
						</button>
					))}
				</div>
			) : null}
			<div className="search-results" role="listbox" aria-label={t("search.results")}>
				{results.length === 0 ? (
					<p className="search-empty">
						{keyword.trim().length === 0 ? t("search.emptyAll") : t("search.empty")}
					</p>
				) : (
					results.map((entry, index) => (
						<ListRow
							as="button"
							key={entry.key}
							size="md"
							selected={index === selected}
							role="option"
							aria-selected={index === selected}
							className="search-row"
							onPointerMove={() => setSelected(index)}
							onClick={() => open(entry)}
						>
							{entry.settled ? (
								<Archive size={ICON_SIZE.sm} className="search-settled-icon" aria-hidden />
							) : entry.bucket === "done" ? (
								<span className="status-mark" aria-hidden="true" />
							) : (
								<SessionStatusMark bucket={entry.bucket} />
							)}
							<span className="search-row-title ell">{entry.title}</span>
							{entry.projectName.length > 0 ? (
								<span className="search-row-proj ell">{entry.projectName}</span>
							) : null}
							<span className="search-row-host ell">{entry.hostLabel}</span>
							<span
								className={
									entry.key === activeKey ? "search-row-time mono is-active" : "search-row-time mono"
								}
							>
								{entry.timeText}
							</span>
						</ListRow>
					))
				)}
			</div>
		</Modal>
	);
}
