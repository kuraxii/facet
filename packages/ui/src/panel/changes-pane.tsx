/**
 * 变更页。
 *
 * 列工作树相对 HEAD 的改动：分支与上下游、每个文件的状态与增删行数，点开在列表里就地看
 * unified diff。数据全部来自主机的 git，不读工具返回的补丁。
 */

import type { GitDiff, GitFileChange, GitFileStatus, GitStatus } from "@facet/protocol";
import { RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { lineClass, patchLines } from "../transcript/diff-lines.ts";

/** 状态字母。 */
const STATUS_LETTER: Record<GitFileStatus, string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
	untracked: "?",
	conflicted: "!",
};

/** 状态的悬浮说明。 */
const STATUS_LABEL: Record<GitFileStatus, string> = {
	added: "新增",
	modified: "修改",
	deleted: "删除",
	renamed: "重命名",
	untracked: "未跟踪",
	conflicted: "有冲突",
};

export interface ChangesPaneProps {
	/** 工作树状态；还没取到时为空 */
	status: GitStatus | undefined;
	/** 正在取状态 */
	isLoading: boolean;
	/** 取状态失败的原因 */
	error: string | undefined;
	/** 重新取状态 */
	onRefresh: () => void;
	/** 取某个文件的补丁 */
	loadDiff: (file: GitFileChange) => Promise<GitDiff>;
}

/** 一条改动记录的一行。 */
function ChangeRow({
	file,
	isOpen,
	onToggle,
	diff,
	diffError,
	isLoadingDiff,
	onRetryDiff,
}: {
	file: GitFileChange;
	isOpen: boolean;
	onToggle: () => void;
	diff: GitDiff | undefined;
	diffError: string | undefined;
	isLoadingDiff: boolean;
	onRetryDiff: () => void;
}): ReactNode {
	const name = file.path.split("/").pop() ?? file.path;
	const directory = file.path.slice(0, Math.max(0, file.path.length - name.length - 1));
	return (
		<li className="chg-item">
			<button type="button" className="chg-row" onClick={onToggle} aria-expanded={isOpen}>
				<ChevronIcon isOpen={isOpen} size={11} />
				<span className={`chg-status is-${file.status}`} title={STATUS_LABEL[file.status]}>
					{STATUS_LETTER[file.status]}
				</span>
				<span className="chg-name" title={file.path}>
					{name}
				</span>
				{directory.length === 0 ? null : <span className="chg-dir">{directory}</span>}
				<span className="chg-counts">
					{file.binary ? (
						<span className="chg-binary">二进制</span>
					) : (
						<>
							<b className="add">+{file.added}</b>
							<b className="del">−{file.removed}</b>
						</>
					)}
				</span>
			</button>
			{isOpen ? (
				<div className="chg-diff">
					{isLoadingDiff ? <p className="chg-note">正在取补丁…</p> : null}
					{diffError === undefined ? null : (
						<p className="chg-note is-error">
							{diffError}
							<button type="button" className="chg-retry" onClick={onRetryDiff}>
								重试
							</button>
						</p>
					)}
					{diff === undefined ? null : diff.binary ? (
						<p className="chg-note">二进制文件，不展示补丁</p>
					) : diff.patch.trim().length === 0 ? (
						<p className="chg-note">没有可展示的改动</p>
					) : (
						<>
							{diff.truncated ? <p className="chg-note">补丁过长，只显示前半部分</p> : null}
							<div className="diff-body">
								{patchLines(diff.patch).map(({ key, line, number }) => (
									<div key={key} className={`diff-line ${lineClass(line)}`}>
										<i>{number}</i>
										<span>{line}</span>
									</div>
								))}
							</div>
						</>
					)}
				</div>
			) : null}
		</li>
	);
}

export function ChangesPane({ status, isLoading, error, onRefresh, loadDiff }: ChangesPaneProps) {
	/** 展开的文件路径，一次只展开一个 */
	const [openPath, setOpenPath] = useState<string | undefined>(undefined);
	const [diffs, setDiffs] = useState<Readonly<Record<string, GitDiff>>>({});
	const [diffErrors, setDiffErrors] = useState<Readonly<Record<string, string>>>({});
	const [loadingPath, setLoadingPath] = useState<string | undefined>(undefined);

	/** 取补丁，结果按路径缓存；失败也记下来，给重试入口。 */
	const fetchDiff = useCallback(
		async (file: GitFileChange): Promise<void> => {
			setLoadingPath(file.path);
			setDiffErrors((current) => {
				const next = { ...current };
				delete next[file.path];
				return next;
			});
			try {
				const diff = await loadDiff(file);
				setDiffs((current) => ({ ...current, [file.path]: diff }));
			} catch (loadError) {
				setDiffErrors((current) => ({
					...current,
					[file.path]: loadError instanceof Error ? loadError.message : String(loadError),
				}));
			} finally {
				setLoadingPath((current) => (current === file.path ? undefined : current));
			}
		},
		[loadDiff],
	);

	/** 点一行：已展开就收起，未展开就先收起别的再展开它。 */
	const toggle = useCallback(
		(file: GitFileChange): void => {
			if (openPath === file.path) {
				setOpenPath(undefined);
				return;
			}
			setOpenPath(file.path);
			if (diffs[file.path] === undefined && diffErrors[file.path] === undefined) {
				void fetchDiff(file);
			}
		},
		[diffErrors, diffs, fetchDiff, openPath],
	);

	const header = (
		<div className="chg-head">
			<span className="chg-branch mono" title={status?.branch ?? ""}>
				{status?.branch ?? "…"}
				{status?.upstream === undefined ? null : (
					<span className="chg-upstream">
						↑{status.upstream.ahead} ↓{status.upstream.behind}
					</span>
				)}
			</span>
			<button
				type="button"
				className="ib"
				aria-label="刷新改动"
				title="刷新改动"
				onClick={onRefresh}
				disabled={isLoading}
			>
				<RefreshCw size={14} strokeWidth={1.5} />
			</button>
		</div>
	);

	if (error !== undefined) {
		return (
			<>
				{header}
				<p className="chg-note is-error">
					{error}
					<button type="button" className="chg-retry" onClick={onRefresh}>
						重试
					</button>
				</p>
			</>
		);
	}

	if (status === undefined) {
		return (
			<>
				{header}
				<p className="chg-note">正在读取改动…</p>
			</>
		);
	}

	if (!status.isRepo) {
		return (
			<>
				{header}
				<p className="chg-note">这个项目不是 Git 仓库，看不到改动。</p>
			</>
		);
	}

	if (status.files.length === 0) {
		return (
			<>
				{header}
				<p className="chg-note">工作树干净，没有未提交的改动。</p>
			</>
		);
	}

	const totalAdded = status.files.reduce((sum, file) => sum + file.added, 0);
	const totalRemoved = status.files.reduce((sum, file) => sum + file.removed, 0);

	return (
		<>
			{header}
			<ul className="chg-list">
				{status.files.map((file) => (
					<ChangeRow
						key={file.path}
						file={file}
						isOpen={openPath === file.path}
						onToggle={() => toggle(file)}
						diff={diffs[file.path]}
						diffError={diffErrors[file.path]}
						isLoadingDiff={loadingPath === file.path}
						onRetryDiff={() => void fetchDiff(file)}
					/>
				))}
			</ul>
			<p className="chg-total">
				{status.files.length} 个文件 · <b className="add">+{totalAdded}</b>{" "}
				<b className="del">−{totalRemoved}</b>
			</p>
		</>
	);
}
