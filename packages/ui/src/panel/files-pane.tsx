/**
 * 文件页。
 *
 * 惰性目录树：只列点开过的目录，展开时按需请求，结果按路径缓存。目录在前、文件在后，
 * 名称按目录自己的排序来（主机已排好）。点目录展开或收起，点文件交给宿主打开。
 *
 * 键盘走的是树形导航：上下移动、右键展开或进入、左键收起或回到上一层、回车打开。
 */

import type { FileEntry } from "@facet/protocol";
import { File as FileGlyph, PanelRightClose, RefreshCw } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useHoverTip } from "../tip.tsx";
import { TreeChevron } from "../transcript/chevron.tsx";

export interface FilesPaneProps {
	/** 项目根下某一层的目录内容；path 为空串表示项目根 */
	loadDirectory: (path: string) => Promise<FileEntry[]>;
	/** 打开一个文件 */
	onOpenFile: (path: string) => void;
	/** 当前打开的文件，用来高亮 */
	selectedPath?: string;
	/** 收起这一栏；不给时不显示收起按钮（整列独占时没地方可收） */
	onCollapse?: (() => void) | undefined;
}

/** 一层目录的加载状态。 */
interface DirectoryState {
	/** 已经取到的条目 */
	entries?: readonly FileEntry[];
	/** 正在取 */
	isLoading: boolean;
	/** 取失败的原因 */
	error?: string;
}

/** 目录树里的一行。 */
interface Row {
	entry: FileEntry;
	/** 缩进层级，根为 0 */
	depth: number;
}

