/**
 * 变更索引栏。
 *
 * 列工作树相对 HEAD 的改动：分支与上下游、按目录分组的文件、每个文件的状态图标与增删
 * 行数。点文件在主区域打开变更文档；这里不展开补丁。
 *
 * 提交历史不在这里：它是低频的历史态，归「提交图谱」那个标签（`GitGraphTab`）。变更页只
 * 管高频的工作树状态。
 */

import type { GitFileChange, GitStatus } from "@facet/protocol";
import { ChevronRight, FileText, PanelRightClose } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useMemo, useState } from "react";
import { ListRow } from "../common/ListRow.tsx";
import { ChangeMark, changeStatusLabelKey } from "../git/git-status-mark.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import styles from "./changes.module.css";
import { buildChangesTree, type ChangesTreeRow, flattenChangesTree } from "./changes-tree.ts";

export interface ChangesPaneProps {
	/** 工作树状态；还没取到时为空 */
	status: GitStatus | undefined;
	/** 取状态失败的原因 */
	error: string | undefined;
	/** 重新取状态 */
	onRefresh: () => void;
	/** 在主区域打开某个文件的补丁 */
	onOpenDiff?: (file: GitFileChange) => void;
	/** 收起这一栏；不给时不显示收起按钮（整列独占时没地方可收） */
	onCollapse?: (() => void) | undefined;
}

/** 行首缩进。 */
function rowStyle(depth: number): CSSProperties {
	return { "--changes-depth": depth } as CSSProperties;
}

/** 目录行。 */
function FolderRow({
	row,
	onToggle,
}: {
	row: Extract<ChangesTreeRow, { kind: "folder" }>;
	onToggle: (path: string) => void;
}): ReactNode {
	return (
		<li className={styles.item}>
			<ListRow
				as="button"
				className={styles.row}
				style={rowStyle(row.depth)}
				data-open={!row.collapsed}
				aria-expanded={!row.collapsed}
				onClick={() => onToggle(row.path)}
			>
				<ChevronRight className={styles.chevron} size={ICON_SIZE.md} data-open={!row.collapsed} />
				<span className={styles.name}>{row.name}</span>
			</ListRow>
		</li>
	);
}

/** 文件行。 */
function FileRow({
	row,
	isSelected,
	onSelect,
	onOpenDiff,
}: {
	row: Extract<ChangesTreeRow, { kind: "file" }>;
	isSelected: boolean;
	onSelect: (path: string) => void;
	onOpenDiff: ((file: GitFileChange) => void) | undefined;
}): ReactNode {
	const { t } = useI18n();
	// 行里显示的是文件名，完整路径由提示补上
	const tip = useHoverTip();
	const file = row.file;
	const name = file.path.split("/").pop() ?? file.path;
	const statusLabel = t(changeStatusLabelKey(file.status));
	const open = useCallback(() => {
		onSelect(file.path);
		onOpenDiff?.(file);
	}, [file, onOpenDiff, onSelect]);
	return (
		<li className={styles.item}>
			<ListRow
				as="button"
				selected={isSelected}
				className={styles.row}
				style={rowStyle(row.depth)}
				{...tip.handlers(file.path)}
				onClick={open}
			>
				<FileText className={styles.fileIcon} size={ICON_SIZE.md} />
				<span className={styles.name}>{name}</span>
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
			</ListRow>
			{tip.render()}
		</li>
	);
}

/** 变更页。 */
export function ChangesPane({
	status,
	error,
	onRefresh,
	onOpenDiff,
	onCollapse,
}: ChangesPaneProps): ReactNode {
	const { t } = useI18n();
	const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set());
	const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);

	const tree = useMemo(() => buildChangesTree(status?.files ?? []), [status?.files]);
	const rows = useMemo(() => flattenChangesTree(tree, collapsedFolders), [collapsedFolders, tree]);

	const toggleFolder = useCallback((path: string) => {
		setCollapsedFolders((current) => {
			const next = new Set(current);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const totalAdded = status?.files.reduce((sum, file) => sum + file.added, 0) ?? 0;
	const totalRemoved = status?.files.reduce((sum, file) => sum + file.removed, 0) ?? 0;

	/*
	 * 列表顶栏：收起按钮贴左缘（紧挨内部那条分隔线），分支与上下游随后，增删统计在最右端。
	 */
	const header = (
		<div className={styles.head}>
			{onCollapse === undefined ? null : (
				<button
					type="button"
					className={`${styles.iconButton} workspace-collapse-list`}
					aria-label={t("panel.collapseChanges")}
					onClick={onCollapse}
				>
					<PanelRightClose size={ICON_SIZE.md} />
				</button>
			)}
			<span className={styles.branch}>
				{status?.branch ?? "…"}
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
		</div>
	);

	let body: ReactNode;
	if (error !== undefined) {
		body = (
			<p className={`${styles.note} ${styles.noteError}`}>
				{error}
				<button type="button" className={styles.retry} onClick={onRefresh}>
					{t("common.retry")}
				</button>
			</p>
		);
	} else if (status === undefined) {
		body = <p className={styles.note}>{t("panel.loadingChanges")}</p>;
	} else if (!status.isRepo) {
		body = <p className={styles.note}>{t("panel.notRepo")}</p>;
	} else if (status.files.length === 0) {
		body = <p className={styles.note}>{t("panel.clean")}</p>;
	} else {
		body = (
			<ul className={styles.tree}>
				{rows.map((row) =>
					row.kind === "folder" ? (
						<FolderRow key={`folder:${row.path}`} row={row} onToggle={toggleFolder} />
					) : (
						<FileRow
							key={`file:${row.file.path}`}
							row={row}
							isSelected={selectedPath === row.file.path}
							onSelect={setSelectedPath}
							onOpenDiff={onOpenDiff}
						/>
					),
				)}
			</ul>
		);
	}

	return (
		<div className={styles.pane}>
			{header}
			{body}
		</div>
	);
}
