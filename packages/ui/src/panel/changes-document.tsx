/**
 * 主区域的变更文档。
 *
 * 把工作树里所有文件按顺序放在同一个滚动区：文件头吸顶，点文件头折叠该文件的补丁，补丁
 * 进入视口附近才取。这里只显示工作树相对 HEAD 的差异。
 */

import type { GitCommit, GitCommits, GitDiff, GitFileChange, GitStatus } from "@facet/protocol";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, TextWrap } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { lineClass, patchBodyLines } from "../transcript/diff-lines.ts";
import styles from "./changes.module.css";
import { ChangeMark, changeStatusLabelKey } from "./changes-mark.tsx";
import { CommitHistory } from "./commit-history.tsx";

export interface ChangesDocumentProps {
	/** 工作树状态 */
	status: GitStatus | undefined;
	/** 取状态失败的原因 */
	error: string | undefined;
	/** 顶栏标题；不给时用分支名 */
	title?: string;
	/** 没有文件时的说明；不给时按工作树干净处理 */
	emptyMessage?: string;
	/** 需要定位的文件路径 */
	focusPath: string | undefined;
	/** 同一次定位的序号 */
	focusRequestId: number | undefined;
	/** 取某个文件的补丁 */
	loadDiff: (file: GitFileChange) => Promise<GitDiff>;
	/** 重新取工作树状态 */
	onRefresh: () => void;
	/** 当前项目的提交历史 */
	commits: GitCommits | undefined;
	/** 正在取提交历史 */
	commitsLoading: boolean;
	/** 取提交历史失败的原因 */
	commitsError: string | undefined;
	/** 点一条提交时打开它的改动 */
	onCommitPress?: (commit: GitCommit) => void;
	/**
	 * 挂在顶栏最右端的额外动作。
	 *
	 * 工作区用它放「展开变更列表」：列表收起之后预览占满，这个入口跟着顶栏走。
	 */
	toolbarTrailing?: ReactNode;
	/**
	 * 挂在顶栏最左端的额外动作。
	 *
	 * 工作区用它放「返回列表」：右栏窄到只能单栏钻取时，顶栏左端一枚向左的箭头就是唯一
	 * 的退路。
	 */
	toolbarLeading?: ReactNode;
}

/** 一个文件补丁的加载状态。 */
type DiffState =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "ready"; diff: GitDiff }
	| { kind: "failed"; error: string };

/** 文件名。 */
function fileName(path: string): string {
	return path.split("/").pop() ?? path;
}

/** 文件名之外的部分；顶层文件为空。 */
function directoryName(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
}

/** 工作树状态的内容摘要；只看会影响补丁的字段。 */
function statusSignature(status: GitStatus | undefined): string {
	if (status === undefined) {
		return "";
	}
	return [
		status.branch ?? "",
		status.upstream?.ahead ?? "",
		status.upstream?.behind ?? "",
		...status.files.map(
			(file) =>
				`${file.path}:${file.oldPath ?? ""}:${file.status}:${file.added}:${file.removed}:${file.binary ? 1 : 0}`,
		),
	].join("|");
}