export function FilesPane({ loadDirectory, onOpenFile, selectedPath, onCollapse }: FilesPaneProps) {
	// 文件行的完整路径与读取失败的原文都走这份提示
	const tip = useHoverTip();
	const { t } = useI18n();
	const [directories, setDirectories] = useState<Readonly<Record<string, DirectoryState>>>({});
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([""]));
	/** 键盘焦点所在的行，键为路径；根目录自身不算一行，用空串占位 */
	const [activePath, setActivePath] = useState<string | undefined>(undefined);
	/** 行元素，键盘移动之后把焦点送过去 */
	const rowRefs = useRef(new Map<string, HTMLButtonElement>());

	/** 取一层目录；已经取过或正在取就不再发。 */
	const load = useCallback(
		async (path: string): Promise<void> => {
			setDirectories((current) => ({
				...current,
				[path]: { ...current[path], isLoading: true, error: undefined },
			}));
			try {
				const entries = await loadDirectory(path);
				setDirectories((current) => ({ ...current, [path]: { entries, isLoading: false } }));
			} catch (error) {
				setDirectories((current) => ({
					...current,
					[path]: {
						entries: current[path]?.entries,
						isLoading: false,
						error: error instanceof Error ? error.message : String(error),
					},
				}));
			}
		},
		[loadDirectory],
	);

	// 挂载时先取根
	useEffect(() => {
		void load("");
	}, [load]);

	/** 重新取根目录：丢掉已缓存的目录与展开状态，之后按需要重新展开。 */
	const refresh = useCallback((): void => {
		setDirectories({});
		setExpanded(new Set([""]));
		void load("");
	}, [load]);

	/** 展开或收起一个目录。 */
	const toggle = useCallback(
		(entry: FileEntry): void => {
			setExpanded((current) => {
				const next = new Set(current);
				if (next.has(entry.path)) {
					next.delete(entry.path);
				} else {
					next.add(entry.path);
				}
				return next;
			});
			if (directories[entry.path]?.entries === undefined) {
				void load(entry.path);
			}
		},
		[directories, load],
	);

	/** 按展开状态把树摊平成行。 */
	const rows: Row[] = [];
	const walk = (path: string, depth: number): void => {
		const state = directories[path];
		for (const entry of state?.entries ?? []) {
			rows.push({ entry, depth });
			if (entry.kind === "directory" && expanded.has(entry.path)) {
				walk(entry.path, depth + 1);
			}
		}
	};
	walk("", 0);

	const root = directories[""];

	/*
	 * 树顶：收起按钮贴左缘（也就是紧挨着内部那条分隔线），标题随后，刷新在最右端。
	 * 上面第一行的右端是图钉、关闭与窗口按钮，这样两排图标不会挤成一列。
	 */
	const header = (
		<div className="tree-head">
			{onCollapse === undefined ? null : (
				<button type="button" className="ib" aria-label={t("panel.collapseTree")} onClick={onCollapse}>
					<PanelRightClose size={13} strokeWidth={1.5} />
				</button>
			)}
			<span className="tree-root">{t("panel.projectFiles")}</span>
			<div className="tree-head-actions">
				<button
					type="button"
					className="ib"
					aria-label={t("panel.refreshFiles")}
					disabled={root?.isLoading === true}
					onClick={refresh}
				>
					<RefreshCw size={13} strokeWidth={1.5} />
				</button>
			</div>
		</div>
	);

	if (root?.error !== undefined) {
		return (
			<>
				{header}
				<p className="chg-note is-error">
					{root.error}
					<button type="button" className="chg-retry" onClick={() => void load("")}>
						{t("common.retry")}
					</button>
				</p>
			</>
		);
	}

	if (root?.entries === undefined) {
		return (
			<>
				{header}
				<p className="chg-note">{t("panel.loadingDirectory")}</p>
			</>
		);
	}

	if (rows.length === 0) {
		return (
			<>
				{header}
				<p className="chg-note">{t("panel.emptyDirectory")}</p>
			</>
		);
	}

	/** 把焦点送到某一行。 */
	const focusRow = (path: string): void => {
		setActivePath(path);
		rowRefs.current.get(path)?.focus();
	};

	/** 键盘导航：上下移动、左右展开收起、回车打开。 */
	const onRowKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, row: Row, index: number): void => {
		const { entry } = row;
		const isDirectory = entry.kind === "directory";
		const isOpen = expanded.has(entry.path);
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const next = rows[event.key === "ArrowDown" ? index + 1 : index - 1];
			if (next !== undefined) {
				focusRow(next.entry.path);
			}
			return;
		}
		if (event.key === "Home" || event.key === "End") {
			event.preventDefault();
			const target = event.key === "Home" ? rows[0] : rows[rows.length - 1];
			if (target !== undefined) {
				focusRow(target.entry.path);
			}
			return;
		}
		if (event.key === "ArrowRight") {
			event.preventDefault();
			if (isDirectory && !isOpen) {
				toggle(entry);
			} else if (isDirectory) {
				const child = rows[index + 1];
				if (child !== undefined && child.depth > row.depth) {
					focusRow(child.entry.path);
				}
			}
			return;
		}
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			if (isDirectory && isOpen) {
				toggle(entry);
				return;
			}
			// 回到同层或上一层的父目录：往前找第一个层级更浅的行
			for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
				const candidate = rows[cursor];
				if (candidate !== undefined && candidate.depth < row.depth) {
					focusRow(candidate.entry.path);
					return;
				}
			}
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			setActivePath(entry.path);
			if (isDirectory) {
				toggle(entry);
			} else {
				onOpenFile(entry.path);
			}
		}
	};

	return (
		<>
			{header}
			<div className="tree" role="tree" aria-label={t("panel.projectFiles")}>
				{rows.map((row, index): ReactNode => {
					const { entry, depth } = row;
					const isDirectory = entry.kind === "directory";
					const isOpen = expanded.has(entry.path);
					const state = directories[entry.path];
					const isSelected = entry.path === selectedPath;
					const isActive = entry.path === activePath;
					return (
						<div key={entry.path} className="tree-item">
							<button
								type="button"
								ref={(node) => {
									if (node === null) {
										rowRefs.current.delete(entry.path);
									} else {
										rowRefs.current.set(entry.path, node);
									}
								}}
								className={isSelected ? "tree-row is-on" : "tree-row"}
								style={{ "--files-depth": depth } as CSSProperties}
								{...tip.handlers(entry.path)}
								role="treeitem"
								aria-level={depth + 1}
								aria-expanded={isDirectory ? isOpen : undefined}
								aria-selected={isSelected}
								tabIndex={isActive || (activePath === undefined && index === 0) ? 0 : -1}
								onFocus={() => setActivePath(entry.path)}
								onKeyDown={(event) => onRowKeyDown(event, row, index)}
								onClick={() => {
									setActivePath(entry.path);
									if (isDirectory) {
										toggle(entry);
									} else {
										onOpenFile(entry.path);
									}
								}}
							>
								{isDirectory ? (
									<TreeChevron isOpen={isOpen} size={14} />
								) : (
									<FileGlyph size={14} strokeWidth={1.5} className="tree-icon" />
								)}
								<span className="tree-name">{entry.name}</span>
								{state?.isLoading === true ? <span className="tree-note">…</span> : null}
								{state?.error === undefined ? null : (
									<span className="tree-note is-error" {...tip.handlers(state.error)}>
										{t("panel.readFailed")}
									</span>
								)}
							</button>
						</div>
					);
				})}
			</div>
			{tip.render()}
		</>
	);
}