/** 文件补丁段。 */
function ChangesFileSection({
	file,
	isCollapsed,
	isFocused,
	focusRequestId,
	wrapLines,
	loadDiff,
	onToggle,
}: {
	file: GitFileChange;
	isCollapsed: boolean;
	isFocused: boolean;
	focusRequestId: number | undefined;
	wrapLines: boolean;
	loadDiff: (file: GitFileChange) => Promise<GitDiff>;
	onToggle: (path: string) => void;
}): ReactNode {
	const { t } = useI18n();
	const sectionRef = useRef<HTMLElement | null>(null);
	const loadRef = useRef(loadDiff);
	loadRef.current = loadDiff;
	const requestRef = useRef(0);
	const mountedRef = useRef(true);
	const [isVisible, setIsVisible] = useState(false);
	const [state, setState] = useState<DiffState>({ kind: "idle" });
	const statusLabel = t(changeStatusLabelKey(file.status));

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		const node = sectionRef.current;
		if (node === null) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setIsVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "400px 0px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	// 补丁只在文件展开且接近视口时请求；文件折叠后保留已经取到的结果。
	// 请求序号防止换文件或重试后旧结果覆盖新结果；清理函数只负责标记组件已经卸载。
	useEffect(() => {
		if (!isVisible || isCollapsed || file.binary || state.kind !== "idle") {
			return;
		}
		const request = requestRef.current + 1;
		requestRef.current = request;
		setState({ kind: "loading" });
		void loadRef.current(file).then(
			(diff) => {
				if (mountedRef.current && requestRef.current === request) {
					setState({ kind: "ready", diff });
				}
			},
			(error: unknown) => {
				if (mountedRef.current && requestRef.current === request) {
					setState({
						kind: "failed",
						error: error instanceof Error ? error.message : String(error),
					});
				}
			},
		);
	}, [file, isCollapsed, isVisible, state.kind]);

	// 聚焦文件时把它的文件头滚到文档顶部；如果原先折叠，外层已先展开它。
	useEffect(() => {
		void focusRequestId;
		void isCollapsed;
		if (!isFocused) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			sectionRef.current?.scrollIntoView({ block: "start" });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [focusRequestId, isCollapsed, isFocused]);

	const toggle = useCallback(() => onToggle(file.path), [file.path, onToggle]);

	return (
		<section ref={sectionRef} className={styles.section} data-focused={isFocused} data-path={file.path}>
			<div className={styles.fileHeader}>
				<button
					type="button"
					className={styles.fileHeaderButton}
					aria-expanded={!isCollapsed}
					onClick={toggle}
				>
					<ChevronRight className={styles.chevron} size={14} strokeWidth={1.5} data-open={!isCollapsed} />
					<span className={styles.fileName}>{fileName(file.path)}</span>
					<span className={styles.fileDir}>{directoryName(file.path)}</span>
					{file.binary ? (
						<span className={styles.binary}>{t("panel.binary")}</span>
					) : (
						<span className={styles.stats}>
							<b className={styles.add}>+{file.added}</b>
							<b className={styles.del}>−{file.removed}</b>
						</span>
					)}
					<span className={styles.change} data-status={file.status} role="img" aria-label={statusLabel}>
						<ChangeMark status={file.status} />
					</span>
				</button>
			</div>
			{isCollapsed ? null : <div className={styles.fileBody}>{renderDiff()}</div>}
		</section>
	);

	function renderDiff(): ReactNode {
		if (file.binary) {
			return <p className={styles.note}>{t("panel.binaryDiff")}</p>;
		}
		if (state.kind === "loading" || state.kind === "idle") {
			return <div className={styles.loading} role="status" aria-label={t("panel.loadingDiff")} />;
		}
		if (state.kind === "failed") {
			return (
				<p className={`${styles.note} ${styles.noteError}`}>
					{state.error}
					<button type="button" className={styles.retry} onClick={() => setState({ kind: "idle" })}>
						{t("common.retry")}
					</button>
				</p>
			);
		}
		const { diff } = state;
		const lines = patchBodyLines(diff.patch);
		if (lines.length === 0) {
			return <p className={styles.note}>{t("panel.noDiff")}</p>;
		}
		return (
			<>
				{diff.truncated ? <p className={styles.note}>{t("panel.truncatedDiff")}</p> : null}
				<div className={`scroll-x ${styles.diffBody}`} data-wrap={wrapLines}>
					{lines.map(({ key, line, number }) => (
						<div key={key} className={`${styles.diffLine} ${lineClass(line)}`}>
							<i>{number}</i>
							<span>{line}</span>
						</div>
					))}
				</div>
			</>
		);
	}
}

/** 主区域的变更文档。 */
export function ChangesDocument({
	status,
	error,
	title,
	emptyMessage,
	focusPath,
	focusRequestId,
	loadDiff,
	onRefresh,
	commits,
	commitsLoading,
	commitsError,
	onCommitPress,
	toolbarLeading,
	toolbarTrailing,
}: ChangesDocumentProps): ReactNode {
	const { t } = useI18n();
	const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(new Set());
	const [wrapLines, setWrapLines] = useState(false);
	const [revision, setRevision] = useState(0);
	const signature = useMemo(() => statusSignature(status), [status]);
	const lastSignature = useRef(signature);

	const history = (
		<CommitHistory
			commits={commits}
			isLoading={commitsLoading}
			error={commitsError}
			onCommitPress={onCommitPress}
		/>
	);
	const files = status?.files ?? [];
	const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
	const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
	const allCollapsed = files.length > 0 && files.every((file) => collapsedPaths.has(file.path));

	// 定位文件时先展开它；如果它已经展开，只靠文件段自己的滚动。
	useEffect(() => {
		void focusRequestId;
		if (focusPath === undefined) {
			return;
		}
		setCollapsedPaths((current) => {
			if (!current.has(focusPath)) {
				return current;
			}
			const next = new Set(current);
			next.delete(focusPath);
			return next;
		});
	}, [focusPath, focusRequestId]);

	// 工作树状态的内容变了之后所有补丁都要重新取；状态对象刷新但内容相同时保持已取结果。
	useEffect(() => {
		if (lastSignature.current === signature) {
			return;
		}
		lastSignature.current = signature;
		setRevision((current) => current + 1);
	}, [signature]);

	const refresh = useCallback(() => {
		onRefresh();
	}, [onRefresh]);

	const toggleFile = useCallback((path: string) => {
		setCollapsedPaths((current) => {
			const next = new Set(current);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const toggleAll = useCallback(() => {
		setCollapsedPaths(allCollapsed ? new Set() : new Set(files.map((file) => file.path)));
	}, [allCollapsed, files]);

	const header = (
		<div className={styles.docToolbar}>
			{toolbarLeading}
			<span className={styles.branch}>
				{title ?? status?.branch ?? "…"}
				{status?.upstream === undefined ? null : (
					<span className={styles.upstream}>
						↑{status.upstream.ahead} ↓{status.upstream.behind}
					</span>
				)}
			</span>
			{status === undefined ? null : (
				<span className={styles.total}>
					<b className={styles.add}>+{totalAdded}</b>
					<b className={styles.del}>−{totalRemoved}</b>
				</span>
			)}
			{files.length === 0 ? null : (
				<>
					<button
						type="button"
						className={styles.iconButton}
						aria-label={allCollapsed ? t("panel.expandAllFiles") : t("panel.collapseAllFiles")}
						onClick={toggleAll}
					>
						{allCollapsed ? (
							<ChevronsUpDown size={14} strokeWidth={1.5} />
						) : (
							<ChevronsDownUp size={14} strokeWidth={1.5} />
						)}
					</button>
					<button
						type="button"
						className={styles.iconButton}
						data-on={wrapLines}
						aria-label={wrapLines ? t("panel.scrollLongLines") : t("panel.wrapLongLines")}
						onClick={() => setWrapLines((current) => !current)}
					>
						<TextWrap size={14} strokeWidth={1.5} />
					</button>
				</>
			)}
			{toolbarTrailing}
		</div>
	);

	if (error !== undefined) {
		return (
			<div className={styles.document}>
				{header}
				<p className={`${styles.note} ${styles.noteError}`}>
					{error}
					<button type="button" className={styles.retry} onClick={refresh}>
						{t("common.retry")}
					</button>
				</p>
				{history}
			</div>
		);
	}
	if (status === undefined) {
		return (
			<div className={styles.document}>
				{header}
				<p className={styles.note}>{t("panel.loadingChanges")}</p>
				{history}
			</div>
		);
	}
	if (!status.isRepo) {
		return (
			<div className={styles.document}>
				{header}
				<p className={styles.note}>{t("panel.notRepo")}</p>
				{history}
			</div>
		);
	}
	if (files.length === 0) {
		return (
			<div className={styles.document}>
				{header}
				<p className={styles.note}>{emptyMessage ?? t("panel.clean")}</p>
				{history}
			</div>
		);
	}

	return (
		<div className={styles.document}>
			{header}
			<div className={`scroll-y ${styles.docScroll}`}>
				{files.map((file) => (
					<ChangesFileSection
						key={`${file.path}:${revision}`}
						file={file}
						isCollapsed={collapsedPaths.has(file.path)}
						isFocused={focusPath === file.path}
						focusRequestId={focusRequestId}
						wrapLines={wrapLines}
						loadDiff={loadDiff}
						onToggle={toggleFile}
					/>
				))}
			</div>
			{history}
		</div>
	);
}
